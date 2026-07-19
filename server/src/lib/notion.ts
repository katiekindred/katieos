import { Client } from '@notionhq/client';
import type { ActivityLogEntry, FieldOption, FieldUpdate, PickerField, Project, TaskLite, WeeklyReview } from '../types.js';
import {
  centralDaysAgo, CENTRAL_TZ, computeActivity, computeHoursThisWeek, computeQuiet, computeStature,
  computeTotalHours, computeTrend, computeWeek, computeWeeklyReview, countRecentSessions,
  findRecovery, formatEnergyLine, formatSessionLine, parseEnergyLine, parseSessionLine,
  parseThresholdDays, type EnergyLine
} from './derive.js';

const CENTRAL_MONTH_YEAR = new Intl.DateTimeFormat('en-US', { timeZone: CENTRAL_TZ, month: 'long', year: 'numeric' });

function env(name: string): string | undefined {
  return process.env[name];
}

function isConfigured(): boolean {
  return !!(env('NOTION_TOKEN') && env('NOTION_PROJECTS_DB') && env('NOTION_TASKS_DB'));
}

export function configuredWorkspaces(): ('main')[] {
  return isConfigured() ? ['main'] : [];
}

let _client: Client | null = null;
function client(): Client {
  if (!_client) _client = new Client({ auth: env('NOTION_TOKEN') });
  return _client;
}

const PROJECTS_DB = () => env('NOTION_PROJECTS_DB')!;
const TASKS_DB = () => env('NOTION_TASKS_DB')!;

// Notion's 2025-09 API queries a data_source_id, not the database_id copied
// from the browser URL. Resolve + cache it once per database.
const dataSourceCache = new Map<string, string>();
async function resolveDataSourceId(databaseId: string): Promise<string> {
  const cached = dataSourceCache.get(databaseId);
  if (cached) return cached;
  const db = await client().databases.retrieve({ database_id: databaseId });
  const dsId = (db as any).data_sources?.[0]?.id;
  if (!dsId) throw new Error(`Notion database ${databaseId} has no queryable data source`);
  dataSourceCache.set(databaseId, dsId);
  return dsId;
}

async function queryAll(databaseId: string, extra: Record<string, any> = {}): Promise<any[]> {
  const dataSourceId = await resolveDataSourceId(databaseId);
  const rows: any[] = [];
  let cursor: string | undefined;
  do {
    const res = await client().dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: cursor,
      page_size: 100,
      ...extra,
    });
    rows.push(...res.results);
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return rows;
}

// One-time schema setup: TIGFBAO/Master Task List Table don't have the
// fields this app needs (description, per-project threshold, stated
// priority rank, reorder reason, activity duration). Add them as real
// Notion properties rather than stashing this state outside Notion.
let schemaEnsured = false;
export async function ensureSchema(): Promise<void> {
  if (schemaEnsured || !isConfigured()) return;
  const projectsDsId = await resolveDataSourceId(PROJECTS_DB());
  const projectsDs = await client().dataSources.retrieve({ data_source_id: projectsDsId });
  const projectProps = (projectsDs as any).properties || {};
  const missingProjectProps: Record<string, any> = {};
  if (!projectProps['Description']) missingProjectProps['Description'] = { rich_text: {} };
  if (!projectProps['Check-in threshold']) missingProjectProps['Check-in threshold'] = { rich_text: {} };
  if (!projectProps['Priority']) missingProjectProps['Priority'] = { number: { format: 'number' } };
  if (!projectProps['Next Step Override']) missingProjectProps['Next Step Override'] = { rich_text: {} };
  if (!projectProps['Last Reorder Reason']) missingProjectProps['Last Reorder Reason'] = { rich_text: {} };
  if (!projectProps['House Color']) missingProjectProps['House Color'] = { rich_text: {} };
  if (Object.keys(missingProjectProps).length) {
    await client().dataSources.update({ data_source_id: projectsDsId, properties: missingProjectProps });
  }

  const tasksDsId = await resolveDataSourceId(TASKS_DB());
  const tasksDs = await client().dataSources.retrieve({ data_source_id: tasksDsId });
  const taskProps = (tasksDs as any).properties || {};
  const missingTaskProps: Record<string, any> = {};
  if (!taskProps['Duration (min)']) missingTaskProps['Duration (min)'] = { number: { format: 'number' } };
  if (!taskProps['Source']) missingTaskProps['Source'] = { select: { options: [{ name: 'Live' }, { name: 'Manual' }] } };
  // The Master Task List's original project relation was deleted at some
  // point (only a broken "Original Project" formula remains), so recreate
  // the task→project link this app is built around.
  if (!taskProps['Project']) missingTaskProps['Project'] = { relation: { data_source_id: projectsDsId, single_property: {} } };
  if (Object.keys(missingTaskProps).length) {
    await client().dataSources.update({ data_source_id: tasksDsId, properties: missingTaskProps });
  }
  schemaEnsured = true;
}

