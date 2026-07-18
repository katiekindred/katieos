import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { api } from '../api';
import type { CalendarEvent, EnergyForecast, EnergyLevel, FeedEntry, FieldUpdate, Narrative, PickerField, Project, Summary, TaskLite, WeeklyReview } from '../types';
import Confetti from './Confetti';
import { HOUSE_COLORS, colorsFor } from './houseColors';
import NotionFieldDropdown from './NotionFieldDropdown';
import Skyline from './Skyline';
import { TREND_COLORS, trendWord } from './village';

const ACCENT = '#c96f4e';
const ACCENT_DARK = '#a5532f';
const ACCENT_SOFT = '#f3ead9';
const INK = '#4a3a2e';
const INK_SOFT = '#8d7a66';
const USER_NAME = 'Katie';
const LIVE_SESSION_KEY = 'katieos-live-session';

// Energy check-in strip: ask at most once per 4 hours. A skip parks the strip
// for the same window (persisted like the live-timer state, so a refresh
// doesn't re-ask); answering hides it until the next window.
const ENERGY_DISMISS_KEY = 'katieos-energy-dismissed';
const ENERGY_ASK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const ENERGY_DOTS: { level: EnergyLevel; color: string }[] = [
  { level: 'Green', color: '#7ebe8c' },
  { level: 'Yellow', color: '#e2b74e' },
  { level: 'Orange', color: '#e0906c' },
  { level: 'Red', color: '#b4453b' },
];

// The forecast nudge is template-composed from the forecast's reasons:
// evidence first, then one direct recommendation. Rotated deterministically by
// date so it doesn't read like a broken record.
function joinReasons(reasons: string[]): string {
  if (reasons.length <= 1) return reasons[0] ?? '';
  if (reasons.length === 2) return `${reasons[0]} and ${reasons[1]}`;
  return `${reasons.slice(0, -1).join(', ')}, and ${reasons[reasons.length - 1]}`;
}
const FORECAST_NUDGE_TEMPLATES: ((evidence: string) => string)[] = [
  ev => `${ev}. Recommend picking one project this week and parking the rest.`,
  ev => `${ev}. Cut the active list to one building and protect an evening of rest.`,
  ev => `${ev}. Pick the single project that matters most right now and let the others sit dark.`,
  ev => `${ev}. Book one short session on your top building and treat the rest of the week as recovery.`,
];
function forecastNudgeBody(f: EnergyForecast): string {
  const raw = joinReasons(f.reasons);
  const evidence = raw.charAt(0).toUpperCase() + raw.slice(1);
  const idx = Math.floor(Date.now() / 86400000) % FORECAST_NUDGE_TEMPLATES.length;
  return FORECAST_NUDGE_TEMPLATES[idx](evidence);
}

const DISPLAY_FONT = "'Fraunces', Georgia, serif";
const BODY_FONT = "'Nunito', system-ui, sans-serif";

type CapMode = 'idle' | 'picking' | 'running' | 'paused' | 'noting';

function fmtClock(s: number): string {
  const m = Math.floor(s / 60), ss = s % 60;
  return String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
}

// "4h" → 4 hours, "45m" or bare "45" → minutes, "1h 30m" / "1.5h" also work.
function parseDurationSec(raw: string): number {
  let total = 0;
  for (const m of (raw || '').matchAll(/(\d+(?:\.\d+)?)\s*(h(?:ours?|rs?)?|m(?:in(?:ute)?s?)?)?/gi)) {
    const n = parseFloat(m[1]);
    const unit = (m[2] || 'm').toLowerCase();
    total += unit.startsWith('h') ? n * 3600 : n * 60;
  }
  return Math.round(total);
}

function fmtDur(sec: number): string {
  if (!sec) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  return m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

const input: CSSProperties = {
  width: '100%', fontFamily: 'inherit', fontSize: '12.5px', color: INK,
  padding: '9px 12px', border: '2px solid #ecdcc5', borderRadius: '12px', outline: 'none', background: '#fff',
};

const dropLineStyle: CSSProperties = {
  height: '3px', borderRadius: '2px', background: ACCENT, flex: '0 0 auto',
  boxShadow: '0 0 0 4px rgba(201,111,78,.15)',
};

const taskChip = (selected: boolean): CSSProperties => ({
  cursor: 'pointer', fontSize: '11.5px', fontWeight: 800, padding: '6px 10px', borderRadius: '10px',
  maxWidth: '190px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  background: selected ? 'var(--ac)' : '#fff', color: selected ? '#fff' : INK,
  border: selected ? '2px solid var(--ac)' : '2px solid #ecdcc5', transition: 'all .15s',
});

const stickerCard: CSSProperties = {
  background: '#fffdf8', border: '2px solid #f0e2cf', borderRadius: '24px',
  padding: '24px 24px 20px', boxShadow: '0 5px 0 #f0e2cf',
};

// The Notion fields the logger can set on a task: Importance + Urgency + Status
// (colored option pickers) and Status Notes (free text). Populated from the task
// when it exists, blank for a new stub.
interface Fields { importance: string | null; urgency: string | null; status: string | null; statusNotes: string }
const BLANK_FIELDS: Fields = { importance: null, urgency: null, status: null, statusNotes: '' };
const fieldLabel: CSSProperties = { fontSize: '11px', color: INK_SOFT, marginBottom: '5px', fontWeight: 700 };

// Module-scope so the Status Notes text input keeps focus across keystrokes.
function TaskFieldEditors({ schema, fields, onChange }: { schema: PickerField[]; fields: Fields; onChange: (f: Fields) => void }) {
  if (schema.length === 0) return null;
  const importance = schema.find(f => f.name === 'Importance');
  const urgency = schema.find(f => f.name === 'Urgency');
  const status = schema.find(f => f.name === 'Status');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
      {importance && (
        <div>
          <div style={fieldLabel}>Importance</div>
          <NotionFieldDropdown field={importance} value={fields.importance ? [fields.importance] : []} onChange={ids => onChange({ ...fields, importance: ids[0] ?? null })} />
        </div>
      )}
      {urgency && (
        <div>
          <div style={fieldLabel}>Urgency</div>
          <NotionFieldDropdown field={urgency} value={fields.urgency ? [fields.urgency] : []} onChange={ids => onChange({ ...fields, urgency: ids[0] ?? null })} />
        </div>
      )}
      {status && (
        <div>
          <div style={fieldLabel}>Status</div>
          <NotionFieldDropdown field={status} value={fields.status ? [fields.status] : []} onChange={ids => onChange({ ...fields, status: ids[0] ?? null })} />
        </div>
      )}
      <div>
        <div style={fieldLabel}>Status notes</div>
        <input value={fields.statusNotes} onChange={e => onChange({ ...fields, statusNotes: e.target.value })} placeholder="Where it's at / why it's parked…" style={input} />
      </div>
    </div>
  );
}

// Which fields differ from the task's current values — only those get written.
// statusType is the Notion property kind for "Status" (a status-type property in
// Katie's DB, but tolerant of a select), read from the live schema.
function fieldUpdates(draft: Fields, orig: Fields, statusType: 'select' | 'status' = 'status'): FieldUpdate[] {
  const u: FieldUpdate[] = [];
  if ((draft.importance ?? null) !== (orig.importance ?? null)) u.push({ name: 'Importance', type: 'select', optionIds: draft.importance ? [draft.importance] : [] });
  if ((draft.urgency ?? null) !== (orig.urgency ?? null)) u.push({ name: 'Urgency', type: 'select', optionIds: draft.urgency ? [draft.urgency] : [] });
  if ((draft.status ?? null) !== (orig.status ?? null)) u.push({ name: 'Status', type: statusType, optionIds: draft.status ? [draft.status] : [] });
  if ((draft.statusNotes ?? '') !== (orig.statusNotes ?? '')) u.push({ name: 'Status Notes', type: 'text', text: draft.statusNotes });
  return u;
}

