import { Client } from '@notionhq/client';
import type { ActivityLogEntry, Project } from '../types.js';
import {
  computeActivity, computeHoursThisWeek, computeQuiet, computeStature,
  computeTrend, computeWeek, findRecovery, parseThresholdDays
} from './derive.js';

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
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.round(days / 7)} week${Math.round(days / 7) === 1 ? '' : 's'} ago`;
  return then.toLocaleDateString([], { month: 'long', year: 'numeric' });
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
  source: string;
  createdTime: string;
}

async function fetchAllTasks(): Promise<TaskRow[]> {
  await ensureSchema();
  const rows = await queryAll(TASKS_DB());
  return rows.map((page: any) => {
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
      source: props['Source']?.select?.name || 'notion-task',
      createdTime: page.created_time,
    };
  });
}

const DONE_STATUSES = new Set(['Done', 'Irrelevant']);

function tasksToActivityLog(tasks: TaskRow[]): ActivityLogEntry[] {
  return tasks
    .filter(t => t.projectId && t.dateCompleted)
    .map(t => ({
      id: t.id,
      projectId: t.projectId as string,
      startedAt: null,
      endedAt: t.dateCompleted,
      durationSec: (t.durationMin || 0) * 60,
      note: t.statusNotes || t.name,
      source: (t.source === 'Live' ? 'live' : t.source === 'Manual' ? 'manual' : 'notion-task') as ActivityLogEntry['source'],
      createdAt: t.dateCompleted as string,
    }));
}

function pickNextStep(tasks: TaskRow[], projectId: string): { step: string; note: string; target: string } | null {
  const open = tasks.filter(t => t.projectId === projectId && !DONE_STATUSES.has(t.status));
  if (open.length === 0) return null;
  open.sort((a, b) => {
    if (a.due && b.due) return new Date(a.due).getTime() - new Date(b.due).getTime();
    if (a.due) return -1;
    if (b.due) return 1;
    return new Date(a.createdTime).getTime() - new Date(b.createdTime).getTime();
  });
  const top = open[0];
  const target = top.due ? new Date(top.due).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—';
  return { step: top.name, note: top.statusNotes || 'From your Master Task List', target };
}

export async function fetchProjects(): Promise<{ projects: Project[]; log: ActivityLogEntry[] }> {
  if (!isConfigured()) return { projects: [], log: [] };
  await ensureSchema();

  const [projectRows, tasks] = await Promise.all([queryAll(PROJECTS_DB()), fetchAllTasks()]);
  const log = tasksToActivityLog(tasks);

  const visible = projectRows.filter((page: any) => {
    const props = page.properties;
    if (isWorkRow(props)) return false;
    const status = select(props['Status']);
    return status === 'Active' || status === 'On Hold' || !status;
  });

  visible.sort((a: any, b: any) => (num(a.properties['Priority']) ?? 999) - (num(b.properties['Priority']) ?? 999));

  const total = visible.length;
  const projects: Project[] = visible.map((page: any, i: number) => {
    const props = page.properties;
    const projectLog = log.filter(e => e.projectId === page.id);
    const lastMovedAt = projectLog.reduce<string | null>((latest, e) => {
      if (!latest) return e.createdAt;
      return new Date(e.createdAt).getTime() > new Date(latest).getTime() ? e.createdAt : latest;
    }, null) || page.last_edited_time || null;

    const thresholdStr = text(props['Check-in threshold']) || '2 weeks';
    const thresholdDays = parseThresholdDays(thresholdStr);
    const activity = computeActivity(lastMovedAt, projectLog);
    const quiet = computeQuiet(lastMovedAt, thresholdDays);
    const nextOverride = text(props['Next Step Override']);
    const next = pickNextStep(tasks, page.id);

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
      activity: quiet ? Math.min(activity, 0.1) : activity,
      stature: computeStature(null, i + 1, total),
      trend: computeTrend(projectLog),
      quiet,
      week: computeWeek(log, page.id),
      hours: computeHoursThisWeek(log, page.id),
      recoveryNote: findRecovery(log, page.id, thresholdDays)?.note ?? null,
    };
  });

  return { projects, log };
}

export async function writeActivityLogEntry(entry: {
  projectId: string; note: string; durationSec: number; source: 'live' | 'manual';
  startedAt?: string; endedAt?: string;
}) {
  await ensureSchema();
  const now = entry.endedAt || new Date().toISOString();
  await client().pages.create({
    parent: { database_id: TASKS_DB() },
    properties: {
      'Name': { title: [{ text: { content: entry.note.slice(0, 100) || (entry.source === 'manual' ? 'Logged after the fact' : 'Live activity') } }] },
      'Project': { relation: [{ id: entry.projectId }] },
      'Status': { status: { name: 'Done' } },
      'Date Completed': { date: { start: now } },
      'Status Notes': { rich_text: [{ text: { content: entry.note } }] },
      'Duration (min)': { number: Math.round((entry.durationSec || 0) / 60) },
      'Source': { select: { name: entry.source === 'manual' ? 'Manual' : 'Live' } },
    },
  });
}

export async function writeReorderEvent(projectId: string, newPriority: number, reason: string | null) {
  await ensureSchema();
  const properties: Record<string, any> = { 'Priority': { number: newPriority } };
  if (reason) properties['Last Reorder Reason'] = { rich_text: [{ text: { content: reason } }] };
  await client().pages.update({ page_id: projectId, properties });
}

export async function updateProjectFields(projectId: string, fields: Partial<{
  name: string; blurb: string; nextStep: string; status: string;
}>) {
  await ensureSchema();
  const properties: Record<string, any> = {};
  if (fields.name != null) properties['Name'] = { title: [{ text: { content: fields.name } }] };
  if (fields.blurb != null) properties['Description'] = { rich_text: [{ text: { content: fields.blurb } }] };
  if (fields.nextStep != null) properties['Next Step Override'] = { rich_text: [{ text: { content: fields.nextStep } }] };
  if (fields.status != null) properties['Status'] = { select: { name: fields.status } };
  await client().pages.update({ page_id: projectId, properties });
}

export async function archiveProject(projectId: string) {
  await client().pages.update({ page_id: projectId, properties: { 'Status': { select: { name: 'Archive' } } } });
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
  return page.id;
}