function text(prop: any): string {
  if (!prop) return '';
  const arr = prop.rich_text || prop.title || [];
  return arr.map((t: any) => t.plain_text).join('');
}
function num(prop: any): number | null {
  return prop && typeof prop.number === 'number' ? prop.number : null;
}
function select(prop: any): string {
  return prop?.select?.name || prop?.status?.name || '';
}
function multiSelect(prop: any): string[] {
  return (prop?.multi_select || []).map((o: any) => o.name);
}
function dateStart(prop: any): string | null {
  return prop?.date?.start || null;
}
function relationIds(prop: any): string[] {
  return (prop?.relation || []).map((r: any) => r.id);
}
// Priority Calculation is a formula returning a number; read the formula value,
// falling back to a plain number property if the shape ever changes.
function formulaNumber(prop: any): number | null {
  const f = prop?.formula;
  if (f && f.type === 'number' && typeof f.number === 'number') return f.number;
  return typeof prop?.number === 'number' ? prop.number : null;
}
// The plain text of a paragraph / bulleted-list block, wherever it carries its
// rich_text. Used to read session lines back out of a task's page body.
function blockText(block: any): string {
  const body = block?.[block?.type];
  const arr = body?.rich_text || [];
  return arr.map((t: any) => t.plain_text ?? t.text?.content ?? '').join('');
}
function paragraph(content: string) {
  return { object: 'block' as const, type: 'paragraph' as const, paragraph: { rich_text: [{ type: 'text' as const, text: { content } }] } };
}

// "Work or Personal?" is a formula on TIGFBAO. Its exact return type/casing
// isn't queryable via schema alone, so read whatever value comes back and
// treat anything containing "work" (case-insensitive) as excluded. This is
// an app-level filter, not a hard integration-level boundary — TIGFBAO mixes
// Work and Personal rows in one database, so the token can technically read
// Work rows too. Enforcement lives entirely in this function.
function formulaValue(prop: any): string {
  const f = prop?.formula;
  if (!f) return '';
  if (f.type === 'string') return f.string || '';
  if (f.type === 'number') return String(f.number ?? '');
  if (f.type === 'boolean') return String(f.boolean);
  if (f.type === 'date') return f.date?.start || '';
  return '';
}
function isWorkRow(props: any): boolean {
  return /work/i.test(formulaValue(props['Work or Personal?']));
}

