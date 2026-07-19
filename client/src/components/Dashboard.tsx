import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { api } from '../api';
import type { CalendarEvent, EnergyForecast, EnergyLevel, FeedEntry, FieldUpdate, Narrative, PickerField, Project, Summary, TaskLite, Weather, WeeklyReview } from '../types';
import Confetti from './Confetti';
import { HEX_RE, HOUSE_COLORS, colorsFor } from './houseColors';
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

// Weather chip colors: calm blue-gray for a storm, deliberately never red —
// this is a forecast, not an alarm.
const WEATHER_DOT: Record<Weather, string> = { clear: '#7ebe8c', clouding: '#d8b45a', storm: '#9caed4' };
const WEATHER_WORD: Record<Weather, string> = { clear: 'clear skies', clouding: 'clouding over', storm: 'stormy' };

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

// "4h" → 4 hours, "45m" or bare "45" → minutes, "45s" → seconds, "1h 30m" /
// "1.5h" also work.
function parseDurationSec(raw: string): number {
  let total = 0;
  for (const m of (raw || '').matchAll(/(\d+(?:\.\d+)?)\s*(h(?:ours?|rs?)?|m(?:in(?:ute)?s?)?|s(?:ec(?:onds?)?)?)?/gi)) {
    const n = parseFloat(m[1]);
    const unit = (m[2] || 'm').toLowerCase();
    total += unit.startsWith('h') ? n * 3600 : unit.startsWith('s') ? n : n * 60;
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

const input: CSSProperties = {
  width: '100%', fontFamily: 'inherit', fontSize: '12.5px', color: INK,
  padding: '9px 12px', border: '2px solid #ecdcc5', borderRadius: '12px', outline: 'none', background: '#fff',
};

const dropLineStyle: CSSProperties = {
  height: '3px', borderRadius: '2px', background: ACCENT, flex: '0 0 auto',
  boxShadow: '0 0 0 4px rgba(201,111,78,.15)',
  // The indicator must never intercept the drop: HTML5 DnD only fires `drop`
  // on an element whose dragover called preventDefault, and this line has no
  // such handler. Without this, releasing over the line silently drops nothing.
  pointerEvents: 'none',
};

// Small inline spinner for the "saving to Notion" indicator.
function Spinner({ size = 13, color = ACCENT }: { size?: number; color?: string }) {
  return (
    <span
      style={{
        display: 'inline-block', width: `${size}px`, height: `${size}px`, flex: '0 0 auto',
        border: `2px solid ${color}`, borderTopColor: 'transparent', borderRadius: '50%',
        animation: 'wf-spin .7s linear infinite',
      }}
    />
  );
}

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

// Shared keyboard handler for role="button" elements (Enter/Space activate,
// Space is prevented from scrolling the page).
const keyActivate = (fn: () => void) => (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
};

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
  const [reorderOrder, setReorderOrder] = useState<{ order: string[]; movedId: string } | null>(null);
  const [reorderReason, setReorderReason] = useState('');
  // 'saving' while a reorder is in flight to Notion, 'saved' once it lands,
  // 'error' if it fails. Drives the loading indicator in the toast.
  const [reorderStatus, setReorderStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // The last reorder attempt, kept around so a failed save can be retried
  // without re-dragging the card.
  const lastReorderRef = useRef<{ order: string[]; reason: string | null; movedId: string | null } | null>(null);
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
  // Whether the "why this weather?" reasons panel is open. Only ever
  // clickable when the forecast actually has reasons to show.
  const [weatherOpen, setWeatherOpen] = useState(false);

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

  // Undo window for the two irreversible-feeling actions (complete a task,
  // archive a building): the optimistic UI change happens immediately, but the
  // Notion write waits 5s so the toast's Undo can cancel it. Only one pending
  // action at a time — a second one commits the first straight away. Closing the
  // tab inside the window abandons the pending write (acceptable: nothing in
  // Notion has changed yet, and the next poll restores the UI).
  const [undoToast, setUndoToast] = useState<string | null>(null);
  const undoRef = useRef<{ commit: () => void; undo: () => void; timer: number } | null>(null);
  function pushUndo(label: string, commit: () => void, undo: () => void) {
    const prev = undoRef.current;
    if (prev) { clearTimeout(prev.timer); undoRef.current = null; prev.commit(); }
    const timer = window.setTimeout(() => { undoRef.current = null; setUndoToast(null); commit(); }, 5000);
    undoRef.current = { commit, undo, timer };
    setUndoToast(label);
  }
  function undoPending() {
    const u = undoRef.current;
    if (!u) return;
    clearTimeout(u.timer);
    undoRef.current = null; setUndoToast(null);
    u.undo();
  }
  // Tasks/buildings mid-undo-window: kept out of the next poll's result so a
  // background refresh doesn't resurrect or remove them before the window closes.
  const pendingCompleteRef = useRef<Set<string>>(new Set());
  const pendingArchiveRef = useRef<Set<string>>(new Set());

  const confettiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function celebrate() {
    setConfettiBurst(Date.now());
    if (confettiTimer.current) clearTimeout(confettiTimer.current);
    confettiTimer.current = setTimeout(() => setConfettiBurst(0), 4200);
  }

  const tasksByProject = useMemo(() => {
    const m = new Map<string | null, TaskLite[]>();
    for (const t of tasks) {
      const arr = m.get(t.projectId);
      if (arr) arr.push(t); else m.set(t.projectId, [t]);
    }
    for (const arr of m.values()) arr.sort((a, b) => (b.priorityCalc ?? -Infinity) - (a.priorityCalc ?? -Infinity));
    return m;
  }, [tasks]);
  const tasksFor = (projectId: string | null) => tasksByProject.get(projectId) ?? [];

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
  const scrollToPriority = useCallback(() => priorityRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), []);

  // Skip applying a background projects refresh while a drag is in progress or a
  // reorder is still saving — otherwise the poll reorders cards under the cursor
  // or briefly reverts the optimistic order.
  const reorderBusyRef = useRef(false);
  useEffect(() => { reorderBusyRef.current = dragId !== null || reorderStatus === 'saving'; }, [dragId, reorderStatus]);

  const loadProjects = useCallback(async () => {
    try {
      const list = (await api.projects()).filter(p => !pendingArchiveRef.current.has(p.id));
      if (!reorderBusyRef.current) setProjects(list);
      setLoadError(null);
      if (list.length) setManProject(prev => prev ?? list[0].id);
    } catch (e: any) {
      setLoadError(e.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  const loadCalendar = useCallback(async () => {
    try {
      const events = await api.calendar();
      setCalendar(events);
      setCalendarState('ready');
    } catch (e: any) {
      if (e.status === 503) setCalendarState('unconfigured');
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
    try { setTasks((await api.tasks()).filter(t => !pendingCompleteRef.current.has(t.id))); } catch { /* non-fatal */ }
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

  // A 503 means NOTION_ENERGY_PAGE isn't set — the strip stays hidden. Any
  // other error is treated as transient (network hiccup) and leaves the
  // current availability alone, rather than hiding the strip.
  const loadEnergy = useCallback(async () => {
    try {
      const entries = await api.energyLog(1);
      setEnergyAvailable(true);
      setLastCheckinAt(entries[0]?.createdAt ?? null);
    } catch (e: any) { if (e.status === 503) setEnergyAvailable(false); }
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

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    // Don't abandon a pending undo just because the component's unmounting —
    // commit it so the Notion write still happens.
    if (undoRef.current) { clearTimeout(undoRef.current.timer); undoRef.current.commit(); }
  }, []);

  // Mirror a live/paused session into the tab title so a backgrounded tab still
  // shows the clock.
  useEffect(() => {
    if (capMode === 'running' || capMode === 'paused') {
      const name = capProject ? projects.find(p => p.id === capProject)?.name : null;
      document.title = `${fmtClock(capSeconds)}${capMode === 'paused' ? ' ⏸' : ''}${name ? ` · ${name}` : ''} — Life OS`;
    } else {
      document.title = 'Life OS';
    }
  }, [capMode, capSeconds, capProject, projects]);

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
    const prevCheckinAt = lastCheckinAt;
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
      setLastCheckinAt(prevCheckinAt); setEnergyThanks(false);
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
    const id = dragId, over = dragOverIndex;
    setDragId(null);
    setDragOverIndex(null);
    if (!id || over === null) return;
    const order = projects.map(p => p.id);
    const from = order.indexOf(id);
    const insertAt = over > from ? over - 1 : over;
    if (insertAt === from) return;
    order.splice(from, 1);
    order.splice(insertAt, 0, id);
    const reordered = order.map(pid => projects.find(p => p.id === pid)!);
    setProjects(reordered);
    const moved = reordered.find(p => p.id === id)!;
    const newRank = order.indexOf(id) + 1;
    setReorderMsg(`${moved.name} moved to #${newRank}.`);
    setReorderOrder({ order, movedId: id });
    setReorderReason('');
    saveReorder(order, null, id);
  }
  // Persist an order to Notion, flipping the loading indicator as it goes.
  function saveReorder(order: string[], reason: string | null, movedId: string | null) {
    lastReorderRef.current = { order, reason, movedId };
    setReorderStatus('saving');
    api.reorder(order, reason, movedId)
      .then(() => setReorderStatus('saved'))
      .catch(() => {
        setReorderStatus('error');
        setReorderMsg('Reorder failed to save — try again.');
      });
  }
  function submitReorderReason() {
    const reason = reorderReason.trim();
    if (!reason || !reorderOrder) return;
    saveReorder(reorderOrder.order, reason, reorderOrder.movedId);
    setReorderMsg(prev => (prev ? `${prev.replace(/\s*Saved with your reason\.?$/, '')} Saved with your reason.` : prev));
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
    setProjects(ps => ps.map(p => p.id === id ? { ...p, name: draft.name, blurb: draft.blurb, threshold: draft.threshold, nextStep: draft.nextStep, houseColor: draft.houseColor } : p));
    try {
      await api.updateProject(id, { name: draft.name, blurb: draft.blurb, nextStep: draft.nextStep, threshold: draft.threshold, houseColor: draft.houseColor });
      setSaveError(null);
    } catch (e: any) {
      setSaveError(`Couldn't save project changes to Notion: ${e.message}`);
    }
    loadProjects();
  }
  function removeProject(id: string) {
    const name = projects.find(p => p.id === id)?.name || 'this project';
    setEditingId(null);
    setProjects(ps => ps.filter(p => p.id !== id));
    pendingArchiveRef.current.add(id);
    const commit = async () => {
      try { await api.removeProject(id); } catch (e: any) { setSaveError(`Couldn't archive in Notion: ${e.message}`); }
      pendingArchiveRef.current.delete(id);
      loadProjects();
    };
    const undo = () => { pendingArchiveRef.current.delete(id); loadProjects(); };
    pushUndo(`Archived "${name}" — it moves to Status: Archive in Notion, nothing is deleted.`, commit, undo);
  }
  async function addProject() {
    const priority = projects.length + 1;
    try {
      const { id } = await api.createProject('New building', priority);
      await loadProjects();
      startEdit({ id, name: 'New building', blurb: '', threshold: '2 weeks', nextStep: '', houseColor: null } as Project);
    } catch (e: any) {
      setSaveError(`Couldn't create a building in Notion: ${e.message}`);
    }
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
    let res: { taskId: string } | null = null;
    try {
      res = await api.logActivity({ projectId: capProject, ...attachment(taskSel), note, durationSec: durSec, source: 'live' });
      setSaveError(null);
      celebrate();
    } catch (e: any) {
      setSaveError(`That session didn't reach Notion (${e.message}). It's not saved — I've tucked it into Manual Entry below.`);
      // Park the lost session in Manual Entry so nothing has to be retyped.
      chooseManProject(capProject);
      setManDur(fmtDur(durSec));
      setManNote(note === 'Worked a little.' ? '' : note);
    }
    if (res?.taskId) {
      try {
        const updates = fieldUpdates(fDraft, fOrig, statusField?.type === 'select' ? 'select' : 'status');
        if (updates.length) await api.updateTaskFields(res.taskId, updates);
        if (markDone) await api.completeTask(res.taskId);
      } catch (e: any) {
        setSaveError(`The session saved, but the task's field updates didn't reach Notion (${e.message}).`);
      }
    }
    loadProjects(); loadFeed(); loadTasks(); loadReview(); loadSummary();
  }
  async function onAddManual() {
    if (!manProject) return;
    const p = projects.find(pr => pr.id === manProject);
    const rawDur = manDur;
    const manNoteRaw = manNote;
    const note = manNote || 'Logged after the fact.';
    const durSec = parseDurationSec(manDur);
    const taskSel = manTaskId;
    const fDraft = manFields, fOrig = manOrig;
    setFeed(f => [{ id: '', project: p?.name || '', note, when: 'Just now', dur: fmtDur(durSec), durationSec: durSec }, ...f]);
    setManDur(''); setManNote('');
    let res: { taskId: string } | null = null;
    try {
      res = await api.logActivity({ projectId: manProject, ...attachment(taskSel), note, durationSec: durSec, source: 'manual' });
      setSaveError(null);
      celebrate();
    } catch (e: any) {
      setSaveError(`That entry didn't reach Notion (${e.message}). It's not saved — try again.`);
      // Restore exactly what Katie had typed — nothing to retype after a failed save.
      setManDur(rawDur); setManNote(manNoteRaw);
    }
    if (res?.taskId) {
      try {
        const updates = fieldUpdates(fDraft, fOrig, statusField?.type === 'select' ? 'select' : 'status');
        if (updates.length) await api.updateTaskFields(res.taskId, updates);
      } catch (e: any) {
        setSaveError(`The session saved, but the task's field updates didn't reach Notion (${e.message}).`);
      }
    }
    setManFields(BLANK_FIELDS); setManOrig(BLANK_FIELDS);
    loadProjects(); loadFeed(); loadTasks(); loadReview(); loadSummary();
  }

  // ----- tasks -----
  function completeTaskById(id: string) {
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    setTasks(ts => ts.filter(x => x.id !== id));
    pendingCompleteRef.current.add(id);
    const commit = async () => {
      try { await api.completeTask(id); setSaveError(null); }
      catch (e: any) { setSaveError(`Couldn't complete that task in Notion: ${e.message}`); loadTasks(); }
      pendingCompleteRef.current.delete(id);
      loadProjects(); loadFeed(); loadReview();
    };
    const undo = () => { pendingCompleteRef.current.delete(id); setTasks(ts => [...ts, t]); };
    pushUndo(`Marked "${t.name}" done.`, commit, undo);
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
      {undoToast && (
        <div style={{ position: 'fixed', left: '50%', bottom: '26px', transform: 'translateX(-50%)', zIndex: 80, background: INK, color: '#fff', borderRadius: '16px', padding: '11px 16px', boxShadow: '0 10px 30px rgba(50,30,10,.35)', display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12.5px', fontWeight: 700, animation: 'wf-in .3s ease both' }}>
          <span>{undoToast}</span>
          <button type="button" onClick={undoPending} style={{ color: '#f5d78e', fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}>Undo</button>
        </div>
      )}
      <div className="kv-page" style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>

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
            {forecast && (forecast.reasons.length > 0 ? (
              <button
                type="button"
                onClick={() => setWeatherOpen(v => !v)}
                aria-expanded={weatherOpen}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px', background: '#fffdf8', border: '2px solid #f0e2cf', borderRadius: '16px', padding: '8px 14px', boxShadow: '0 3px 0 #f0e2cf',
                  cursor: 'pointer',
                }}
              >
                <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: WEATHER_DOT[forecast.weather] }} />
                <span style={{ fontSize: '12.5px', fontWeight: 800, color: INK }}>{WEATHER_WORD[forecast.weather]}</span>
              </button>
            ) : (
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px', background: '#fffdf8', border: '2px solid #f0e2cf', borderRadius: '16px', padding: '8px 14px', boxShadow: '0 3px 0 #f0e2cf',
                  cursor: 'default',
                }}
              >
                <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: WEATHER_DOT[forecast.weather] }} />
                <span style={{ fontSize: '12.5px', fontWeight: 800, color: INK }}>{WEATHER_WORD[forecast.weather]}</span>
              </div>
            ))}
          </div>
        </div>

        {forecast && weatherOpen && forecast.reasons.length > 0 && (
          <div style={{ background: '#fffdf8', border: '2px solid #f0e2cf', borderRadius: '18px', padding: '13px 16px', boxShadow: '0 3px 0 #f0e2cf', animation: 'wf-in .3s ease both' }}>
            <div style={{ fontSize: '10.5px', letterSpacing: '.12em', textTransform: 'uppercase', color: '#a8927a', fontWeight: 800 }}>Why this weather?</div>
            {forecast.reasons.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', fontWeight: 600, color: INK, padding: '3px 0' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: WEATHER_DOT[forecast.weather], flex: '0 0 auto' }} />
                {r}
              </div>
            ))}
            <div style={{ fontSize: '11px', color: '#a8927a', fontWeight: 600, marginTop: '6px' }}>Every warning names its evidence — this is everything the forecast noticed.</div>
          </div>
        )}

        {showEnergyStrip && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', background: '#fffdf8', border: '2px solid #f0e2cf', borderRadius: '18px', padding: '11px 16px', boxShadow: '0 3px 0 #f0e2cf', animation: 'wf-in .3s ease both' }}>
            {energyThanks ? (
              <span style={{ fontSize: '13px', fontWeight: 800, color: INK }}>Logged.</span>
            ) : (
              <>
                <span style={{ fontSize: '12.5px', fontWeight: 800, color: INK, whiteSpace: 'nowrap' }}>Energy check</span>
                <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
                  {ENERGY_DOTS.map(d => (
                    <button type="button" key={d.level} onClick={() => onEnergyCheckin(d.level)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '7px', padding: '6px 12px', borderRadius: '12px', background: '#fff', border: '2px solid #ecdcc5' }}>
                      <span style={{ width: '11px', height: '11px', borderRadius: '50%', background: d.color }} />
                      <span style={{ fontSize: '12px', fontWeight: 800, color: INK }}>{d.level}</span>
                    </button>
                  ))}
                </div>
                <input value={energyNote} onChange={e => setEnergyNote(e.target.value)} placeholder="Note, optional" style={{ ...input, flex: 1, minWidth: '150px', maxWidth: '280px', fontSize: '12px', padding: '7px 11px' }} />
                <button type="button" onClick={onEnergySkip} style={{ cursor: 'pointer', fontSize: '11px', fontWeight: 800, color: '#a8927a', padding: '5px 11px', border: '2px solid #f0e2cf', borderRadius: '10px', whiteSpace: 'nowrap' }}>Skip</button>
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
          {loaded && projects.length > 0 && <Skyline projects={projects} truthOverride={narrative?.skyline ?? null} energyWeather={forecast?.weather ?? 'clear'} onRequestReorder={scrollToPriority} />}
        </div>

        <div className="kv-two-col">

          <div ref={priorityRef} style={stickerCard}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <div style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: '21px', color: INK }}>Your Buildings</div>
              <div style={{ fontSize: '11px', color: '#a8927a', fontWeight: 700 }}>drag to shuffle the queue</div>
            </div>

            {reorderMsg && (
              <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '9px', background: '#f3ead9', border: '2px solid #e8d7bd', borderRadius: '14px', padding: '9px 13px', animation: 'wf-in .3s ease both' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {reorderStatus === 'saving'
                    ? <Spinner size={12} />
                    : <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: reorderStatus === 'error' ? '#b4453b' : ACCENT, flex: '0 0 auto' }} />}
                  <span style={{ fontSize: '12px', color: '#7a5c3e', fontWeight: 700 }}>{reorderMsg}</span>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: reorderStatus === 'error' ? '#b4453b' : '#a8927a', whiteSpace: 'nowrap' }}>
                    {reorderStatus === 'saving' ? 'Saving to Notion…' : reorderStatus === 'saved' ? '✓ Saved to Notion' : ''}
                  </span>
                  {reorderStatus === 'error' && (
                    <button
                      type="button"
                      onClick={() => lastReorderRef.current && saveReorder(lastReorderRef.current.order, lastReorderRef.current.reason, lastReorderRef.current.movedId)}
                      style={{ fontSize: '11px', fontWeight: 800, color: ACCENT, cursor: 'pointer', border: '2px solid #e8d7bd', borderRadius: '10px', padding: '3px 9px', whiteSpace: 'nowrap' }}
                    >
                      Retry
                    </button>
                  )}
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
                    <button type="button" onClick={submitReorderReason} style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 800, color: '#a06a2e', background: '#fff', border: '2px solid #e8d7bd', borderRadius: '11px', padding: '7px 13px', whiteSpace: 'nowrap' }}>Add</button>
                  </div>
                )}
              </div>
            )}

            <div
              onDragOver={e => { if (dragId) e.preventDefault(); }}
              onDrop={onDrop}
              style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}
            >
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
                        <button type="button" onClick={() => setExpandedTasks(v => (v === p.id ? null : p.id))} aria-expanded={expandedTasks === p.id} style={{ cursor: 'pointer', fontSize: '11px', fontWeight: 800, color: expandedTasks === p.id ? ACCENT : '#a8927a', padding: '5px 10px', border: `2px solid ${expandedTasks === p.id ? '#e8d7bd' : '#f0e2cf'}`, borderRadius: '10px', flex: '0 0 auto', whiteSpace: 'nowrap' }}>{tasksFor(p.id).length} task{tasksFor(p.id).length === 1 ? '' : 's'}</button>
                        <button type="button" onClick={() => startEdit(p)} style={{ cursor: 'pointer', fontSize: '11px', fontWeight: 800, color: '#a8927a', padding: '5px 10px', border: '2px solid #f0e2cf', borderRadius: '10px', flex: '0 0 auto' }}>Edit</button>
                        </div>
                        {expandedTasks === p.id && (
                          <div style={{ background: '#fbf6ec', border: '2px solid #f0e2cf', borderRadius: '14px', padding: '11px 13px' }}>
                            {tasksFor(p.id).length === 0 && <div style={{ fontSize: '12px', color: '#a8927a', paddingBottom: '4px', fontWeight: 600 }}>No open tasks — add one below.</div>}
                            {tasksFor(p.id).map(t => {
                              const statusOptId = statusField?.options.find(o => o.name === t.status)?.id ?? null;
                              return (
                              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '5px 0' }}>
                                <button type="button" onClick={() => completeTaskById(t.id)} title="Mark done in Notion" aria-label={`Mark "${t.name}" done`} style={{ display: 'inline-block', width: '16px', height: '16px', borderRadius: '5px', border: '2px solid #dcc9ab', cursor: 'pointer', flex: '0 0 auto', background: '#fff' }} />
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
                              <button type="button" onClick={() => addTaskTo(p.id)} style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 800, color: '#a06a2e', background: ACCENT_SOFT, border: '2px solid #e8d7bd', borderRadius: '11px', padding: '7px 13px', whiteSpace: 'nowrap' }}>Add</button>
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
                                <button type="button" key={ci} onClick={() => setDraft(d => d && ({ ...d, houseColor: String(ci), colorHexInput: '' }))} aria-label={`House color ${ci + 1}`} style={{
                                  display: 'inline-block', width: '28px', height: '28px', borderRadius: '9px', background: c.body, cursor: 'pointer',
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
                                  const trimmed = raw.trim();
                                  const norm = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
                                  const houseColor = trimmed === '' ? null : (HEX_RE.test(norm) ? norm.toLowerCase() : d.houseColor);
                                  return { ...d, colorHexInput: raw, houseColor };
                                });
                              }}
                              onKeyDown={e => e.key === 'Enter' && saveEdit(p.id)}
                              placeholder="#f2a48c" style={{ ...input, width: '110px' }}
                            />
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: '2px' }}>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button type="button" onClick={() => removeProject(p.id)} style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 800, color: '#b4453b', padding: '8px 14px', borderRadius: '12px', border: '2px solid #f0d3cf' }}>Archive</button>
                            <button type="button" onClick={() => saveEdit(p.id)} style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 800, color: '#fff', background: ACCENT, padding: '8px 17px', borderRadius: '12px', boxShadow: `0 3px 0 ${ACCENT_DARK}` }}>Done</button>
                          </div>
                        </div>
                      </div>
                    )}
                    </div>
                  </Fragment>
                );
              })}
              {dragId && dragOverIndex === projects.length && <div style={dropLineStyle} />}

              <button type="button" onClick={addProject} style={{ cursor: 'pointer', textAlign: 'center', fontSize: '13px', fontWeight: 800, color: ACCENT, border: '2px dashed #e8cdb8', borderRadius: '16px', padding: '12px', marginTop: '2px' }}>+ New building</button>
            </div>
          </div>

          <div style={{ ...stickerCard, padding: '24px' }}>
            <div style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: '21px', color: INK }}>On the horizon</div>

            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px', marginTop: '18px' }}>
              <div style={{ fontSize: '10.5px', letterSpacing: '.14em', textTransform: 'uppercase', color: '#a8927a', fontWeight: 800 }}>Google Calendar</div>
              {calendarState === 'ready' && forecast?.calendarEventCountNext7d != null && (
                // 10 mirrors HEAVY_CALENDAR_EVENTS in server derive.ts — the count the forecast treats as a heavy week.
                <div style={{ fontSize: '10.5px', fontWeight: 700, whiteSpace: 'nowrap', color: forecast.calendarEventCountNext7d >= 10 ? '#a06a2e' : '#a8927a' }}>
                  {forecast.calendarEventCountNext7d} event{forecast.calendarEventCountNext7d === 1 ? '' : 's'} next 7 days
                </div>
              )}
            </div>
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
            <div
              role="button"
              tabIndex={0}
              onClick={() => setReviewOpen(o => !o)}
              onKeyDown={keyActivate(() => setReviewOpen(o => !o))}
              aria-expanded={reviewOpen}
              style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px', cursor: 'pointer' }}
            >
              <div>
                <div style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: '21px', color: INK }}>Your week in the neighborhood</div>
                <div style={{ fontSize: '12.5px', color: INK_SOFT, marginTop: '4px', fontWeight: 600 }}>
                  <b style={{ color: INK }}>{review.totalHoursThisWeek}h</b> across {review.activeProjectsThisWeek} house{review.activeProjectsThisWeek === 1 ? '' : 's'} · {review.sessionsThisWeek} visit{review.sessionsThisWeek === 1 ? '' : 's'}
                  {review.totalHoursLastWeek > 0 && <span style={{ color: '#a8927a' }}> · {review.totalHoursThisWeek >= review.totalHoursLastWeek ? '▲' : '▼'} vs {review.totalHoursLastWeek}h last week</span>}
                  {review.typicalHoursWeekToDate > 0 && <span style={{ color: '#a8927a' }}> · typically {review.typicalHoursWeekToDate}h by now</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setReviewOpen(o => !o); }}
                style={{ fontSize: '11px', fontWeight: 800, color: ACCENT, whiteSpace: 'nowrap', padding: '5px 9px', border: '2px solid #e8d7bd', borderRadius: '10px' }}
              >{reviewOpen ? 'Hide' : 'Look back'}</button>
            </div>

            {reviewOpen && (
              <div style={{ marginTop: '18px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                  {[
                    { k: 'This week', v: `${review.totalHoursThisWeek}h` },
                    ...(review.typicalHoursWeekToDate > 0 ? [{ k: 'Typical by now', v: `${review.typicalHoursWeekToDate}h` }] : []),
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
              <button type="button" onClick={() => setSaveError(null)} aria-label="Dismiss error" style={{ cursor: 'pointer', fontWeight: 800, padding: '0 4px' }}>×</button>
            </div>
          )}

          <div className="kv-act-grid">

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
                    <button type="button" key={p.id} onClick={() => pick(p.id)} style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 800, padding: '8px 13px', borderRadius: '12px', background: '#fff', border: `2px solid ${colorsFor(p.houseColor, p.id).body}`, color: INK }}>{p.name}</button>
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
                          <button type="button" key={t.id} onClick={() => chooseCapTask(t.id)} style={taskChip(capTaskId === t.id || (capTaskId === null && t.isNextStep))}>{t.isNextStep ? '★ ' : ''}{t.name}</button>
                        ))}
                        <button type="button" onClick={() => chooseCapTask('NEW')} style={taskChip(capTaskId === 'NEW')}>+ New task</button>
                      </div>
                      <TaskFieldEditors schema={schema} fields={capFields} onChange={setCapFields} />
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                    <button type="button" onClick={onSaveSession} style={{ cursor: 'pointer', flex: 1, textAlign: 'center', fontSize: '12.5px', fontWeight: 800, padding: '10px', borderRadius: '13px', background: ACCENT, color: '#fff', boxShadow: `0 3px 0 ${ACCENT_DARK}` }}>Save to Notion</button>
                    <button type="button" onClick={onDiscard} style={{ cursor: 'pointer', textAlign: 'center', fontSize: '12.5px', fontWeight: 800, padding: '10px 14px', borderRadius: '13px', background: 'transparent', border: '2px solid #ecdcc5', color: INK_SOFT }}>Never mind</button>
                  </div>
                </div>
              )}

              {capMode === 'idle' && (
                <button type="button" onClick={onStart} style={{ display: 'block', width: '100%', cursor: 'pointer', textAlign: 'center', fontSize: '13px', fontWeight: 800, padding: '12px', borderRadius: '14px', background: ACCENT, color: '#fff', marginTop: '16px', boxShadow: `0 3px 0 ${ACCENT_DARK}` }}>Pop into a building &amp; start the clock</button>
              )}
              {(capMode === 'running' || capMode === 'paused') && (
                <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                  {capMode === 'running' ? (
                    <button type="button" onClick={onPause} style={{ cursor: 'pointer', textAlign: 'center', fontSize: '13px', fontWeight: 800, padding: '12px 16px', borderRadius: '14px', background: '#fff', border: '2px solid #ecdcc5', color: INK }}>Pause</button>
                  ) : (
                    <button type="button" onClick={onResume} style={{ cursor: 'pointer', textAlign: 'center', fontSize: '13px', fontWeight: 800, padding: '12px 16px', borderRadius: '14px', background: '#fff', border: `2px solid ${ACCENT}`, color: ACCENT_DARK }}>Resume</button>
                  )}
                  <button type="button" onClick={onStop} style={{ cursor: 'pointer', flex: 1, textAlign: 'center', fontSize: '13px', fontWeight: 800, padding: '12px', borderRadius: '14px', background: INK, color: '#fff' }}>Stop &amp; tell the tale</button>
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
                    <button type="button" key={p.id} onClick={() => chooseManProject(p.id)} style={{
                      cursor: 'pointer', fontSize: '12px', fontWeight: 800, padding: '8px 12px', borderRadius: '12px',
                      background: active ? ACCENT : '#fff', color: active ? '#fff' : INK,
                      border: active ? `2px solid ${ACCENT}` : `2px solid ${colors.body}`, transition: 'all .15s',
                    }}>{p.name}</button>
                  );
                })}
              </div>

              {manProject && (
                <div style={{ marginTop: '13px' }}>
                  <div style={{ fontSize: '11px', color: INK_SOFT, marginBottom: '6px', fontWeight: 700 }}>Log against · <span style={{ color: '#a8927a' }}>defaults to the next step</span></div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {tasksFor(manProject).map(t => (
                      <button type="button" key={t.id} onClick={() => chooseManTask(t.id)} style={taskChip(manTaskId === t.id || (manTaskId === null && t.isNextStep))}>{t.isNextStep ? '★ ' : ''}{t.name}</button>
                    ))}
                    <button type="button" onClick={() => chooseManTask('NEW')} style={taskChip(manTaskId === 'NEW')}>+ New task</button>
                  </div>
                  <TaskFieldEditors schema={schema} fields={manFields} onChange={setManFields} />
                </div>
              )}

              <div style={{ display: 'flex', gap: '9px', marginTop: '13px' }}>
                <input value={manDur} onChange={e => setManDur(e.target.value)} onKeyDown={e => e.key === 'Enter' && onAddManual()} placeholder="45m or 4h" style={{ ...input, width: '96px', borderRadius: '12px' }} />
                <input value={manNote} onChange={e => setManNote(e.target.value)} onKeyDown={e => e.key === 'Enter' && onAddManual()} placeholder="What happened?" style={{ ...input, flex: 1, fontSize: '13px', borderRadius: '12px' }} />
              </div>
              <button type="button" onClick={onAddManual} style={{ display: 'block', width: '100%', cursor: 'pointer', textAlign: 'center', fontSize: '12.5px', fontWeight: 800, padding: '10px', borderRadius: '13px', background: ACCENT_SOFT, color: '#a06a2e', border: '2px solid #e8d7bd', marginTop: '11px' }}>Tuck it into the diary</button>
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
                      <button type="button" onClick={() => saveFeedEdit(f.id)} style={{ cursor: 'pointer', fontSize: '11px', fontWeight: 800, color: '#fff', background: ACCENT, padding: '6px 12px', borderRadius: '10px', flex: '0 0 auto' }}>Save</button>
                      <button type="button" onClick={() => setEditingFeedId(null)} style={{ cursor: 'pointer', fontSize: '11px', fontWeight: 800, color: '#a8927a', padding: '6px 9px', border: '2px solid #f0e2cf', borderRadius: '10px', flex: '0 0 auto' }}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', color: INK, fontWeight: 600 }}><b>{f.project}</b> · <span style={{ color: INK_SOFT }}>{f.note}</span></div>
                        <div style={{ fontSize: '11px', color: '#a8927a', marginTop: '1px', fontWeight: 600 }}>{f.when}</div>
                      </div>
                      <div style={{ fontSize: '12px', fontWeight: 800, color: INK_SOFT, whiteSpace: 'nowrap' }}>{f.dur}</div>
                      {f.id && (
                        <button type="button" onClick={() => startFeedEdit(f)} style={{ cursor: 'pointer', fontSize: '11px', fontWeight: 800, color: '#a8927a', padding: '5px 10px', border: '2px solid #f0e2cf', borderRadius: '10px', flex: '0 0 auto' }}>Edit</button>
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