interface ProjectDraft { name: string; blurb: string; threshold: string; nextStep: string; houseColor: string | null; colorHexInput: string }

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [calendar, setCalendar] = useState<CalendarEvent[]>([]);
  const [calendarState, setCalendarState] = useState<'idle' | 'unconfigured' | 'unauthorized' | 'ready'>('idle');
  const [calendarAuthUrl, setCalendarAuthUrl] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);

  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [reorderMsg, setReorderMsg] = useState<string | null>(null);
  const [reorderOrder, setReorderOrder] = useState<string[] | null>(null);
  const [reorderReason, setReorderReason] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProjectDraft | null>(null);

  const [capMode, setCapMode] = useState<CapMode>('idle');
  const [capProject, setCapProject] = useState<string | null>(null);
  const [capSeconds, setCapSeconds] = useState(0);
  const [capNote, setCapNote] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Timer accounting that survives pause/resume: seconds banked from finished
  // run segments, plus the wall-clock start of the current running segment
  // (null while paused). Elapsed = accum + (now − segStart) when running.
  const accumRef = useRef(0);
  const segStartRef = useRef<number | null>(null);
  const [capMarkDone, setCapMarkDone] = useState(false);

  const [manProject, setManProject] = useState<string | null>(null);
  const [manDur, setManDur] = useState('');
  const [manNote, setManNote] = useState('');

  const [editingFeedId, setEditingFeedId] = useState<string | null>(null);
  const [feedDraft, setFeedDraft] = useState<{ dur: string; note: string }>({ dur: '', note: '' });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [narrative, setNarrative] = useState<Narrative | null>(null);
  const [confettiBurst, setConfettiBurst] = useState(0);

  // Energy layer: whether check-ins are configured server-side, the latest
  // check-in time, the local "skipped at" stamp, a brief thanks flash after
  // answering, and the current forecast.
  const [energyAvailable, setEnergyAvailable] = useState(false);
  const [lastCheckinAt, setLastCheckinAt] = useState<string | null>(null);
  const [energyDismissedAt, setEnergyDismissedAt] = useState<number>(() => Number(localStorage.getItem(ENERGY_DISMISS_KEY)) || 0);
  const [energyNote, setEnergyNote] = useState('');
  const [energyThanks, setEnergyThanks] = useState(false);
  const [forecast, setForecast] = useState<EnergyForecast | null>(null);

  // Open tasks per project, plus which project's task list is expanded and the
  // task a session should attach to (null = the project's next step; 'NEW' = a
  // fresh stub the app creates for Katie to flesh out).
  const [tasks, setTasks] = useState<TaskLite[]>([]);
  const [expandedTasks, setExpandedTasks] = useState<string | null>(null);
  const [newTaskName, setNewTaskName] = useState('');
  const [capTaskId, setCapTaskId] = useState<string | null>(null);
  const [manTaskId, setManTaskId] = useState<string | null>(null);
  const [review, setReview] = useState<WeeklyReview | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  // Notion field schema (options + colors) and the per-flow field drafts, with
  // the task's original values so only real changes get written on save.
  const [schema, setSchema] = useState<PickerField[]>([]);
  const [capFields, setCapFields] = useState<Fields>(BLANK_FIELDS);
  const [capOrig, setCapOrig] = useState<Fields>(BLANK_FIELDS);
  const [manFields, setManFields] = useState<Fields>(BLANK_FIELDS);
  const [manOrig, setManOrig] = useState<Fields>(BLANK_FIELDS);

  function celebrate() {
    setConfettiBurst(Date.now());
  }

  const tasksFor = (projectId: string | null) =>
    tasks.filter(t => t.projectId === projectId)
      .sort((a, b) => (b.priorityCalc ?? -Infinity) - (a.priorityCalc ?? -Infinity));

  // Current field values of a task (for populating the editors), or blanks.
  const fieldsOfTask = (taskId: string | null): Fields => {
    const t = taskId ? tasks.find(x => x.id === taskId) : null;
    if (!t) return { ...BLANK_FIELDS };
    const statusId = statusField?.options.find(o => o.name === t.status)?.id ?? null;
    return { importance: t.importanceId, urgency: t.urgencyId, status: statusId, statusNotes: t.statusNotes };
  };
  // The task a session will actually land on: an explicit pick, else the
  // project's next step, else none (a new stub will be created).
  const effectiveTaskId = (sel: string | null, projectId: string | null): string | null => {
    if (sel === 'NEW') return null;
    if (sel) return sel;
    return tasks.find(t => t.projectId === projectId && t.isNextStep)?.id ?? null;
  };

  // The Notion "Status" property (a status-type field), pulled from the live
  // schema so the task list can offer its exact options and colors.
  const statusField = schema.find(f => f.name === 'Status') ?? null;

  const heroRef = useRef<HTMLDivElement>(null);
  const priorityRef = useRef<HTMLDivElement>(null);

  const loadProjects = useCallback(async () => {
    try {
      const list = await api.projects();
      setProjects(list);
      setLoadError(null);
      if (!manProject && list.length) setManProject(list[0].id);
    } catch (e: any) {
      setLoadError(e.message);
    } finally {
      setLoaded(true);
    }
  }, [manProject]);

  const loadCalendar = useCallback(async () => {
    try {
      const events = await api.calendar();
      setCalendar(events);
      setCalendarState('ready');
    } catch (e: any) {
      if (e.message?.includes('not configured')) setCalendarState('unconfigured');
      else {
        setCalendarState('unauthorized');
        setCalendarAuthUrl('/api/auth/google');
      }
    }
  }, []);

  const loadFeed = useCallback(async () => {
    try { setFeed(await api.feed()); } catch { /* non-fatal */ }
  }, []);

  const loadNarrative = useCallback(async () => {
    try { setNarrative(await api.narrative()); } catch { /* non-fatal */ }
  }, []);

  const loadTasks = useCallback(async () => {
    try { setTasks(await api.tasks()); } catch { /* non-fatal */ }
  }, []);

  const loadReview = useCallback(async () => {
    try { setReview(await api.weeklyReview()); } catch { /* non-fatal */ }
  }, []);

  const loadSummary = useCallback(async () => {
    try { setSummary(await api.summary()); } catch { /* non-fatal */ }
  }, []);

  const loadSchema = useCallback(async () => {
    try { setSchema(await api.taskSchema()); } catch { /* non-fatal */ }
  }, []);

  // A 503 means NOTION_ENERGY_PAGE isn't set — the strip stays hidden.
  const loadEnergy = useCallback(async () => {
    try {
      const entries = await api.energyLog(1);
      setEnergyAvailable(true);
      setLastCheckinAt(entries[0]?.createdAt ?? null);
    } catch { setEnergyAvailable(false); }
  }, []);

  const loadForecast = useCallback(async () => {
    try { setForecast(await api.energyForecast()); } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    loadProjects(); loadCalendar(); loadFeed(); loadNarrative(); loadTasks(); loadReview(); loadSchema(); loadSummary(); loadEnergy(); loadForecast();
    const t = setInterval(() => { loadProjects(); loadCalendar(); loadFeed(); loadNarrative(); loadTasks(); loadReview(); loadSummary(); loadEnergy(); loadForecast(); }, 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Populate the manual-log field editors once, when the default project and its
  // tasks have loaded. After that, project/task clicks drive repopulation, so a
  // background refresh never clobbers what you're editing.
  const manInitRef = useRef(false);
  useEffect(() => {
    if (!manInitRef.current && manProject && tasks.length) {
      manInitRef.current = true;
      const f = fieldsOfTask(effectiveTaskId(null, manProject));
      setManFields(f); setManOrig(f);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manProject, tasks]);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  // Resume a live session that survived a refresh or closed tab.
  useEffect(() => {
    const raw = localStorage.getItem(LIVE_SESSION_KEY);
    if (!raw) return;
    try {
      const s = JSON.parse(raw);
      if (!s.projectId) { localStorage.removeItem(LIVE_SESSION_KEY); return; }
      // Current shape: { projectId, accumSec, segStartedAt } (segStartedAt null
      // while paused). Legacy shape: { projectId, startedAt } — a running segment.
      if (typeof s.accumSec === 'number') startTicking(s.projectId, s.accumSec, typeof s.segStartedAt === 'number' ? s.segStartedAt : null);
      else if (typeof s.startedAt === 'number') startTicking(s.projectId, 0, s.startedAt);
      else localStorage.removeItem(LIVE_SESSION_KEY);
    } catch { localStorage.removeItem(LIVE_SESSION_KEY); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- energy check-in -----
  async function onEnergyCheckin(level: EnergyLevel) {
    const note = energyNote;
    setEnergyNote('');
    setEnergyThanks(true);
    setLastCheckinAt(new Date().toISOString());
    window.setTimeout(() => setEnergyThanks(false), 2500);
    try {
      await api.logEnergy(level, note);
      setSaveError(null);
      loadForecast();
    } catch (e: any) {
      setSaveError(`That check-in didn't reach Notion (${e.message}). It's not saved.`);
    }
  }
  function onEnergySkip() {
    const at = Date.now();
    localStorage.setItem(ENERGY_DISMISS_KEY, String(at));
    setEnergyDismissedAt(at);
  }
  // Show only when configured, the latest check-in is older than the ask
  // window, and it wasn't skipped within the same window. A skipped check-in
  // is weak signal — it never reads as Red anywhere downstream.
  const lastCheckinMs = lastCheckinAt ? new Date(lastCheckinAt).getTime() : 0;
  const showEnergyStrip = energyAvailable && (energyThanks || (
    Date.now() - lastCheckinMs >= ENERGY_ASK_INTERVAL_MS &&
    Date.now() - energyDismissedAt >= ENERGY_ASK_INTERVAL_MS
  ));

  const now = new Date();
  const h = now.getHours();
  const greeting = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const dateStr = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  // ----- reorder -----
  function onDragOverCard(i: number) {
    return (e: React.DragEvent) => {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const isAbove = e.clientY < rect.top + rect.height / 2;
      setDragOverIndex(isAbove ? i : i + 1);
    };
  }
  function onDrop() {
    if (!dragId || dragOverIndex === null) { setDragId(null); setDragOverIndex(null); return; }
    const order = projects.map(p => p.id);
    const from = order.indexOf(dragId);
    const insertAt = dragOverIndex > from ? dragOverIndex - 1 : dragOverIndex;
    setDragId(null);
    setDragOverIndex(null);
    if (insertAt === from) return;
    order.splice(from, 1);
    order.splice(insertAt, 0, dragId);
    const reordered = order.map(id => projects.find(p => p.id === id)!);
    setProjects(reordered);
    const moved = reordered.find(p => p.id === dragId)!;
    const newRank = order.indexOf(dragId) + 1;
    setReorderMsg(`${moved.name} moved to #${newRank}. Logged to Notion.`);
    setReorderOrder(order);
    setReorderReason('');
    api.reorder(order, null).catch(() => setReorderMsg('Reorder failed to save — try again.'));
  }
  function submitReorderReason() {
    const reason = reorderReason.trim();
    if (!reason || !reorderOrder) return;
    api.reorder(reorderOrder, reason).catch(() => setReorderMsg('Reorder failed to save — try again.'));
    setReorderMsg(prev => (prev ? prev.replace(/Logged to Notion\.?$/, 'Logged to Notion with your reason.') : prev));
    setReorderOrder(null);
    setReorderReason('');
  }

  // ----- edit / add / remove -----
  function startEdit(p: Project) {
    setEditingId(p.id);
    const hex = p.houseColor && HEX_RE.test(p.houseColor) ? (p.houseColor.startsWith('#') ? p.houseColor : `#${p.houseColor}`) : '';
    setDraft({ name: p.name, blurb: p.blurb, threshold: p.threshold, nextStep: p.nextStep, houseColor: p.houseColor ?? null, colorHexInput: hex });
  }
  async function saveEdit(id: string) {
    if (!draft) return;
    setEditingId(null);
    setProjects(ps => ps.map(p => p.id === id ? { ...p, name: draft.name, blurb: draft.blurb, nextStep: draft.nextStep, houseColor: draft.houseColor } : p));
    try {
      await api.updateProject(id, { name: draft.name, blurb: draft.blurb, nextStep: draft.nextStep, houseColor: draft.houseColor });
      setSaveError(null);
    } catch (e: any) {
      setSaveError(`Couldn't save project changes to Notion: ${e.message}`);
    }
    loadProjects();
  }
  async function removeProject(id: string) {
    const name = projects.find(p => p.id === id)?.name || 'this project';
    if (!window.confirm(`Archive "${name}"? It moves to Status: Archive in Notion (nothing is deleted).`)) return;
    setEditingId(null);
    setProjects(ps => ps.filter(p => p.id !== id));
    try { await api.removeProject(id); } catch (e: any) { setSaveError(`Couldn't archive in Notion: ${e.message}`); loadProjects(); }
  }
  async function addProject() {
    const priority = projects.length + 1;
    const { id } = await api.createProject('New building', priority);
    await loadProjects();
    startEdit({ id, name: 'New building', blurb: '', threshold: '2 weeks', nextStep: '', houseColor: null } as Project);
  }

  // ----- timer -----
  // The clock is computed from wall-clock timestamps (not tick counting), so it
  // stays honest through background-tab throttling. Pause banks the elapsed
  // seconds into `accum` and drops the segment start; resume opens a new segment.
  // The whole state is mirrored to localStorage so a refresh or closed tab keeps
  // the session — paused or running.
  function computeElapsed(accumSec: number, segStartedAt: number | null): number {
    return segStartedAt ? accumSec + Math.floor((Date.now() - segStartedAt) / 1000) : accumSec;
  }
  function persistLive(projectId: string, accumSec: number, segStartedAt: number | null) {
    localStorage.setItem(LIVE_SESSION_KEY, JSON.stringify({ projectId, accumSec, segStartedAt }));
  }
  function startTicking(projectId: string, accumSec: number, segStartedAt: number | null) {
    accumRef.current = accumSec;
    segStartRef.current = segStartedAt;
    setCapProject(projectId);
    setCapMode(segStartedAt ? 'running' : 'paused');
    setCapSeconds(computeElapsed(accumSec, segStartedAt));
    if (timerRef.current) clearInterval(timerRef.current);
    if (segStartedAt) timerRef.current = setInterval(() => setCapSeconds(computeElapsed(accumRef.current, segStartRef.current)), 1000);
  }
  function onStart() { setCapMode('picking'); setCapSeconds(0); setCapNote(''); setCapTaskId(null); setCapMarkDone(false); }
  function pick(id: string) {
    const segStartedAt = Date.now();
    setCapTaskId(null);
    persistLive(id, 0, segStartedAt);
    startTicking(id, 0, segStartedAt);
  }
  function onPause() {
    if (!capProject) return;
    if (timerRef.current) clearInterval(timerRef.current);
    const banked = computeElapsed(accumRef.current, segStartRef.current);
    accumRef.current = banked;
    segStartRef.current = null;
    setCapSeconds(banked);
    setCapMode('paused');
    persistLive(capProject, banked, null);
  }
  function onResume() {
    if (!capProject) return;
    const segStartedAt = Date.now();
    persistLive(capProject, accumRef.current, segStartedAt);
    startTicking(capProject, accumRef.current, segStartedAt);
  }
  function onStop() {
    if (timerRef.current) clearInterval(timerRef.current);
    setCapSeconds(computeElapsed(accumRef.current, segStartRef.current));
    segStartRef.current = null;
    const f = fieldsOfTask(effectiveTaskId(capTaskId, capProject));
    setCapFields(f); setCapOrig(f);
    setCapMode('noting');
  }
  // Pick which task a session attaches to, repopulating the field editors from
  // that task's current values (or blanks for a new stub).
  function chooseCapTask(sel: string | null) {
    setCapTaskId(sel);
    const f = fieldsOfTask(effectiveTaskId(sel, capProject));
    setCapFields(f); setCapOrig(f);
  }
  function chooseManTask(sel: string | null) {
    setManTaskId(sel);
    const f = fieldsOfTask(effectiveTaskId(sel, manProject));
    setManFields(f); setManOrig(f);
  }
  function chooseManProject(id: string) {
    setManProject(id); setManTaskId(null);
    const f = fieldsOfTask(effectiveTaskId(null, id));
    setManFields(f); setManOrig(f);
  }
  function onDiscard() {
    if (timerRef.current) clearInterval(timerRef.current);
    localStorage.removeItem(LIVE_SESSION_KEY);
    accumRef.current = 0; segStartRef.current = null;
    setCapMode('idle'); setCapProject(null); setCapSeconds(0); setCapNote(''); setCapTaskId(null); setCapMarkDone(false);
  }
  // taskId: an explicit task, or null for the project's next step, or 'NEW' to
  // force a fresh stub. Translate that into the log request shape.
  function attachment(taskId: string | null): { taskId?: string | null; newTask?: boolean } {
    if (taskId === 'NEW') return { newTask: true };
    if (taskId) return { taskId };
    return {};
  }
  async function onSaveSession() {
    if (!capProject) return;
    const p = projects.find(pr => pr.id === capProject);
    const note = capNote || 'Worked a little.';
    const durSec = capSeconds;
    const taskSel = capTaskId;
    const fDraft = capFields, fOrig = capOrig;
    const markDone = capMarkDone;
    localStorage.removeItem(LIVE_SESSION_KEY);
    accumRef.current = 0; segStartRef.current = null;
    setFeed(f => [{ id: '', project: p?.name || '', note, when: 'Just now', dur: fmtDur(durSec), durationSec: durSec }, ...f]);
    setCapMode('idle'); setCapProject(null); setCapSeconds(0); setCapNote(''); setCapTaskId(null); setCapMarkDone(false);
    setCapFields(BLANK_FIELDS); setCapOrig(BLANK_FIELDS);
    try {
      const res = await api.logActivity({ projectId: capProject, ...attachment(taskSel), note, durationSec: durSec, source: 'live' });
      const updates = fieldUpdates(fDraft, fOrig, statusField?.type === 'select' ? 'select' : 'status');
      if (res?.taskId && updates.length) await api.updateTaskFields(res.taskId, updates);
      if (res?.taskId && markDone) await api.completeTask(res.taskId);
      setSaveError(null);
      celebrate();
    } catch (e: any) {
      setSaveError(`That session didn't reach Notion (${e.message}). It's not saved — log it again below.`);
    }
    loadProjects(); loadFeed(); loadTasks(); loadReview(); loadSummary();
  }
  async function onAddManual() {
    if (!manProject) return;
    const p = projects.find(pr => pr.id === manProject);
    const note = manNote || 'Logged after the fact.';
    const durSec = parseDurationSec(manDur);
    const taskSel = manTaskId;
    const fDraft = manFields, fOrig = manOrig;
    setFeed(f => [{ id: '', project: p?.name || '', note, when: 'Just now', dur: fmtDur(durSec), durationSec: durSec }, ...f]);
    setManDur(''); setManNote('');
    try {
      const res = await api.logActivity({ projectId: manProject, ...attachment(taskSel), note, durationSec: durSec, source: 'manual' });
      const updates = fieldUpdates(fDraft, fOrig, statusField?.type === 'select' ? 'select' : 'status');
      if (res?.taskId && updates.length) await api.updateTaskFields(res.taskId, updates);
      setSaveError(null);
      celebrate();
    } catch (e: any) {
      setSaveError(`That entry didn't reach Notion (${e.message}). It's not saved — try again.`);
    }
    setManFields(BLANK_FIELDS); setManOrig(BLANK_FIELDS);
    loadProjects(); loadFeed(); loadTasks(); loadReview(); loadSummary();
  }

  // ----- tasks -----
  async function completeTaskById(id: string) {
    setTasks(ts => ts.filter(t => t.id !== id));
    try { await api.completeTask(id); setSaveError(null); }
    catch (e: any) { setSaveError(`Couldn't complete that task in Notion: ${e.message}`); loadTasks(); }
    loadProjects(); loadFeed(); loadReview();
  }
  // Set a task's Notion Status to any option (the dropdown in the task list).
  // Optimistically reflect the new status name; loadTasks reconciles — a task
  // moved to a Done status drops off the open list on the next refresh.
  async function setTaskStatus(taskId: string, optionIds: string[]) {
    const optId = optionIds[0] ?? null;
    const name = statusField?.options.find(o => o.id === optId)?.name;
    setTasks(ts => ts.map(t => t.id === taskId ? { ...t, status: name ?? t.status } : t));
    try {
      await api.updateTaskFields(taskId, [{ name: 'Status', type: statusField?.type === 'select' ? 'select' : 'status', optionIds: optId ? [optId] : [] }]);
      setSaveError(null);
    } catch (e: any) {
      setSaveError(`Couldn't update that task's status in Notion: ${e.message}`);
    }
    loadTasks(); loadProjects(); loadReview();
  }
  async function addTaskTo(projectId: string) {
    const name = newTaskName.trim();
    if (!name) return;
    setNewTaskName('');
    try { await api.createTask(projectId, name); setSaveError(null); }
    catch (e: any) { setSaveError(`Couldn't add that task in Notion: ${e.message}`); }
    loadTasks();
  }

  // ----- edit a logged entry -----
  function startFeedEdit(f: FeedEntry) {
    setEditingFeedId(f.id);
    setFeedDraft({ dur: f.durationSec ? fmtDur(f.durationSec) : '', note: f.note });
  }
  async function saveFeedEdit(id: string) {
    const durationSec = parseDurationSec(feedDraft.dur);
    const note = feedDraft.note;
    setEditingFeedId(null);
    setFeed(fs => fs.map(f => f.id === id ? { ...f, note, durationSec, dur: fmtDur(durationSec) } : f));
    try {
      await api.updateActivity(id, { note, durationSec });
      setSaveError(null);
    } catch (e: any) {
      setSaveError(`Couldn't update that entry in Notion: ${e.message}`);
    }
    loadProjects(); loadFeed();
  }

  // Nudge precedence: Claude-written copy, else the forecast nudge when the
  // weather is clouding or storm (evidence, then a direct recommendation),
  // else the quiet-project fallback.
  const quietProject = projects.find(p => p.quiet);
  const nudge = narrative?.nudge
    ? { body: narrative.nudge }
    : forecast && forecast.weather !== 'clear' && forecast.reasons.length > 0
      ? { body: forecastNudgeBody(forecast) }
      : quietProject
        ? {
          body: `The ${quietProject.name} house misses you — it’s been dark since ${quietProject.lastMoved}. ${quietProject.recoveryNote
            ? `Last time, ${quietProject.recoveryNote}.`
            : 'Even a ten-minute visit would light a window.'}`,
        }
        : { body: 'Nothing is drifting right now. Every house has had a visitor lately — lovely work.' };

  const roadmap = projects.filter(p => p.nextStep).map(p => ({ step: p.nextStep, project: p.name, target: p.nextTarget || '—' }));

  const stickers = summary ? [
    { big: `${summary.streakDays}-day`, label: 'streak', dot: '#e0906c' },
    { big: `${summary.hoursThisWeek % 1 === 0 ? summary.hoursThisWeek : summary.hoursThisWeek.toFixed(1)}h`, label: 'this week', dot: '#8fb387' },
    { big: String(summary.visitsThisMonth), label: 'visits this month', dot: '#a48cc9' },
  ] : [];

  const rootStyle: CSSProperties = {
    ['--ac' as string]: ACCENT, ['--ac-soft' as string]: ACCENT_SOFT,
    minHeight: '100vh', fontFamily: BODY_FONT, background: '#f2e0c8',
  };

  return (
    <div style={rootStyle}>
      {confettiBurst > 0 && <Confetti burstId={confettiBurst} />}
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '34px 30px 90px', display: 'flex', flexDirection: 'column', gap: '24px' }}>

        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '20px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: '36px', lineHeight: 1.05, color: INK }}>{greeting}, {USER_NAME}</div>
            <div style={{ fontSize: '14px', color: INK_SOFT, marginTop: '6px', fontWeight: 600 }}>{dateStr} · welcome back!</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {stickers.map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#fffdf8', border: '2px solid #f0e2cf', borderRadius: '16px', padding: '8px 14px', boxShadow: '0 3px 0 #f0e2cf' }}>
                <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: s.dot }} />
                <span style={{ fontSize: '12.5px', fontWeight: 800, color: INK }}>{s.big}</span>
                <span style={{ fontSize: '11.5px', color: INK_SOFT, fontWeight: 600 }}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        {showEnergyStrip && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', background: '#fffdf8', border: '2px solid #f0e2cf', borderRadius: '18px', padding: '11px 16px', boxShadow: '0 3px 0 #f0e2cf', animation: 'wf-in .3s ease both' }}>
            {energyThanks ? (
              <span style={{ fontSize: '13px', fontWeight: 800, color: INK }}>Logged.</span>
            ) : (
              <>
                <span style={{ fontSize: '12.5px', fontWeight: 800, color: INK, whiteSpace: 'nowrap' }}>Energy check</span>
                <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
                  {ENERGY_DOTS.map(d => (
                    <div key={d.level} onClick={() => onEnergyCheckin(d.level)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '7px', padding: '6px 12px', borderRadius: '12px', background: '#fff', border: '2px solid #ecdcc5' }}>
                      <span style={{ width: '11px', height: '11px', borderRadius: '50%', background: d.color }} />
                      <span style={{ fontSize: '12px', fontWeight: 800, color: INK }}>{d.level}</span>
                    </div>
                  ))}
                </div>
                <input value={energyNote} onChange={e => setEnergyNote(e.target.value)} placeholder="Note, optional" style={{ ...input, flex: 1, minWidth: '150px', maxWidth: '280px', fontSize: '12px', padding: '7px 11px' }} />
                <div onClick={onEnergySkip} style={{ cursor: 'pointer', fontSize: '11px', fontWeight: 800, color: '#a8927a', padding: '5px 11px', border: '2px solid #f0e2cf', borderRadius: '10px', whiteSpace: 'nowrap' }}>Skip</div>
              </>
            )}
          </div>
        )}

        {loadError && (
          <div style={{ background: '#fdf1ef', border: '2px solid #f3d3cc', color: '#9a3b2a', borderRadius: '14px', padding: '12px 16px', fontSize: '13px', fontWeight: 600 }}>
            {loadError}
          </div>
        )}

        <div ref={heroRef} style={{ minHeight: '780px' }}>
          {!loaded && (
            <div style={{ height: '780px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '26px', background: '#e8d3ae', color: INK_SOFT, fontSize: '13.5px', fontWeight: 600 }}>
              Loading your skyline from Notion…
            </div>
          )}
          {loaded && projects.length > 0 && <Skyline projects={projects} truthOverride={narrative?.skyline ?? null} energyWeather={forecast?.weather ?? 'clear'} onRequestReorder={() => priorityRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: '24px', alignItems: 'start' }}>

          <div ref={priorityRef} style={stickerCard}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <div style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: '21px', color: INK }}>Your Buildings</div>
              <div style={{ fontSize: '11px', color: '#a8927a', fontWeight: 700 }}>drag to shuffle the queue</div>
            </div>

            {reorderMsg && (
              <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '9px', background: '#f3ead9', border: '2px solid #e8d7bd', borderRadius: '14px', padding: '9px 13px', animation: 'wf-in .3s ease both' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: ACCENT, flex: '0 0 auto' }} />
                  <span style={{ fontSize: '12px', color: '#7a5c3e', fontWeight: 700 }}>{reorderMsg}</span>
                </div>
                {reorderOrder && (
                  <div style={{ display: 'flex', gap: '7px' }}>
                    <input
                      value={reorderReason}
                      onChange={e => setReorderReason(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && submitReorderReason()}
                      placeholder="Add a reason (optional)…"
                      style={{ ...input, flex: 1, fontSize: '12px', padding: '7px 10px' }}
                    />
                    <div onClick={submitReorderReason} style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 800, color: '#a06a2e', background: '#fff', border: '2px solid #e8d7bd', borderRadius: '11px', padding: '7px 13px', whiteSpace: 'nowrap' }}>Add</div>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}>
              {projects.map((p, i) => {
                const dragging = dragId === p.id;
                const editing = editingId === p.id;
                const colors = colorsFor(p.houseColor, p.id);
                const word = trendWord(p);
                const tc = TREND_COLORS[word];
                const cardStyle: CSSProperties = {
                  border: dragging ? `2px solid ${ACCENT}` : (editing ? '2px solid #e8d7bd' : '2px solid #f3e8d6'),
                  background: dragging ? '#fdf4ec' : (editing ? '#fdfaf3' : '#ffffff'),
                  borderRadius: '18px', padding: editing ? '15px 16px' : '13px 15px',
                  boxShadow: dragging ? '0 12px 26px rgba(201,111,78,.2)' : '0 2px 0 rgba(150,110,70,.08)',
                  cursor: editing ? 'default' : 'grab', transition: 'box-shadow .2s, border-color .2s, background .2s',
                };
                return (
                  <Fragment key={p.id}>
                    {dragId && dragOverIndex === i && <div style={dropLineStyle} />}
                    <div draggable={!editing}
                      onDragStart={() => setDragId(p.id)}
                      onDragOver={onDragOverCard(i)}
                      onDrop={onDrop}
                      onDragEnd={() => { setDragId(null); setDragOverIndex(null); }}
                      style={cardStyle}>
                    {!editing ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '13px' }}>
                        <div style={{ width: '30px', height: '30px', borderRadius: '10px', background: colors.body, flex: '0 0 auto', boxShadow: 'inset 0 -3px 0 rgba(70,45,20,.15)' }} />
                        <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#f3ead9', color: '#a06a2e', fontSize: '12px', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{i + 1}</div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '15px', fontWeight: 600, color: INK }}>{p.name}</span>
                            <span style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: tc.fg, background: tc.bg, border: `2px solid ${tc.bd}`, borderRadius: '20px', padding: '2px 9px' }}>{word}</span>
                          </div>
                          <div style={{ fontSize: '11.5px', color: '#a8927a', marginTop: '2px', fontWeight: 600 }}>last visited {p.lastMoved}</div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flex: '0 0 auto' }}>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            {p.week.map((on, di) => (
                              <span key={di} style={{ width: '10px', height: '10px', borderRadius: '50%', background: on ? colors.shade : '#eee3d0', display: 'inline-block' }} />
                            ))}
                          </div>
                          <div style={{ fontSize: '11px', color: INK_SOFT, fontWeight: 600 }}><b style={{ color: INK }}>{p.hours === 0 ? '0h' : `${p.hours}h`}</b> this week</div>
                        </div>
                        <div onClick={() => setExpandedTasks(v => (v === p.id ? null : p.id))} style={{ cursor: 'pointer', fontSize: '11px', fontWeight: 800, color: expandedTasks === p.id ? ACCENT : '#a8927a', padding: '5px 10px', border: `2px solid ${expandedTasks === p.id ? '#e8d7bd' : '#f0e2cf'}`, borderRadius: '10px', flex: '0 0 auto', whiteSpace: 'nowrap' }}>{tasksFor(p.id).length} task{tasksFor(p.id).length === 1 ? '' : 's'}</div>
                        <div onClick={() => startEdit(p)} style={{ cursor: 'pointer', fontSize: '11px', fontWeight: 800, color: '#a8927a', padding: '5px 10px', border: '2px solid #f0e2cf', borderRadius: '10px', flex: '0 0 auto' }}>Edit</div>
                        </div>
                        {expandedTasks === p.id && (
                          <div style={{ background: '#fbf6ec', border: '2px solid #f0e2cf', borderRadius: '14px', padding: '11px 13px' }}>
                            {tasksFor(p.id).length === 0 && <div style={{ fontSize: '12px', color: '#a8927a', paddingBottom: '4px', fontWeight: 600 }}>No open tasks — add one below.</div>}
                            {tasksFor(p.id).map(t => {
                              const statusOptId = statusField?.options.find(o => o.name === t.status)?.id ?? null;
                              return (
                              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '5px 0' }}>
                                <span onClick={() => completeTaskById(t.id)} title="Mark done in Notion" style={{ width: '16px', height: '16px', borderRadius: '5px', border: '2px solid #dcc9ab', cursor: 'pointer', flex: '0 0 auto', background: '#fff' }} />
                                <span style={{ fontSize: '13px', color: INK, flex: 1, minWidth: 0, fontWeight: 600 }}>{t.name}</span>
                                {t.isNextStep && <span style={{ fontSize: '9.5px', fontWeight: 800, letterSpacing: '.06em', color: ACCENT, background: ACCENT_SOFT, border: '2px solid #e8d7bd', borderRadius: '20px', padding: '2px 7px', flex: '0 0 auto' }}>NEXT</span>}
                                {statusField && (
                                  <div style={{ flex: '0 0 auto', width: '134px' }} onClick={e => e.stopPropagation()}>
                                    <NotionFieldDropdown field={statusField} value={statusOptId ? [statusOptId] : []} onChange={ids => setTaskStatus(t.id, ids)} />
                                  </div>
                                )}
                              </div>
                              );
                            })}
                            <div style={{ display: 'flex', gap: '7px', marginTop: '8px' }}>
                              <input value={newTaskName} onChange={e => setNewTaskName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTaskTo(p.id)} placeholder="Add a task…" style={{ ...input, fontSize: '12.5px', padding: '7px 10px' }} />
                              <div onClick={() => addTaskTo(p.id)} style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 800, color: '#a06a2e', background: ACCENT_SOFT, border: '2px solid #e8d7bd', borderRadius: '11px', padding: '7px 13px', whiteSpace: 'nowrap' }}>Add</div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                        <div style={{ fontSize: '10.5px', letterSpacing: '.12em', textTransform: 'uppercase', color: '#a8927a', fontWeight: 800 }}>Redecorating house #{i + 1}</div>
                        <input value={draft?.name ?? ''} onChange={e => setDraft(d => d && { ...d, name: e.target.value })} onKeyDown={e => e.key === 'Enter' && saveEdit(p.id)} placeholder="Project name" style={{ ...input, fontSize: '14px', fontWeight: 700 }} />
                        <input value={draft?.blurb ?? ''} onChange={e => setDraft(d => d && { ...d, blurb: e.target.value })} onKeyDown={e => e.key === 'Enter' && saveEdit(p.id)} placeholder="What is it? (a short description)" style={input} />
                        <div style={{ display: 'flex', gap: '9px' }}>
                          <input value={draft?.threshold ?? ''} onChange={e => setDraft(d => d && { ...d, threshold: e.target.value })} onKeyDown={e => e.key === 'Enter' && saveEdit(p.id)} placeholder="Check in after (e.g. 2 weeks)" style={{ ...input, flex: 1 }} />
                          <input value={draft?.nextStep ?? ''} onChange={e => setDraft(d => d && { ...d, nextStep: e.target.value })} onKeyDown={e => e.key === 'Enter' && saveEdit(p.id)} placeholder="Next little step" style={{ ...input, flex: 1.4 }} />
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '2px' }}>
                          <div style={{ fontSize: '10.5px', letterSpacing: '.12em', textTransform: 'uppercase', color: '#a8927a', fontWeight: 800 }}>Color</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                            {HOUSE_COLORS.map((c, ci) => {
                              const active = draft?.houseColor === String(ci);
                              return (
                                <div key={ci} onClick={() => setDraft(d => d && ({ ...d, houseColor: String(ci), colorHexInput: '' }))} style={{
                                  width: '28px', height: '28px', borderRadius: '9px', background: c.body, cursor: 'pointer',
                                  boxShadow: active ? 'inset 0 0 0 3px #4a3a2e' : 'inset 0 0 0 2px rgba(70,45,20,.12)',
                                }} />
                              );
                            })}
                            <input
                              value={draft?.colorHexInput ?? ''}
                              onChange={e => {
                                const raw = e.target.value;
                                setDraft(d => {
                                  if (!d) return d;
                                  const norm = raw.startsWith('#') ? raw : `#${raw}`;
                                  return { ...d, colorHexInput: raw, houseColor: HEX_RE.test(norm) ? norm.toLowerCase() : d.houseColor };
                                });
                              }}
                              onKeyDown={e => e.key === 'Enter' && saveEdit(p.id)}
                              placeholder="#f2a48c" style={{ ...input, width: '110px' }}
                            />
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: '2px' }}>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <div onClick={() => removeProject(p.id)} style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 800, color: '#b4453b', padding: '8px 14px', borderRadius: '12px', border: '2px solid #f0d3cf' }}>Archive</div>
                            <div onClick={() => saveEdit(p.id)} style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 800, color: '#fff', background: ACCENT, padding: '8px 17px', borderRadius: '12px', boxShadow: `0 3px 0 ${ACCENT_DARK}` }}>Done</div>
                          </div>
                        </div>
                      </div>
                    )}
                    </div>
                  </Fragment>
                );
              })}
              {dragId && dragOverIndex === projects.length && <div style={dropLineStyle} />}

              <div onClick={addProject} style={{ cursor: 'pointer', textAlign: 'center', fontSize: '13px', fontWeight: 800, color: ACCENT, border: '2px dashed #e8cdb8', borderRadius: '16px', padding: '12px', marginTop: '2px' }}>+ New building</div>
            </div>
          </div>

          <div style={{ ...stickerCard, padding: '24px' }}>
            <div style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: '21px', color: INK }}>On the horizon</div>

            <div style={{ fontSize: '10.5px', letterSpacing: '.14em', textTransform: 'uppercase', color: '#a8927a', fontWeight: 800, marginTop: '18px' }}>Google Calendar</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', marginTop: '11px' }}>
              {calendarState === 'unconfigured' && <div style={{ fontSize: '12.5px', color: '#a8927a', fontWeight: 600 }}>Google Calendar isn't configured yet.</div>}
              {calendarState === 'unauthorized' && (
                <a href={calendarAuthUrl || '#'} target="_blank" rel="noreferrer" style={{ fontSize: '12.5px', color: ACCENT, fontWeight: 800, textDecoration: 'none' }}>Connect Google Calendar →</a>
              )}
              {calendarState === 'ready' && calendar.length === 0 && <div style={{ fontSize: '12.5px', color: '#a8927a', fontWeight: 600 }}>Nothing locked in over the next 30 days.</div>}
              {calendar.map(c => {
                const cp = projects.find(p => p.name === c.project);
                const dot = cp ? colorsFor(cp.houseColor, cp.id).body : ACCENT;
                return (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 14px', borderRadius: '16px', background: '#f6efe1', border: '2px solid #ecdfc8' }}>
                    <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: dot, flex: '0 0 auto', boxShadow: '0 0 0 4px rgba(201,111,78,.12)' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 800, color: INK }}>{c.title}</span>
                        {c.recurring && (
                          <svg viewBox="0 0 640 512" width="12" height="12" fill="#a8927a" style={{ flex: '0 0 auto' }} aria-label="repeats">
                            <path d="M614.2 334.8C610.5 325.8 601.7 320 592 320l-72 0 0-144c0-26.5-21.5-48-48-48l-152 0c-8.8 0-16 7.2-16 16l0 32c0 8.8 7.2 16 16 16l136 0 0 128-72 0c-9.7 0-18.5 5.8-22.2 14.8s-1.7 19.3 5.2 26.2l104 104c9.4 9.4 24.6 9.4 33.9 0l104-104c6.9-6.9 8.9-17.2 5.2-26.2zM32 192c3.7 9 12.5 14.8 22.2 14.8l72 0 0 144c0 26.5 21.5 48 48 48l152 0c8.8 0 16-7.2 16-16l0-32c0-8.8-7.2-16-16-16l-136 0 0-128 72 0c9.7 0 18.5-5.8 22.2-14.8s1.7-19.3-5.2-26.2l-104-104c-9.4-9.4-24.6-9.4-33.9 0l-104 104c-6.9 6.9-8.9 17.2-5.2 26.2z"/>
                          </svg>
                        )}
                      </div>
                      <div style={{ fontSize: '11px', color: INK_SOFT, fontWeight: 600 }}>{c.project} · {c.type}</div>
                    </div>
                    <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
                      <div style={{ fontSize: '12px', fontWeight: 800, color: ACCENT, whiteSpace: 'nowrap' }}>{c.date}</div>
                      <div style={{ fontSize: '10.5px', color: '#a8927a', fontWeight: 600 }}>{c.meta}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ fontSize: '10.5px', letterSpacing: '.14em', textTransform: 'uppercase', color: '#a8927a', fontWeight: 800, marginTop: '20px' }}>Next right thing</div>
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: '9px' }}>
              {roadmap.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '11px', padding: '11px 2px', borderBottom: '2px dotted #eee1cd' }}>
                  <span style={{ width: '17px', height: '17px', borderRadius: '6px', border: '2px solid #dcc9ab', flex: '0 0 auto', marginTop: '1px' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', color: INK, fontWeight: 600 }}>{r.step}</div>
                    <div style={{ fontSize: '11px', color: '#a8927a', marginTop: '1px', fontWeight: 600 }}>{r.project}</div>
                  </div>
                  <div style={{ fontSize: '11px', fontWeight: 800, color: ACCENT, whiteSpace: 'nowrap', flex: '0 0 auto', marginTop: '1px' }}>{r.target}</div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: '20px', background: 'linear-gradient(180deg,#f2ecfb,#f9f6fd)', border: '2px solid #e2d7f2', borderRadius: '18px', padding: '16px 17px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#9b7fc7' }} />
                <span style={{ fontSize: '10.5px', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 800, color: '#7d6a9e' }}>A note from the neighborhood</span>
              </div>
              <div style={{ fontFamily: DISPLAY_FONT, fontWeight: 400, fontSize: '15.5px', lineHeight: 1.45, color: '#584a72', marginTop: '9px' }}>{nudge.body}</div>
            </div>
          </div>
        </div>

        {review && (
          <div style={stickerCard}>
            <div onClick={() => setReviewOpen(o => !o)} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px', cursor: 'pointer' }}>
              <div>
                <div style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: '21px', color: INK }}>Your week in the neighborhood</div>
                <div style={{ fontSize: '12.5px', color: INK_SOFT, marginTop: '4px', fontWeight: 600 }}>
                  <b style={{ color: INK }}>{review.totalHoursThisWeek}h</b> across {review.activeProjectsThisWeek} house{review.activeProjectsThisWeek === 1 ? '' : 's'} · {review.sessionsThisWeek} visit{review.sessionsThisWeek === 1 ? '' : 's'}
                  {review.totalHoursLastWeek > 0 && <span style={{ color: '#a8927a' }}> · {review.totalHoursThisWeek >= review.totalHoursLastWeek ? '▲' : '▼'} vs {review.totalHoursLastWeek}h last week</span>}
                </div>
              </div>
              <div style={{ fontSize: '11px', fontWeight: 800, color: ACCENT, whiteSpace: 'nowrap', padding: '5px 9px', border: '2px solid #e8d7bd', borderRadius: '10px' }}>{reviewOpen ? 'Hide' : 'Look back'}</div>
            </div>

            {reviewOpen && (
              <div style={{ marginTop: '18px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                  {[
                    { k: 'This week', v: `${review.totalHoursThisWeek}h` },
                    { k: 'Visits', v: String(review.sessionsThisWeek) },
                    { k: 'Streak', v: `${review.longestStreakDays} day${review.longestStreakDays === 1 ? '' : 's'}` },
                    ...(review.busiestDay ? [{ k: 'Busiest', v: `${review.busiestDay.label} · ${review.busiestDay.hours}h` }] : []),
                  ].map(s => (
                    <div key={s.k} style={{ flex: '1 1 120px', background: '#fbf6ec', border: '2px solid #f0e2cf', borderRadius: '16px', padding: '12px 14px' }}>
                      <div style={{ fontSize: '10.5px', letterSpacing: '.1em', textTransform: 'uppercase', color: '#a8927a', fontWeight: 800 }}>{s.k}</div>
                      <div style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: '22px', color: INK, marginTop: '4px' }}>{s.v}</div>
                    </div>
                  ))}
                </div>

                {(review.rising.length > 0 || review.fading.length > 0 || review.wentDark.length > 0) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {review.rising.map(n => <span key={`r${n}`} style={{ fontSize: '11.5px', fontWeight: 800, color: TREND_COLORS.buzzing.fg, background: TREND_COLORS.buzzing.bg, border: `2px solid ${TREND_COLORS.buzzing.bd}`, borderRadius: '20px', padding: '4px 11px' }}>▲ {n}</span>)}
                    {review.fading.map(n => <span key={`f${n}`} style={{ fontSize: '11.5px', fontWeight: 800, color: TREND_COLORS.steady.fg, background: TREND_COLORS.steady.bg, border: `2px solid ${TREND_COLORS.steady.bd}`, borderRadius: '20px', padding: '4px 11px' }}>▼ {n}</span>)}
                    {review.wentDark.map(n => <span key={`d${n}`} style={{ fontSize: '11.5px', fontWeight: 800, color: TREND_COLORS.napping.fg, background: TREND_COLORS.napping.bg, border: `2px solid ${TREND_COLORS.napping.bd}`, borderRadius: '20px', padding: '4px 11px' }}>◗ {n} went napping</span>)}
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {review.byProject.filter(p => p.hoursThisWeek > 0 || p.hoursLastWeek > 0).slice(0, 8).map(p => {
                    const max = Math.max(1, ...review.byProject.map(x => x.hoursThisWeek));
                    return (
                      <div key={p.projectId} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '128px', fontSize: '12.5px', color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '0 0 auto', fontWeight: 600 }}>{p.name}</div>
                        <div style={{ flex: 1, height: '9px', background: '#f3ead9', borderRadius: '20px', overflow: 'hidden' }}>
                          <div style={{ width: `${Math.round((p.hoursThisWeek / max) * 100)}%`, height: '100%', background: ACCENT, borderRadius: '20px' }} />
                        </div>
                        <div style={{ width: '96px', textAlign: 'right', fontSize: '11.5px', color: INK_SOFT, flex: '0 0 auto', whiteSpace: 'nowrap', fontWeight: 600 }}>
                          <b style={{ color: INK }}>{p.hoursThisWeek}h</b>{p.delta !== 0 && <span style={{ color: p.delta > 0 ? TREND_COLORS.buzzing.fg : TREND_COLORS.steady.fg }}> {p.delta > 0 ? '▲' : '▼'}{Math.abs(p.delta)}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={stickerCard}>
          <div style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: '21px', color: INK }}>Neighborhood Activities</div>

          {saveError && (
            <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', background: '#fdf1ef', border: '2px solid #f3d3cc', color: '#9a3b2a', borderRadius: '14px', padding: '10px 13px', fontSize: '12.5px', fontWeight: 600 }}>
              <span>{saveError}</span>
              <span onClick={() => setSaveError(null)} style={{ cursor: 'pointer', fontWeight: 800, padding: '0 4px' }}>×</span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '22px', marginTop: '18px' }}>

            <div style={{ border: '2px solid #ecdfc8', borderRadius: '20px', padding: '18px', background: '#fdf9f1' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: '13px', fontWeight: 800, color: INK }}>Right now</div>
                {capMode === 'running' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                    <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#7ebe8c', animation: 'wf-pulse 2s ease-out infinite' }} />
                    <span style={{ fontSize: '11px', color: '#4d8a5e', fontWeight: 800 }}>the kettle's on</span>
                  </div>
                )}
                {capMode === 'paused' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                    <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#d8b45a' }} />
                    <span style={{ fontSize: '11px', color: '#9a7d38', fontWeight: 800 }}>tea break!</span>
                  </div>
                )}
              </div>

              <div style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: '46px', letterSpacing: '.01em', color: (capMode === 'running' || capMode === 'paused' || capMode === 'noting') ? INK : '#d8c8b2', marginTop: '10px', fontVariantNumeric: 'tabular-nums' }}>{fmtClock(capSeconds)}</div>
              <div style={{ fontSize: '12px', color: INK_SOFT, minHeight: '16px', fontWeight: 600 }}>
                {capMode === 'picking' ? 'Which house are you popping into?' : (capProject && projects.find(p => p.id === capProject)?.name) || 'The whole street is quiet — for now'}
              </div>

              {capMode === 'picking' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px', marginTop: '14px' }}>
                  {projects.map(p => (
                    <div key={p.id} onClick={() => pick(p.id)} style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 800, padding: '8px 13px', borderRadius: '12px', background: '#fff', border: `2px solid ${colorsFor(p.houseColor, p.id).body}`, color: INK }}>{p.name}</div>
                  ))}
                </div>
              )}

              {capMode === 'noting' && (
                <div style={{ marginTop: '14px' }}>
                  <div style={{ fontSize: '12px', color: INK_SOFT, marginBottom: '7px', fontWeight: 700 }}>What happened in there?</div>
                  <input value={capNote} onChange={e => setCapNote(e.target.value)} onKeyDown={e => e.key === 'Enter' && onSaveSession()} autoFocus placeholder="e.g. Worked through the second verse" style={{ ...input, fontSize: '13px', padding: '10px 13px', borderRadius: '13px' }} />
                  {capProject && (
                    <div style={{ marginTop: '11px' }}>
                      <div style={{ fontSize: '11px', color: INK_SOFT, marginBottom: '6px', fontWeight: 700 }}>Log against · <span style={{ color: '#a8927a' }}>defaults to the next step</span></div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {tasksFor(capProject).map(t => (
                          <div key={t.id} onClick={() => chooseCapTask(t.id)} style={taskChip(capTaskId === t.id || (capTaskId === null && t.isNextStep))}>{t.isNextStep ? '★ ' : ''}{t.name}</div>
                        ))}
                        <div onClick={() => chooseCapTask('NEW')} style={taskChip(capTaskId === 'NEW')}>+ New task</div>
                      </div>
                      <TaskFieldEditors schema={schema} fields={capFields} onChange={setCapFields} />
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                    <div onClick={onSaveSession} style={{ cursor: 'pointer', flex: 1, textAlign: 'center', fontSize: '12.5px', fontWeight: 800, padding: '10px', borderRadius: '13px', background: ACCENT, color: '#fff', boxShadow: `0 3px 0 ${ACCENT_DARK}` }}>Save to Notion</div>
                    <div onClick={onDiscard} style={{ cursor: 'pointer', textAlign: 'center', fontSize: '12.5px', fontWeight: 800, padding: '10px 14px', borderRadius: '13px', background: 'transparent', border: '2px solid #ecdcc5', color: INK_SOFT }}>Never mind</div>
                  </div>
                </div>
              )}

              {capMode === 'idle' && (
                <div onClick={onStart} style={{ cursor: 'pointer', textAlign: 'center', fontSize: '13px', fontWeight: 800, padding: '12px', borderRadius: '14px', background: ACCENT, color: '#fff', marginTop: '16px', boxShadow: `0 3px 0 ${ACCENT_DARK}` }}>Pop into a building &amp; start the clock</div>
              )}
              {(capMode === 'running' || capMode === 'paused') && (
                <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                  {capMode === 'running' ? (
                    <div onClick={onPause} style={{ cursor: 'pointer', textAlign: 'center', fontSize: '13px', fontWeight: 800, padding: '12px 16px', borderRadius: '14px', background: '#fff', border: '2px solid #ecdcc5', color: INK }}>Pause</div>
                  ) : (
                    <div onClick={onResume} style={{ cursor: 'pointer', textAlign: 'center', fontSize: '13px', fontWeight: 800, padding: '12px 16px', borderRadius: '14px', background: '#fff', border: `2px solid ${ACCENT}`, color: ACCENT_DARK }}>Resume</div>
                  )}
                  <div onClick={onStop} style={{ cursor: 'pointer', flex: 1, textAlign: 'center', fontSize: '13px', fontWeight: 800, padding: '12px', borderRadius: '14px', background: INK, color: '#fff' }}>Stop &amp; tell the tale</div>
                </div>
              )}
            </div>

            <div style={{ border: '2px solid #ecdfc8', borderRadius: '20px', padding: '18px', background: '#fdf9f1' }}>
              <div style={{ fontSize: '13px', fontWeight: 800, color: INK }}>Manual Entry</div>

              <div style={{ fontSize: '11px', color: INK_SOFT, marginTop: '13px', marginBottom: '7px', fontWeight: 700 }}>Which building?</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
                {projects.map(p => {
                  const active = manProject === p.id;
                  const colors = colorsFor(p.houseColor, p.id);
                  return (
                    <div key={p.id} onClick={() => chooseManProject(p.id)} style={{
                      cursor: 'pointer', fontSize: '12px', fontWeight: 800, padding: '8px 12px', borderRadius: '12px',
                      background: active ? ACCENT : '#fff', color: active ? '#fff' : INK,
                      border: active ? `2px solid ${ACCENT}` : `2px solid ${colors.body}`, transition: 'all .15s',
                    }}>{p.name}</div>
                  );
                })}
              </div>

              {manProject && (
                <div style={{ marginTop: '13px' }}>
                  <div style={{ fontSize: '11px', color: INK_SOFT, marginBottom: '6px', fontWeight: 700 }}>Log against · <span style={{ color: '#a8927a' }}>defaults to the next step</span></div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {tasksFor(manProject).map(t => (
                      <div key={t.id} onClick={() => chooseManTask(t.id)} style={taskChip(manTaskId === t.id || (manTaskId === null && t.isNextStep))}>{t.isNextStep ? '★ ' : ''}{t.name}</div>
                    ))}
                    <div onClick={() => chooseManTask('NEW')} style={taskChip(manTaskId === 'NEW')}>+ New task</div>
                  </div>
                  <TaskFieldEditors schema={schema} fields={manFields} onChange={setManFields} />
                </div>
              )}

              <div style={{ display: 'flex', gap: '9px', marginTop: '13px' }}>
                <input value={manDur} onChange={e => setManDur(e.target.value)} onKeyDown={e => e.key === 'Enter' && onAddManual()} placeholder="45m or 4h" style={{ ...input, width: '96px', borderRadius: '12px' }} />
                <input value={manNote} onChange={e => setManNote(e.target.value)} onKeyDown={e => e.key === 'Enter' && onAddManual()} placeholder="What happened?" style={{ ...input, flex: 1, fontSize: '13px', borderRadius: '12px' }} />
              </div>
              <div onClick={onAddManual} style={{ cursor: 'pointer', textAlign: 'center', fontSize: '12.5px', fontWeight: 800, padding: '10px', borderRadius: '13px', background: ACCENT_SOFT, color: '#a06a2e', border: '2px solid #e8d7bd', marginTop: '11px' }}>Tuck it into the diary</div>
            </div>
          </div>

          <div style={{ fontSize: '10.5px', letterSpacing: '.14em', textTransform: 'uppercase', color: '#a8927a', fontWeight: 800, marginTop: '22px' }}>The neighborhood log</div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: '10px' }}>
            {feed.length === 0 && (
              <div style={{ fontSize: '12.5px', color: '#a8927a', padding: '10px 2px', fontWeight: 600 }}>Nothing logged yet — sessions you capture above will show up here.</div>
            )}
            {feed.map((f, i) => {
              const fp = projects.find(p => p.name === f.project);
              const dot = fp ? colorsFor(fp.houseColor, fp.id).body : '#e0d2ba';
              return (
                <div key={f.id || i} style={{ display: 'flex', alignItems: 'center', gap: '13px', padding: '12px 2px', borderBottom: '2px dotted #eee1cd', animation: 'wf-in .3s ease both' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: dot, flex: '0 0 auto' }} />
                  {editingFeedId === f.id && f.id ? (
                    <>
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <b style={{ fontSize: '13px', color: INK, flex: '0 0 auto' }}>{f.project}</b>
                        <input value={feedDraft.note} onChange={e => setFeedDraft(d => ({ ...d, note: e.target.value }))} onKeyDown={e => e.key === 'Enter' && saveFeedEdit(f.id)} placeholder="What happened?" style={{ ...input, flex: 1, fontSize: '12.5px', padding: '7px 11px' }} autoFocus />
                        <input value={feedDraft.dur} onChange={e => setFeedDraft(d => ({ ...d, dur: e.target.value }))} onKeyDown={e => e.key === 'Enter' && saveFeedEdit(f.id)} placeholder="45m or 4h" style={{ ...input, width: '84px', fontSize: '12.5px', padding: '7px 11px' }} />
                      </div>
                      <div onClick={() => saveFeedEdit(f.id)} style={{ cursor: 'pointer', fontSize: '11px', fontWeight: 800, color: '#fff', background: ACCENT, padding: '6px 12px', borderRadius: '10px', flex: '0 0 auto' }}>Save</div>
                      <div onClick={() => setEditingFeedId(null)} style={{ cursor: 'pointer', fontSize: '11px', fontWeight: 800, color: '#a8927a', padding: '6px 9px', border: '2px solid #f0e2cf', borderRadius: '10px', flex: '0 0 auto' }}>Cancel</div>
                    </>
                  ) : (
                    <>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', color: INK, fontWeight: 600 }}><b>{f.project}</b> · <span style={{ color: INK_SOFT }}>{f.note}</span></div>
                        <div style={{ fontSize: '11px', color: '#a8927a', marginTop: '1px', fontWeight: 600 }}>{f.when}</div>
                      </div>
                      <div style={{ fontSize: '12px', fontWeight: 800, color: INK_SOFT, whiteSpace: 'nowrap' }}>{f.dur}</div>
                      {f.id && (
                        <div onClick={() => startFeedEdit(f)} style={{ cursor: 'pointer', fontSize: '11px', fontWeight: 800, color: '#a8927a', padding: '5px 10px', border: '2px solid #f0e2cf', borderRadius: '10px', flex: '0 0 auto' }}>Edit</div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