export function humanizeLastMoved(iso: string | null): string {
  if (!iso) return '—';
  const days = centralDaysAgo(iso); // Central calendar days, so "today" flips at local midnight
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.round(days / 7)} week${Math.round(days / 7) === 1 ? '' : 's'} ago`;
  return CENTRAL_MONTH_YEAR.format(new Date(iso));
}

interface TaskRow {
  id: string;
  projectId: string | null;
  name: string;
  status: string;
  statusNotes: string;
  due: string | null;
  dateCompleted: string | null;
  durationMin: number | null;
  priorityCalc: number | null;
  importanceId: string | null;
  urgencyId: string | null;
  source: string;
  createdTime: string;
  lastEditedTime: string | null;
}

let tasksCache: { at: number; data: TaskRow[] } | null = null;
const TASKS_TTL_MS = 15000; // matches PROJECTS_TTL_MS — one scan serves a whole client refresh burst

async function fetchAllTasks(): Promise<TaskRow[]> {
  if (tasksCache && Date.now() - tasksCache.at < TASKS_TTL_MS) return tasksCache.data;
  await ensureSchema();
  const rows = await queryAll(TASKS_DB());
  const data = rows.map((page: any) => {
    const props = page.properties;
    const projectIds = relationIds(props['Project']);
    return {
      id: page.id,
      projectId: projectIds[0] || null,
      name: text(props['Name']),
      status: select(props['Status']),
      statusNotes: text(props['Status Notes']),
      due: dateStart(props['Due']),
      dateCompleted: dateStart(props['Date Completed']),
      durationMin: num(props['Duration (min)']),
      priorityCalc: formulaNumber(props['Priority Calculation']),
      importanceId: props['Importance']?.select?.id ?? null,
      urgencyId: props['Urgency']?.select?.id ?? null,
      source: props['Source']?.select?.name || 'notion-task',
      createdTime: page.created_time,
      lastEditedTime: page.last_edited_time ?? null,
    };
  });
  tasksCache = { at: Date.now(), data };
  return data;
}

// "Last visited" is driven purely by task activity in Notion: the most recently
// added-or-edited task for a project (status changes, completion, or a session
// the app appends to a task body all bump Notion's last_edited_time). A project
// with no tasks has no visit — deliberately no fallback to the project page's
// own edit time, so tweaking the project's fields doesn't read as a visit.
function projectLastVisit(tasks: TaskRow[], projectId: string): { lastMovedAt: string | null; drivingTask: TaskRow | null } {
  let drivingTask: TaskRow | null = null;
  for (const t of tasks) {
    if (t.projectId !== projectId || !t.lastEditedTime) continue;
    if (!drivingTask || new Date(t.lastEditedTime).getTime() > new Date(drivingTask.lastEditedTime!).getTime()) {
      drivingTask = t;
    }
  }
  return { lastMovedAt: drivingTask?.lastEditedTime ?? null, drivingTask };
}

// Debug helper: for one project, show what "last visited" resolves to and which
// task set it — a quick way to confirm why the label reads the way it does.
export async function explainLastVisit(projectId: string) {
  if (!isConfigured()) return { projectId, lastMovedAt: null, lastMoved: '—', drivingTask: null };
  const tasks = await fetchAllTasks();
  const { lastMovedAt, drivingTask } = projectLastVisit(tasks, projectId);
  return {
    projectId,
    lastMovedAt,
    lastMoved: humanizeLastMoved(lastMovedAt),
    taskCount: tasks.filter(t => t.projectId === projectId).length,
    drivingTask: drivingTask && {
      id: drivingTask.id, name: drivingTask.name, status: drivingTask.status,
      lastEditedTime: drivingTask.lastEditedTime,
    },
  };
}

const DONE_STATUSES = new Set(['Done', 'Irrelevant']);

// A task the app has logged time against carries its sessions as marked lines
// in its Notion page body (see formatSessionLine). Read those back out.
async function readSessionBlocks(taskId: string) {
  const out: { blockId: string; createdAt: string; durationSec: number; note: string; source: 'live' | 'manual' }[] = [];
  let cursor: string | undefined;
  do {
    const res = await client().blocks.children.list({ block_id: taskId, start_cursor: cursor, page_size: 100 });
    for (const b of res.results as any[]) {
      const parsed = parseSessionLine(blockText(b));
      if (parsed) out.push({ blockId: b.id, ...parsed });
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return out;
}

// Run `fn` over items with at most `limit` in flight — Notion 429s on bursts.
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }));
  return results;
}

const RECENT_DONE_DAYS = 60;

// The activity log that lights the skyline. Each logged *session* (a body line
// on an open, in-progress task) is one dated entry, so live work shows on the
// day it happened. A completed task instead contributes a single entry on its
// completion date carrying its total time — which also covers legacy per-session
// rows and tasks finished by hand. Open tasks AND recently-completed app-touched
// tasks (within RECENT_DONE_DAYS) have their page bodies read, so finishing a
// task doesn't retroactively collapse its per-day sessions into one entry on
// the completion date and shrink streaks/week dots/hours; the single
// completion-date entry remains the fallback for tasks with no session lines.
async function buildActivityLog(tasks: TaskRow[]): Promise<ActivityLogEntry[]> {
  const touched = tasks.filter(t => {
    if (!t.projectId) return false;
    const appTouched = (t.durationMin ?? 0) > 0 || t.source === 'Live' || t.source === 'Manual';
    if (!appTouched) return false;
    if (!DONE_STATUSES.has(t.status)) return true;
    return !!t.dateCompleted && centralDaysAgo(t.dateCompleted) <= RECENT_DONE_DAYS;
  });
  const sessionArrays = await mapPool(touched, 4, t => readSessionBlocks(t.id));
  const sessionsByTask = new Map(touched.map((t, i) => [t.id, sessionArrays[i]]));

  const log: ActivityLogEntry[] = [];
  for (const t of tasks) {
    if (!t.projectId) continue;
    const sessions = sessionsByTask.get(t.id);
    if (sessions && sessions.length) {
      for (const s of sessions) {
        log.push({
          id: `${t.id}:${s.blockId}`, projectId: t.projectId, startedAt: null,
          endedAt: s.createdAt, durationSec: s.durationSec, note: s.note || t.name,
          source: s.source, createdAt: s.createdAt,
        });
      }
    } else if (t.dateCompleted) {
      log.push({
        id: t.id, projectId: t.projectId, startedAt: null, endedAt: t.dateCompleted,
        durationSec: (t.durationMin || 0) * 60, note: t.statusNotes || t.name,
        source: (t.source === 'Live' ? 'live' : t.source === 'Manual' ? 'manual' : 'notion-task'),
        createdAt: t.dateCompleted,
      });
    }
  }
  return log;
}

// The next step is the highest-`Priority Calculation` open task — the same key
// Katie's Master Task List "Priority View" sorts by and works top-down. The
// Dependency Hit demotion is already baked into that number, so blocked tasks
// sink on their own; no due-date logic (that column is retired).
function topOpenTask(tasks: TaskRow[], projectId: string): TaskRow | null {
  const open = tasks.filter(t => t.projectId === projectId && !DONE_STATUSES.has(t.status));
  if (open.length === 0) return null;
  open.sort((a, b) => {
    const pa = a.priorityCalc, pb = b.priorityCalc;
    if (pa != null && pb != null && pa !== pb) return pb - pa;
    if (pa != null && pb == null) return -1;
    if (pb != null && pa == null) return 1;
    return new Date(a.createdTime).getTime() - new Date(b.createdTime).getTime();
  });
  return open[0];
}

function pickNextStep(tasks: TaskRow[], projectId: string): { step: string; note: string; target: string } | null {
  const top = topOpenTask(tasks, projectId);
  if (!top) return null;
  return { step: top.name, note: top.statusNotes || 'From your Master Task List', target: '' };
}

// Reading task page bodies makes fetchProjects heavier, and several routes call
// it per client refresh, so cache the derived result briefly. Any write busts
// the cache so the next read is fresh.
let projectsCache: { at: number; data: { projects: Project[]; log: ActivityLogEntry[] } } | null = null;
const PROJECTS_TTL_MS = 15000;
function bustCache() { projectsCache = null; tasksCache = null; }

export async function fetchProjects(): Promise<{ projects: Project[]; log: ActivityLogEntry[] }> {
  if (!isConfigured()) return { projects: [], log: [] };
  if (projectsCache && Date.now() - projectsCache.at < PROJECTS_TTL_MS) return projectsCache.data;
  await ensureSchema();

  const [projectRows, tasks] = await Promise.all([queryAll(PROJECTS_DB()), fetchAllTasks()]);
  const log = await buildActivityLog(tasks);

  const visible = projectRows.filter((page: any) => {
    const props = page.properties;
    if (isWorkRow(props)) return false;
    const status = select(props['Status']);
    return status === 'Active' || status === 'On Hold' || !status;
  });

  visible.sort((a: any, b: any) => (num(a.properties['Priority']) ?? 999) - (num(b.properties['Priority']) ?? 999));

  const projects: Project[] = visible.map((page: any, i: number) => {
    const props = page.properties;
    const projectLog = log.filter(e => e.projectId === page.id);
    const { lastMovedAt } = projectLastVisit(tasks, page.id);

    const thresholdStr = text(props['Check-in threshold']) || '2 weeks';
    const thresholdDays = parseThresholdDays(thresholdStr);
    const activity = computeActivity(projectLog);
    const quiet = computeQuiet(lastMovedAt, thresholdDays);
    const nextOverride = text(props['Next Step Override']);
    const next = pickNextStep(tasks, page.id);
    const totalHours = computeTotalHours(projectLog);

    return {
      id: page.id,
      name: text(props['Name']) || 'Untitled',
      blurb: text(props['Description']) || multiSelect(props['Home Tags']).join(', '),
      status: select(props['Status']) || (quiet ? 'quiet' : 'active'),
      lastMoved: humanizeLastMoved(lastMovedAt),
      lastMovedAt,
      threshold: thresholdStr,
      sessions: `${projectLog.length} logged`,
      note: '',
      nextStep: nextOverride || next?.step || '',
      nextNote: nextOverride ? 'Set manually' : (next?.note || ''),
      nextTarget: next?.target || '',
      priority: num(props['Priority']) ?? i + 1,
      activity,
      recentSessions: countRecentSessions(projectLog),
      totalHours,
      stature: computeStature(totalHours),
      trend: computeTrend(projectLog),
      quiet,
      week: computeWeek(log, page.id),
      hours: computeHoursThisWeek(log, page.id),
      recoveryNote: findRecovery(log, page.id, thresholdDays)?.note ?? null,
      houseColor: text(props['House Color']) || null,
    };
  });

  const data = { projects, log };
  projectsCache = { at: Date.now(), data };
  return data;
}

// Keep the task's Duration (min) equal to the sum of its logged session lines,
// so the property always reflects total time across sessions.
async function recomputeDuration(taskId: string): Promise<void> {
  const sessions = await readSessionBlocks(taskId);
  const totalMin = Math.round(sessions.reduce((s, x) => s + x.durationSec, 0) / 60);
  await client().pages.update({ page_id: taskId, properties: { 'Duration (min)': { number: totalMin } } });
}

// Create a task under a project. Used both for the task-list "add a task" and,
// with a source, for the stub the app creates when you log time against a
// project that has no open task yet — leaving Importance/Urgency for Katie.
export async function createTask(fields: { projectId?: string | null; name: string; source?: 'live' | 'manual' }): Promise<string> {
  await ensureSchema();
  const properties: Record<string, any> = {
    'Name': { title: [{ text: { content: fields.name.slice(0, 100) || 'New task' } }] },
    'Status': { status: { name: 'Not started' } },
  };
  if (fields.projectId) properties['Project'] = { relation: [{ id: fields.projectId }] };
  if (fields.source) properties['Source'] = { select: { name: fields.source === 'manual' ? 'Manual' : 'Live' } };
  const page = await client().pages.create({ parent: { database_id: TASKS_DB() }, properties });
  bustCache();
  return page.id;
}

// Mark a task done: Status → Done, Date Completed → now (Katie's completion
// convention). No duration change — time already lives on its session lines.
export async function completeTask(taskId: string): Promise<void> {
  await client().pages.update({
    page_id: taskId,
    properties: { 'Status': { status: { name: 'Done' } }, 'Date Completed': { date: { start: new Date().toISOString() } } },
  });
  bustCache();
}

// Log a work session. It attaches to a task: the caller's chosen task, else the
// project's current top-priority open task, else a fresh stub. The session is
// appended as a line in that task's page body and Duration (min) re-summed.
export async function logSession(entry: {
  taskId?: string | null; projectId?: string | null; note: string;
  durationSec: number; source: 'live' | 'manual'; when?: string; newTask?: boolean;
}): Promise<{ taskId: string }> {
  await ensureSchema();
  const when = entry.when || new Date().toISOString();

  let target = entry.taskId || null;
  if (!target && !entry.newTask && entry.projectId) {
    const tasks = await fetchAllTasks();
    target = topOpenTask(tasks, entry.projectId)?.id ?? null;
  }
  if (!target) {
    target = await createTask({ projectId: entry.projectId, name: entry.note || 'New task', source: entry.source });
  }

  await client().blocks.children.append({
    block_id: target,
    children: [paragraph(formatSessionLine({ createdAt: when, durationSec: entry.durationSec, note: entry.note, source: entry.source }))],
  });
  await recomputeDuration(target);
  bustCache();
  return { taskId: target };
}

// Open tasks across the visible projects, for the per-project task list. The
// top-priority open task per project is flagged as that project's next step.
export async function fetchOpenTasks(): Promise<TaskLite[]> {
  await ensureSchema();
  const tasks = await fetchAllTasks();
  const open = tasks.filter(t => t.projectId && !DONE_STATUSES.has(t.status));
  const nextStepIds = new Set<string>();
  for (const projectId of new Set(open.map(t => t.projectId as string))) {
    const top = topOpenTask(tasks, projectId);
    if (top) nextStepIds.add(top.id);
  }
  return open.map(t => ({
    id: t.id, projectId: t.projectId, name: t.name, status: t.status,
    priorityCalc: t.priorityCalc, isNextStep: nextStepIds.has(t.id),
    importanceId: t.importanceId, urgencyId: t.urgencyId, statusNotes: t.statusNotes,
  }));
}

// Write field values back to a task (Part A4). Select/status are set by option
// id (safer against renames); an empty option list clears them; text writes the
// rich_text field. Used to set Importance / Urgency / Status Notes from the
// logger, on both new stubs and existing tasks.
export async function updateTaskFields(taskId: string, updates: FieldUpdate[]): Promise<void> {
  const properties: Record<string, any> = {};
  for (const u of updates) {
    if (u.type === 'select') {
      properties[u.name] = { select: u.optionIds?.[0] ? { id: u.optionIds[0] } : null };
    } else if (u.type === 'status') {
      properties[u.name] = { status: u.optionIds?.[0] ? { id: u.optionIds[0] } : null };
    } else if (u.type === 'multi_select') {
      properties[u.name] = { multi_select: (u.optionIds || []).map(id => ({ id })) };
    } else if (u.type === 'text') {
      properties[u.name] = { rich_text: u.text ? [{ text: { content: u.text } }] : [] };
    }
  }
  if (Object.keys(properties).length === 0) return;
  await client().pages.update({ page_id: taskId, properties });
  bustCache();
}

// The task DB's select / status / multi_select properties with their options
// and Notion colors, read live from the data-source schema (Part A2). Cached for
// the session — it rarely changes and each read is a round trip.
let fieldSchemaCache: { at: number; fields: PickerField[] } | null = null;
export async function fetchTaskFieldSchema(): Promise<PickerField[]> {
  if (fieldSchemaCache && Date.now() - fieldSchemaCache.at < 5 * 60 * 1000) return fieldSchemaCache.fields;
  const dsId = await resolveDataSourceId(TASKS_DB());
  const ds = await client().dataSources.retrieve({ data_source_id: dsId });
  const props = (ds as any).properties || {};
  const fields: PickerField[] = [];
  for (const [name, def] of Object.entries<any>(props)) {
    const type = def?.type;
    if (type === 'select' || type === 'status' || type === 'multi_select') {
      const options: FieldOption[] = (def[type]?.options || []).map((o: any) => ({
        id: o.id, name: o.name, color: o.color || 'default',
      }));
      fields.push({ name, type, options });
    }
  }
  fieldSchemaCache = { at: Date.now(), fields };
  return fields;
}

// Read-only weekly reflection derived entirely from the activity log.
export async function fetchWeeklyReview(): Promise<WeeklyReview> {
  const { projects, log } = await fetchProjects();
  return computeWeeklyReview(log, projects.map(p => ({ id: p.id, name: p.name, quiet: p.quiet })));
}

// Edit a logged entry. Session entries have a composite `taskId:blockId` id —
// rewrite the body line and re-sum the task's duration. Legacy standalone rows
// (plain page id) still edit their Status Notes / Duration in place.
export async function updateActivityEntry(entryId: string, fields: { note?: string; durationSec?: number }) {
  if (entryId.includes(':')) {
    const [taskId, blockId] = entryId.split(':');
    const block: any = await client().blocks.retrieve({ block_id: blockId });
    const existing = parseSessionLine(blockText(block))
      || { createdAt: new Date().toISOString(), durationSec: 0, note: '', source: 'live' as const };
    const updated = {
      createdAt: existing.createdAt,
      durationSec: fields.durationSec != null ? fields.durationSec : existing.durationSec,
      note: fields.note != null ? fields.note : existing.note,
      source: existing.source,
    };
    const blockType: string = block.type;
    await client().blocks.update({
      block_id: blockId,
      [blockType]: { rich_text: [{ type: 'text', text: { content: formatSessionLine(updated) } }] },
    } as any);
    await recomputeDuration(taskId);
    bustCache();
    return;
  }

  const properties: Record<string, any> = {};
  if (fields.note != null) {
    properties['Status Notes'] = { rich_text: [{ text: { content: fields.note } }] };
    properties['Name'] = { title: [{ text: { content: fields.note.slice(0, 100) || 'Logged activity' } }] };
  }
  if (fields.durationSec != null) {
    properties['Duration (min)'] = { number: Math.round(fields.durationSec / 60) };
  }
  if (Object.keys(properties).length === 0) return;
  await client().pages.update({ page_id: entryId, properties });
  bustCache();
}

// Optional Claude-written copy for the skyline header and the gentle nudge,
// each read verbatim from its own Notion page: NOTION_SKYLINE_PAGE for the
// skyline subheading, NOTION_NUDGE_PAGE for the nudge body. A scheduled Claude
// task rewrites either page's content and the app picks it up. Lines whose
// trimmed text starts with `<!--` are treated as guidance comments and
// skipped; the rest are joined with newlines and trimmed.
async function fetchPageText(pageId: string | undefined): Promise<string | null> {
  if (!pageId || !env('NOTION_TOKEN')) return null;
  try {
    const lines: string[] = [];
    let cursor: string | undefined;
    do {
      const res: any = await client().blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 });
      for (const block of res.results as any[]) {
        const rt = block[block.type]?.rich_text;
        if (!rt) continue;
        const line = rt.map((t: any) => t.plain_text).join('').trim();
        if (line.startsWith('<!--')) continue;
        lines.push(line);
      }
      cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
    } while (cursor);
    const joined = lines.join('\n').trim();
    return joined || null;
  } catch {
    // Page missing or not shared — fall back to app-generated copy.
    return null;
  }
}

let narrativeCache: { at: number; value: { skyline: string | null; nudge: string | null } } | null = null;
export async function fetchNarrative(): Promise<{ skyline: string | null; nudge: string | null }> {
  if (narrativeCache && Date.now() - narrativeCache.at < 5 * 60 * 1000) return narrativeCache.value;
  const [skyline, nudge] = await Promise.all([
    fetchPageText(env('NOTION_SKYLINE_PAGE')),
    fetchPageText(env('NOTION_NUDGE_PAGE')),
  ]);
  const value = { skyline, nudge };
  narrativeCache = { at: Date.now(), value };
  return value;
}

// ---- Energy check-ins -------------------------------------------------------
// Check-ins are appended lines on NOTION_ENERGY_PAGE, the same pattern as
// session lines on a task page: Notion stays the system of record and Katie's
// scheduled Claude tasks can read the page later. When the env var is unset,
// both calls are graceful no-ops — the check-in UI hides and inference runs
// without self-report signals (same philosophy as fetchPageText).

export function isEnergyConfigured(): boolean {
  return !!(env('NOTION_TOKEN') && env('NOTION_ENERGY_PAGE'));
}

let energyCache: { at: number; entries: EnergyLine[] } | null = null;
const ENERGY_TTL_MS = 5 * 60 * 1000;

export async function appendEnergyLine(line: EnergyLine): Promise<void> {
  if (!isEnergyConfigured()) return;
  await client().blocks.children.append({
    block_id: env('NOTION_ENERGY_PAGE')!,
    children: [paragraph(formatEnergyLine(line))],
  });
  energyCache = null; // bust so the next read sees the new entry
}

// All parseable check-in lines on the page, newest first. Read errors (page
// missing or not shared) fall back quietly to an empty log.
export async function fetchEnergyLog(): Promise<EnergyLine[]> {
  if (!isEnergyConfigured()) return [];
  if (energyCache && Date.now() - energyCache.at < ENERGY_TTL_MS) return energyCache.entries;
  try {
    const entries: EnergyLine[] = [];
    let cursor: string | undefined;
    do {
      const res: any = await client().blocks.children.list({ block_id: env('NOTION_ENERGY_PAGE')!, start_cursor: cursor, page_size: 100 });
      for (const b of res.results as any[]) {
        const parsed = parseEnergyLine(blockText(b));
        if (parsed) entries.push(parsed);
      }
      cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
    } while (cursor);
    entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    energyCache = { at: Date.now(), entries };
    return entries;
  } catch {
    return [];
  }
}

export async function writeReorderEvent(projectId: string, newPriority: number, reason: string | null) {
  await ensureSchema();
  const properties: Record<string, any> = { 'Priority': { number: newPriority } };
  if (reason) properties['Last Reorder Reason'] = { rich_text: [{ text: { content: reason } }] };
  await client().pages.update({ page_id: projectId, properties });
  bustCache();
}

export async function updateProjectFields(projectId: string, fields: Partial<{
  name: string; blurb: string; nextStep: string; status: string; threshold: string; houseColor: string | null;
}>) {
  await ensureSchema();
  const properties: Record<string, any> = {};
  if (fields.name != null) properties['Name'] = { title: [{ text: { content: fields.name } }] };
  if (fields.blurb != null) properties['Description'] = { rich_text: [{ text: { content: fields.blurb } }] };
  if (fields.nextStep != null) properties['Next Step Override'] = { rich_text: [{ text: { content: fields.nextStep } }] };
  if (fields.status != null) properties['Status'] = { select: { name: fields.status } };
  if (fields.threshold != null) properties['Check-in threshold'] = { rich_text: [{ text: { content: fields.threshold } }] };
  if (fields.houseColor !== undefined) {
    properties['House Color'] = { rich_text: fields.houseColor ? [{ text: { content: fields.houseColor } }] : [] };
  }
  await client().pages.update({ page_id: projectId, properties });
  bustCache();
}

export async function archiveProject(projectId: string) {
  await client().pages.update({ page_id: projectId, properties: { 'Status': { select: { name: 'Archive' } } } });
  bustCache();
}

export async function createProject(fields: { name: string; priority: number }) {
  await ensureSchema();
  const page = await client().pages.create({
    parent: { database_id: PROJECTS_DB() },
    properties: {
      'Name': { title: [{ text: { content: fields.name } }] },
      'Priority': { number: fields.priority },
      'Status': { select: { name: 'Active' } },
      // Tag new projects Home/Personal so the Work-exclusion formula never
      // mis-files an app-created project as Work.
      'Type': { multi_select: [{ name: 'Home/Personal' }] },
      'Check-in threshold': { rich_text: [{ text: { content: '2 weeks' } }] },
    },
  });
  bustCache();
  return page.id;
}
