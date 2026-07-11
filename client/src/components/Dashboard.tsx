import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { api } from '../api';
import type { CalendarEvent, FeedEntry, FieldUpdate, Narrative, PickerField, Project, Summary, TaskLite, WeeklyReview } from '../types';
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

const DISPLAY_FONT = "'Fraunces', Georgia, serif";
const BODY_FONT = "'Nunito', system-ui, sans-serif";

type CapMode = 'idle' | 'picking' | 'running' | 'noting';

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

// The Notion fields the logger can set on a task: Importance + Urgency (colored
// option pickers) and Status Notes (free text). Populated from the task when it
// exists, blank for a new stub.
interface Fields { importance: string | null; urgency: string | null; statusNotes: string }
const BLANK_FIELDS: Fields = { importance: null, urgency: null, statusNotes: '' };
const fieldLabel: CSSProperties = { fontSize: '11px', color: INK_SOFT, marginBottom: '5px', fontWeight: 700 };

// Module-scope so the Status Notes text input keeps focus across keystrokes.
function TaskFieldEditors({ schema, fields, onChange }: { schema: PickerField[]; fields: Fields; onChange: (f: Fields) => void }) {
  if (schema.length === 0) return null;
  const importance = schema.find(f => f.name === 'Importance');
  const urgency = schema.find(f => f.name === 'Urgency');
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
      <div>
        <div style={fieldLabel}>Status notes</div>
        <input value={fields.statusNotes} onChange={e => onChange({ ...fields, statusNotes: e.target.value })} placeholder="Where it's at / why it's parked…" style={input} />
      </div>
    </div>
  );
}

