import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { api } from '../api';
import type { CalendarEvent, FeedEntry, Narrative, Project } from '../types';
import Skyline from './Skyline';

const ACCENT = '#2f6bb0';
const ACCENT_SOFT = '#eaf1fa';
const USER_NAME = 'Katie';
const LIVE_SESSION_KEY = 'katieos-live-session';

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

const input: CSSProperties = {
  width: '100%', fontFamily: 'inherit', fontSize: '12.5px', color: '#16233a',
  padding: '9px 11px', border: '1px solid #dbe3ee', borderRadius: '9px', outline: 'none', background: '#fff',
};

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [calendar, setCalendar] = useState<CalendarEvent[]>([]);
  const [calendarState, setCalendarState] = useState<'idle' | 'unconfigured' | 'unauthorized' | 'ready'>('idle');
  const [calendarAuthUrl, setCalendarAuthUrl] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [dragId, setDragId] = useState<string | null>(null);
  const [reorderMsg, setReorderMsg] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; blurb: string; threshold: string; nextStep: string } | null>(null);

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

  useEffect(() => {
    loadProjects(); loadCalendar(); loadFeed(); loadNarrative();
    const t = setInterval(() => { loadProjects(); loadCalendar(); loadFeed(); loadNarrative(); }, 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setDraft({ name: p.name, blurb: p.blurb, threshold: p.threshold, nextStep: p.nextStep });
  }
  async function saveEdit(id: string) {
    if (!draft) return;
    setEditingId(null);
    setProjects(ps => ps.map(p => p.id === id ? { ...p, name: draft.name, blurb: draft.blurb, threshold: draft.threshold, nextStep: draft.nextStep } : p));
    try {
      await api.updateProject(id, { name: draft.name, blurb: draft.blurb, nextStep: draft.nextStep });
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
    const { id } = await api.createProject('New project', priority);
    await loadProjects();
    startEdit({ id, name: 'New project', blurb: '', threshold: '2 weeks', nextStep: '' } as Project);
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
  function onStart() { setCapMode('picking'); setCapSeconds(0); setCapNote(''); }
  function pick(id: string) {
    const startedAt = Date.now();
    localStorage.setItem(LIVE_SESSION_KEY, JSON.stringify({ projectId: id, startedAt }));
    startTicking(id, startedAt);
  }
  function onStop() { if (timerRef.current) clearInterval(timerRef.current); setCapMode('noting'); }
  function onDiscard() {
    if (timerRef.current) clearInterval(timerRef.current);
    localStorage.removeItem(LIVE_SESSION_KEY);
    setCapMode('idle'); setCapProject(null); setCapSeconds(0); setCapNote('');
  }
  async function onSaveSession() {
    if (!capProject) return;
    const p = projects.find(pr => pr.id === capProject);
    const note = capNote || 'Worked a little.';
    const durSec = capSeconds;
    const startedAt = capStartRef.current ? new Date(capStartRef.current).toISOString() : undefined;
    localStorage.removeItem(LIVE_SESSION_KEY);
    setFeed(f => [{ id: '', project: p?.name || '', note, when: 'Just now', dur: fmtDur(durSec), durationSec: durSec }, ...f]);
    setCapMode('idle'); setCapProject(null); setCapSeconds(0); setCapNote('');
    try {
      await api.logActivity({ projectId: capProject, note, durationSec: durSec, source: 'live', startedAt, endedAt: new Date().toISOString() });
      setSaveError(null);
    } catch (e: any) {
      setSaveError(`That session didn't reach Notion (${e.message}). It's not saved — log it again below.`);
    }
    loadProjects(); loadFeed();
  }
  async function onAddManual() {
    if (!manProject) return;
    const p = projects.find(pr => pr.id === manProject);
    const note = manNote || 'Logged after the fact.';
    const durSec = parseDurationSec(manDur);
    setFeed(f => [{ id: '', project: p?.name || '', note, when: 'Just now', dur: fmtDur(durSec), durationSec: durSec }, ...f]);
    setManDur(''); setManNote('');
    try {
      await api.logActivity({ projectId: manProject, note, durationSec: durSec, source: 'manual' });
      setSaveError(null);
    } catch (e: any) {
      setSaveError(`That entry didn't reach Notion (${e.message}). It's not saved — try again.`);
    }
    loadProjects(); loadFeed();
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
        body: `${quietProject.name} has been quiet since ${quietProject.lastMoved}. ${quietProject.recoveryNote
          ? `Last time it went quiet this long, ${quietProject.recoveryNote} — and it held.`
          : 'Nothing in your logged activity yet shows what got it moving again last time.'}`,
      }
      : { body: 'Nothing is drifting right now. Everything with a stated priority has moved inside its own threshold.' };

  const roadmap = projects.filter(p => p.nextStep).map(p => ({ step: p.nextStep, project: p.name, note: p.nextNote || 'Self-defined next step', target: p.nextTarget || '—' }));

  const rootStyle: CSSProperties = {
    ['--ac' as string]: ACCENT, ['--ac-soft' as string]: ACCENT_SOFT,
    minHeight: '100vh', fontFamily: "'Hanken Grotesk', system-ui, sans-serif", background: '#eaeef4',
  };

  return (
    <div style={rootStyle}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '34px 30px 90px', display: 'flex', flexDirection: 'column', gap: '26px' }}>

        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '20px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontFamily: "'Newsreader',Georgia,serif", fontSize: '33px', lineHeight: 1.05, color: '#16233a' }}>{greeting}, {USER_NAME}</div>
            <div style={{ fontSize: '13.5px', color: '#5a6b84', marginTop: '6px' }}>{dateStr} · a quiet look at where your attention actually went</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', background: '#fff', border: '1px solid #e2e8f1', borderRadius: '11px', padding: '8px 12px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--ac)' }} />
              <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#16233a' }}>Personal + Home</span>
            </div>
            <div title="Hard-excluded at the app level — filtered on every read" style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f3f5f9', border: '1px dashed #d3dbe6', borderRadius: '11px', padding: '8px 12px' }}>
              <span style={{ fontSize: '12px', color: '#94a1b5', textDecoration: 'line-through' }}>Work</span>
              <span style={{ fontSize: '10.5px', color: '#94a1b5' }}>excluded</span>
            </div>
          </div>
        </div>

        {loadError && (
          <div style={{ background: '#fdf1ef', border: '1px solid #f3d3cc', color: '#9a3b2a', borderRadius: '12px', padding: '12px 16px', fontSize: '13px' }}>
            {loadError}
          </div>
        )}

        <div ref={heroRef} style={{ minHeight: '780px' }}>
          {!loaded && (
            <div style={{ height: '780px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '18px', background: '#dfe6ef', color: '#5a6b84', fontSize: '13.5px' }}>
              Loading your skyline from Notion…
            </div>
          )}
          {loaded && projects.length > 0 && <Skyline projects={projects} calendarEvents={calendar} truthOverride={narrative?.skyline ?? null} onRequestReorder={() => priorityRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: '26px', alignItems: 'start' }}>

          <div ref={priorityRef} style={{ background: '#fff', border: '1px solid #e2e8f1', borderRadius: '18px', padding: '24px 24px 20px', boxShadow: '0 18px 44px rgba(20,35,58,.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <div style={{ fontFamily: "'Newsreader',Georgia,serif", fontSize: '21px', color: '#16233a' }}>Priority &amp; where the hours went</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10.5px', color: '#8a97ab', whiteSpace: 'nowrap' }}>
                <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: 'var(--ac)' }} />worked
                <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#dce4ee', marginLeft: '6px' }} />quiet
              </div>
            </div>

            {reorderMsg && (
              <div style={{ marginTop: '14px', display: 'flex', alignItems: 'center', gap: '8px', background: '#eaf1fa', border: '1px solid #d4e3f5', borderRadius: '11px', padding: '9px 12px', animation: 'db-in .3s ease both' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--ac)' }} />
                <span style={{ fontSize: '12px', color: '#245089' }}>{reorderMsg}</span>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}>
              {projects.map((p, i) => {
                const dragging = dragId === p.id;
                const editing = editingId === p.id;
                const cardStyle: CSSProperties = {
                  border: dragging ? '1px solid var(--ac)' : (editing ? '1px solid #cdddef' : '1px solid #e9eef5'),
                  background: dragging ? '#f4f8fd' : (editing ? '#f9fbfe' : '#ffffff'),
                  borderRadius: '13px', padding: editing ? '15px 16px' : '13px 15px',
                  boxShadow: dragging ? '0 12px 26px rgba(47,107,176,.16)' : '0 1px 2px rgba(20,35,58,.03)',
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: '13px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', cursor: 'grab', flex: '0 0 auto', padding: '2px' }}>
                          <span style={{ width: '14px', height: '2px', borderRadius: '2px', background: '#c2ccda' }} />
                          <span style={{ width: '14px', height: '2px', borderRadius: '2px', background: '#c2ccda' }} />
                          <span style={{ width: '14px', height: '2px', borderRadius: '2px', background: '#c2ccda' }} />
                        </div>
                        <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'var(--ac-soft)', color: 'var(--ac)', fontSize: '12.5px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{i + 1}</div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '15px', fontWeight: 600, color: '#16233a' }}>{p.name}</span>
                            {p.quiet && <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '.06em', color: '#a06a2e', background: '#fbf0e2', border: '1px solid #f0dcc2', borderRadius: '20px', padding: '2px 8px' }}>QUIET</span>}
                          </div>
                          <div style={{ fontSize: '11.5px', color: '#8a97ab', marginTop: '2px' }}>Last activity {p.lastMoved}</div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flex: '0 0 auto' }}>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            {p.week.map((on, di) => (
                              <span key={di} style={{ width: '9px', height: '9px', borderRadius: '50%', background: on ? 'var(--ac)' : '#dce4ee', display: 'inline-block' }} />
                            ))}
                          </div>
                          <div style={{ fontSize: '11px', color: '#5a6b84' }}><b style={{ color: '#16233a' }}>{p.hours === 0 ? '0h' : `${p.hours}h`}</b> this week</div>
                        </div>
                        <div onClick={() => startEdit(p)} style={{ cursor: 'pointer', fontSize: '11px', fontWeight: 600, color: '#8a97ab', padding: '5px 9px', border: '1px solid #e2e8f1', borderRadius: '8px', flex: '0 0 auto' }}>Edit</div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                        <div style={{ fontSize: '10.5px', letterSpacing: '.12em', textTransform: 'uppercase', color: '#8a97ab', fontWeight: 700 }}>Editing project #{i + 1}</div>
                        <input value={draft?.name ?? ''} onChange={e => setDraft(d => d && { ...d, name: e.target.value })} onKeyDown={e => e.key === 'Enter' && saveEdit(p.id)} placeholder="Project name" style={{ ...input, fontSize: '14px', fontWeight: 600 }} />
                        <input value={draft?.blurb ?? ''} onChange={e => setDraft(d => d && { ...d, blurb: e.target.value })} onKeyDown={e => e.key === 'Enter' && saveEdit(p.id)} placeholder="What is it? (a short description)" style={input} />
                        <div style={{ display: 'flex', gap: '9px' }}>
                          <input value={draft?.threshold ?? ''} onChange={e => setDraft(d => d && { ...d, threshold: e.target.value })} onKeyDown={e => e.key === 'Enter' && saveEdit(p.id)} placeholder="Check-in threshold (e.g. 2 weeks)" style={{ ...input, flex: 1 }} />
                          <input value={draft?.nextStep ?? ''} onChange={e => setDraft(d => d && { ...d, nextStep: e.target.value })} onKeyDown={e => e.key === 'Enter' && saveEdit(p.id)} placeholder="Next step (roadmap)" style={{ ...input, flex: 1.4 }} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: '2px' }}>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <div onClick={() => removeProject(p.id)} style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: '#b4453b', padding: '8px 13px', borderRadius: '9px', border: '1px solid #f0d3cf' }}>Archive</div>
                            <div onClick={() => saveEdit(p.id)} style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 700, color: '#fff', background: 'var(--ac)', padding: '8px 16px', borderRadius: '9px' }}>Done</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              <div onClick={addProject} style={{ cursor: 'pointer', textAlign: 'center', fontSize: '12.5px', fontWeight: 600, color: 'var(--ac)', border: '1.5px dashed #c7d6e8', borderRadius: '12px', padding: '11px', marginTop: '2px' }}>+ Add a project</div>
            </div>
          </div>

          <div style={{ background: '#fff', border: '1px solid #e2e8f1', borderRadius: '18px', padding: '24px', boxShadow: '0 18px 44px rgba(20,35,58,.06)' }}>
            <div style={{ fontFamily: "'Newsreader',Georgia,serif", fontSize: '21px', color: '#16233a' }}>What's coming</div>

            <div style={{ fontSize: '10.5px', letterSpacing: '.14em', textTransform: 'uppercase', color: '#8a97ab', fontWeight: 700, marginTop: '18px' }}>Locked in · Google Calendar</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', marginTop: '11px' }}>
              {calendarState === 'unconfigured' && <div style={{ fontSize: '12.5px', color: '#8a97ab' }}>Google Calendar isn't configured yet.</div>}
              {calendarState === 'unauthorized' && (
                <a href={calendarAuthUrl || '#'} target="_blank" rel="noreferrer" style={{ fontSize: '12.5px', color: 'var(--ac)', fontWeight: 600, textDecoration: 'none' }}>Connect Google Calendar →</a>
              )}
              {calendarState === 'ready' && calendar.length === 0 && <div style={{ fontSize: '12.5px', color: '#8a97ab' }}>Nothing locked in over the next 30 days.</div>}
              {calendar.map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 13px', borderRadius: '12px', background: 'var(--ac-soft)', border: '1px solid #d4e3f5' }}>
                  <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: 'var(--ac)', flex: '0 0 auto', boxShadow: '0 0 0 4px rgba(47,107,176,.14)' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#16233a' }}>{c.title}</div>
                    <div style={{ fontSize: '11px', color: '#5a6b84' }}>{c.project} · {c.type}</div>
                  </div>
                  <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ac)', whiteSpace: 'nowrap' }}>{c.date}</div>
                    <div style={{ fontSize: '10.5px', color: '#8a97ab' }}>{c.meta}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ fontSize: '10.5px', letterSpacing: '.14em', textTransform: 'uppercase', color: '#8a97ab', fontWeight: 700, marginTop: '20px' }}>Your roadmap · next step</div>
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: '9px' }}>
              {roadmap.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '11px', padding: '11px 2px', borderBottom: '1px solid #eef2f7' }}>
                  <span style={{ width: '16px', height: '16px', borderRadius: '5px', border: '1.5px solid #cbd6e4', flex: '0 0 auto', marginTop: '1px' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', color: '#16233a' }}>{r.step}</div>
                    <div style={{ fontSize: '11px', color: '#8a97ab', marginTop: '1px' }}>{r.project} · {r.note}</div>
                  </div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--ac)', whiteSpace: 'nowrap', flex: '0 0 auto', marginTop: '1px' }}>{r.target}</div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: '20px', background: 'linear-gradient(180deg,#f6f2ec,#fbf8f3)', border: '1px solid #ece2d3', borderRadius: '14px', padding: '15px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#c98b45' }} />
                <span style={{ fontSize: '10.5px', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, color: '#a06a2e' }}>A gentle nudge</span>
              </div>
              <div style={{ fontFamily: "'Newsreader',Georgia,serif", fontSize: '16px', lineHeight: 1.4, color: '#5a4326', marginTop: '9px' }}>{nudge.body}</div>
            </div>
          </div>
        </div>

        <div style={{ background: '#fff', border: '1px solid #e2e8f1', borderRadius: '18px', padding: '24px', boxShadow: '0 18px 44px rgba(20,35,58,.06)' }}>
          <div style={{ fontFamily: "'Newsreader',Georgia,serif", fontSize: '21px', color: '#16233a' }}>Capture activity</div>

          {saveError && (
            <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', background: '#fdf1ef', border: '1px solid #f3d3cc', color: '#9a3b2a', borderRadius: '11px', padding: '10px 13px', fontSize: '12.5px' }}>
              <span>{saveError}</span>
              <span onClick={() => setSaveError(null)} style={{ cursor: 'pointer', fontWeight: 700, padding: '0 4px' }}>×</span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '22px', marginTop: '18px' }}>

            <div style={{ border: '1px solid #e6ecf4', borderRadius: '15px', padding: '18px', background: '#fbfcfe' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#16233a' }}>Live activity</div>
                {capMode === 'running' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#46d17f', animation: 'db-pulse 2s ease-out infinite' }} />
                    <span style={{ fontSize: '11px', color: '#2a8a54', fontWeight: 600 }}>tracking</span>
                  </div>
                )}
              </div>

              <div style={{ fontFamily: "'Newsreader',Georgia,serif", fontSize: '44px', letterSpacing: '.01em', color: (capMode === 'running' || capMode === 'noting') ? '#16233a' : '#b7c2d1', marginTop: '10px', fontVariantNumeric: 'tabular-nums' }}>{fmtClock(capSeconds)}</div>
              <div style={{ fontSize: '12px', color: '#8a97ab', minHeight: '16px' }}>
                {capMode === 'picking' ? 'Pick a project to start the clock' : (capProject && projects.find(p => p.id === capProject)?.name) || 'Nothing tracking right now'}
              </div>

              {capMode === 'picking' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px', marginTop: '14px' }}>
                  {projects.map(p => (
                    <div key={p.id} onClick={() => pick(p.id)} style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 600, padding: '7px 12px', borderRadius: '9px', background: '#fff', border: '1px solid #dbe3ee', color: '#16233a' }}>{p.name}</div>
                  ))}
                </div>
              )}

              {capMode === 'noting' && (
                <div style={{ marginTop: '14px' }}>
                  <div style={{ fontSize: '12px', color: '#5a6b84', marginBottom: '7px' }}>What happened?</div>
                  <input value={capNote} onChange={e => setCapNote(e.target.value)} onKeyDown={e => e.key === 'Enter' && onSaveSession()} autoFocus placeholder="e.g. Worked through the second verse" style={{ ...input, fontSize: '13px', padding: '10px 12px', borderRadius: '10px' }} />
                  <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                    <div onClick={onSaveSession} style={{ cursor: 'pointer', flex: 1, textAlign: 'center', fontSize: '12.5px', fontWeight: 700, padding: '10px', borderRadius: '10px', background: 'var(--ac)', color: '#fff' }}>Save to Notion</div>
                    <div onClick={onDiscard} style={{ cursor: 'pointer', textAlign: 'center', fontSize: '12.5px', fontWeight: 600, padding: '10px 14px', borderRadius: '10px', background: 'transparent', border: '1px solid #dbe3ee', color: '#5a6b84' }}>Discard</div>
                  </div>
                </div>
              )}

              {capMode === 'idle' && (
                <div onClick={onStart} style={{ cursor: 'pointer', textAlign: 'center', fontSize: '13px', fontWeight: 700, padding: '11px', borderRadius: '11px', background: 'var(--ac)', color: '#fff', marginTop: '16px' }}>Start a live activity</div>
              )}
              {capMode === 'running' && (
                <div onClick={onStop} style={{ cursor: 'pointer', textAlign: 'center', fontSize: '13px', fontWeight: 700, padding: '11px', borderRadius: '11px', background: '#16233a', color: '#fff', marginTop: '16px' }}>Stop &amp; note</div>
              )}
            </div>

            <div style={{ border: '1px solid #e6ecf4', borderRadius: '15px', padding: '18px', background: '#fbfcfe' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#16233a' }}>Log it after the fact</div>

              <div style={{ fontSize: '11px', color: '#5a6b84', marginTop: '13px', marginBottom: '7px' }}>Project</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
                {projects.map(p => {
                  const active = manProject === p.id;
                  return (
                    <div key={p.id} onClick={() => setManProject(p.id)} style={{
                      cursor: 'pointer', fontSize: '12px', fontWeight: 600, padding: '7px 11px', borderRadius: '9px',
                      background: active ? 'var(--ac)' : '#fff', color: active ? '#fff' : '#16233a',
                      border: active ? '1px solid var(--ac)' : '1px solid #dbe3ee', transition: 'all .15s',
                    }}>{p.name}</div>
                  );
                })}
              </div>

              <div style={{ display: 'flex', gap: '9px', marginTop: '13px' }}>
                <input value={manDur} onChange={e => setManDur(e.target.value)} onKeyDown={e => e.key === 'Enter' && onAddManual()} placeholder="45m or 4h" style={{ ...input, width: '96px', borderRadius: '10px' }} />
                <input value={manNote} onChange={e => setManNote(e.target.value)} onKeyDown={e => e.key === 'Enter' && onAddManual()} placeholder="What happened?" style={{ ...input, flex: 1, fontSize: '13px', borderRadius: '10px' }} />
              </div>
              <div onClick={onAddManual} style={{ cursor: 'pointer', textAlign: 'center', fontSize: '12.5px', fontWeight: 700, padding: '10px', borderRadius: '10px', background: 'var(--ac-soft)', color: 'var(--ac)', border: '1px solid #d4e3f5', marginTop: '11px' }}>Add entry</div>
            </div>
          </div>

          <div style={{ fontSize: '10.5px', letterSpacing: '.14em', textTransform: 'uppercase', color: '#8a97ab', fontWeight: 700, marginTop: '22px' }}>Recently logged · synced to Notion</div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: '10px' }}>
            {feed.length === 0 && (
              <div style={{ fontSize: '12.5px', color: '#8a97ab', padding: '10px 2px' }}>Nothing logged yet — sessions you capture above will show up here.</div>
            )}
            {feed.map((f, i) => (
              <div key={f.id || i} style={{ display: 'flex', alignItems: 'center', gap: '13px', padding: '12px 2px', borderBottom: '1px solid #eef2f7', animation: 'db-in .3s ease both' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--ac)', flex: '0 0 auto' }} />
                {editingFeedId === f.id && f.id ? (
                  <>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <b style={{ fontSize: '13px', color: '#16233a', flex: '0 0 auto' }}>{f.project}</b>
                      <input value={feedDraft.note} onChange={e => setFeedDraft(d => ({ ...d, note: e.target.value }))} onKeyDown={e => e.key === 'Enter' && saveFeedEdit(f.id)} placeholder="What happened?" style={{ ...input, flex: 1, fontSize: '12.5px', padding: '7px 10px' }} autoFocus />
                      <input value={feedDraft.dur} onChange={e => setFeedDraft(d => ({ ...d, dur: e.target.value }))} onKeyDown={e => e.key === 'Enter' && saveFeedEdit(f.id)} placeholder="45m or 4h" style={{ ...input, width: '84px', fontSize: '12.5px', padding: '7px 10px' }} />
                    </div>
                    <div onClick={() => saveFeedEdit(f.id)} style={{ cursor: 'pointer', fontSize: '11px', fontWeight: 700, color: '#fff', background: 'var(--ac)', padding: '6px 11px', borderRadius: '8px', flex: '0 0 auto' }}>Save</div>
                    <div onClick={() => setEditingFeedId(null)} style={{ cursor: 'pointer', fontSize: '11px', fontWeight: 600, color: '#8a97ab', padding: '6px 8px', border: '1px solid #e2e8f1', borderRadius: '8px', flex: '0 0 auto' }}>Cancel</div>
                  </>
                ) : (
                  <>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', color: '#16233a' }}><b>{f.project}</b> · <span style={{ color: '#5a6b84' }}>{f.note}</span></div>
                      <div style={{ fontSize: '11px', color: '#8a97ab', marginTop: '1px' }}>{f.when}</div>
                    </div>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#5a6b84', whiteSpace: 'nowrap' }}>{f.dur}</div>
                    {f.id && (
                      <div onClick={() => startFeedEdit(f)} style={{ cursor: 'pointer', fontSize: '11px', fontWeight: 600, color: '#8a97ab', padding: '5px 9px', border: '1px solid #e2e8f1', borderRadius: '8px', flex: '0 0 auto' }}>Edit</div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