// Which fields differ from the task's current values — only those get written.
function fieldUpdates(draft: Fields, orig: Fields): FieldUpdate[] {
  const u: FieldUpdate[] = [];
  if ((draft.importance ?? null) !== (orig.importance ?? null)) u.push({ name: 'Importance', type: 'select', optionIds: draft.importance ? [draft.importance] : [] });
  if ((draft.urgency ?? null) !== (orig.urgency ?? null)) u.push({ name: 'Urgency', type: 'select', optionIds: draft.urgency ? [draft.urgency] : [] });
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
  const [reorderMsg, setReorderMsg] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProjectDraft | null>(null);

  const [capMode, setCapMode] = useState<CapMode>('idle');
  const [capProject, setCapProject] = useState<string | null>(null);
  const [capSeconds, setCapSeconds] = useState(0);
  const [capNote, setCapNote] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const capStartRef = useRef<number | null>(null);

  const [manProject, setManProject] = useState<string | null>(null);
  const [manDur, setManDur] = useState('');
  const [manNote, setManNote] = useState('');

  const [editingFeedId, setEditingFeedId] = useState<string | null>(null);
  const [feedDraft, setFeedDraft] = useState<{ dur: string; note: string }>({ dur: '', note: '' });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [narrative, setNarrative] = useState<Narrative | null>(null);
  const [confettiBurst, setConfettiBurst] = useState(0);

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
    return t ? { importance: t.importanceId, urgency: t.urgencyId, statusNotes: t.statusNotes } : { ...BLANK_FIELDS };
  };
  // The task a session will actually land on: an explicit pick, else the
  // project's next step, else none (a new stub will be created).
  const effectiveTaskId = (sel: string | null, projectId: string | null): string | null => {
    if (sel === 'NEW') return null;
    if (sel) return sel;
    return tasks.find(t => t.projectId === projectId && t.isNextStep)?.id ?? null;
  };

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

  useEffect(() => {
    loadProjects(); loadCalendar(); loadFeed(); loadNarrative(); loadTasks(); loadReview(); loadSchema(); loadSummary();
    const t = setInterval(() => { loadProjects(); loadCalendar(); loadFeed(); loadNarrative(); loadTasks(); loadReview(); loadSummary(); }, 60000);
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
      const { projectId, startedAt } = JSON.parse(raw);
      if (projectId && typeof startedAt === 'number') startTicking(projectId, startedAt);
      else localStorage.removeItem(LIVE_SESSION_KEY);
    } catch { localStorage.removeItem(LIVE_SESSION_KEY); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const now = new Date();
  const h = now.getHours();
  const greeting = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const dateStr = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  // ----- reorder -----
  function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) { setDragId(null); return; }
    const order = projects.map(p => p.id);
    const from = order.indexOf(dragId);
    order.splice(from, 1);
    order.splice(order.indexOf(targetId), 0, dragId);
    const reordered = order.map(id => projects.find(p => p.id === id)!);
    setProjects(reordered);
    setDragId(null);
    const moved = reordered.find(p => p.id === dragId)!;
    const newRank = order.indexOf(dragId) + 1;
    setReorderMsg(`${moved.name} moved to #${newRank}. Logged to Notion — reason optional.`);
    api.reorder(order, null).catch(() => setReorderMsg('Reorder failed to save — try again.'));
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
  // The clock is computed from a wall-clock start time (not tick counting), so
  // it stays honest through background-tab throttling — and the start time is
  // kept in localStorage so a refresh or closed tab doesn't lose the session.
  function startTicking(projectId: string, startedAt: number) {
    capStartRef.current = startedAt;
    setCapProject(projectId); setCapMode('running');
    setCapSeconds(Math.floor((Date.now() - startedAt) / 1000));
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setCapSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
  }
  function onStart() { setCapMode('picking'); setCapSeconds(0); setCapNote(''); setCapTaskId(null); }
  function pick(id: string) {
    const startedAt = Date.now();
    setCapTaskId(null);
    localStorage.setItem(LIVE_SESSION_KEY, JSON.stringify({ projectId: id, startedAt }));
    startTicking(id, startedAt);
  }
  function onStop() {
    if (timerRef.current) clearInterval(timerRef.current);
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
    setCapMode('idle'); setCapProject(null); setCapSeconds(0); setCapNote(''); setCapTaskId(null);
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
    localStorage.removeItem(LIVE_SESSION_KEY);
    setFeed(f => [{ id: '', project: p?.name || '', note, when: 'Just now', dur: fmtDur(durSec), durationSec: durSec }, ...f]);
    setCapMode('idle'); setCapProject(null); setCapSeconds(0); setCapNote(''); setCapTaskId(null);
    setCapFields(BLANK_FIELDS); setCapOrig(BLANK_FIELDS);
    try {
      const res = await api.logActivity({ projectId: capProject, ...attachment(taskSel), note, durationSec: durSec, source: 'live' });
      const updates = fieldUpdates(fDraft, fOrig);
      if (res?.taskId && updates.length) await api.updateTaskFields(res.taskId, updates);
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
      const updates = fieldUpdates(fDraft, fOrig);
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

  const quietProject = projects.find(p => p.quiet);
  const nudge = narrative?.nudge
    ? { body: narrative.nudge }
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
          {loaded && projects.length > 0 && <Skyline projects={projects} truthOverride={narrative?.skyline ?? null} onRequestReorder={() => priorityRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: '24px', alignItems: 'start' }}>

          <div ref={priorityRef} style={stickerCard}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <div style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: '21px', color: INK }}>Your Buildings</div>
              <div style={{ fontSize: '11px', color: '#a8927a', fontWeight: 700 }}>drag to shuffle the queue</div>
            </div>

            {reorderMsg && (
              <div style={{ marginTop: '14px', display: 'flex', alignItems: 'center', gap: '8px', background: '#f3ead9', border: '2px solid #e8d7bd', borderRadius: '14px', padding: '9px 13px', animation: 'wf-in .3s ease both' }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: ACCENT }} />
                <span style={{ fontSize: '12px', color: '#7a5c3e', fontWeight: 700 }}>{reorderMsg}</span>
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
                  <div key={p.id} draggable={!editing}
                    onDragStart={() => setDragId(p.id)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => onDrop(p.id)}
                    onDragEnd={() => setDragId(null)}
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
                            {tasksFor(p.id).map(t => (
                              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '5px 0' }}>
                                <span onClick={() => completeTaskById(t.id)} title="Mark done in Notion" style={{ width: '16px', height: '16px', borderRadius: '5px', border: '2px solid #dcc9ab', cursor: 'pointer', flex: '0 0 auto', background: '#fff' }} />
                                <span style={{ fontSize: '13px', color: INK, flex: 1, minWidth: 0, fontWeight: 600 }}>{t.name}</span>
                                {t.isNextStep && <span style={{ fontSize: '9.5px', fontWeight: 800, letterSpacing: '.06em', color: ACCENT, background: ACCENT_SOFT, border: '2px solid #e8d7bd', borderRadius: '20px', padding: '2px 7px', flex: '0 0 auto' }}>NEXT</span>}
                              </div>
                            ))}
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
                );
              })}

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
                      <div style={{ fontSize: '13px', fontWeight: 800, color: INK }}>{c.title}</div>
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
              </div>

              <div style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: '46px', letterSpacing: '.01em', color: (capMode === 'running' || capMode === 'noting') ? INK : '#d8c8b2', marginTop: '10px', fontVariantNumeric: 'tabular-nums' }}>{fmtClock(capSeconds)}</div>
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
              {capMode === 'running' && (
                <div onClick={onStop} style={{ cursor: 'pointer', textAlign: 'center', fontSize: '13px', fontWeight: 800, padding: '12px', borderRadius: '14px', background: INK, color: '#fff', marginTop: '16px' }}>Stop &amp; tell the tale</div>
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
