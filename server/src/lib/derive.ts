import type { ActivityLogEntry, Trend, WeeklyReview } from '../types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// "2 weeks" / "10 days" / "6 weeks" -> days. Falls back to 14 (matches the
// prototype's default per-project threshold) if the text can't be parsed.
export function parseThresholdDays(threshold: string): number {
  const m = /(\d+(?:\.\d+)?)\s*(day|week|month)/i.exec(threshold || '');
  if (!m) return 14;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 'day') return n;
  if (unit === 'week') return n * 7;
  return n * 30;
}

export function daysSince(iso: string | null): number {
  if (!iso) return 9999;
  return (Date.now() - new Date(iso).getTime()) / DAY_MS;
}

function entriesSince(entries: ActivityLogEntry[], days: number): ActivityLogEntry[] {
  const cutoff = Date.now() - days * DAY_MS;
  return entries.filter(e => new Date(e.createdAt).getTime() >= cutoff);
}

// activity: 0-1 from how many logged sessions happened in the last 30 days.
// A project with no sessions this month is exactly 0 — its windows go dark.
export function computeActivity(entries: ActivityLogEntry[]): number {
  const sessionCount = entriesSince(entries, 30).length;
  return Math.min(1, Math.round((sessionCount / 10) * 100) / 100);
}

// Sessions logged in the last 30 days — drives how many windows are lit.
export function countRecentSessions(entries: ActivityLogEntry[]): number {
  return entriesSince(entries, 30).length;
}

// Total time ever logged, in hours. Sessions without a duration count as a
// nominal 15 minutes so quick undated check-ins still add a little mass.
export function computeTotalHours(entries: ActivityLogEntry[]): number {
  const secs = entries.reduce((sum, e) => sum + (e.durationSec || 900), 0);
  return Math.round((secs / 3600) * 10) / 10;
}

// trend: compare activity in the last 14 days against the 14 days before that.
export function computeTrend(entries: ActivityLogEntry[]): Trend {
  const recent = entriesSince(entries, 14).length;
  const prior = entriesSince(entries, 28).length - recent;
  if (recent === 0 && prior === 0) return 'fading';
  if (recent > prior) return 'rising';
  if (recent < prior) return 'fading';
  return 'steady';
}

export function computeQuiet(lastMovedAt: string | null, thresholdDays: number): boolean {
  return daysSince(lastMovedAt) > thresholdDays;
}

// stature: building size reflects time invested in the project, not priority.
// Log scale so early hours matter visibly and a 200-hour project tops out
// rather than dwarfing everything: 1h ≈ 0.13, 10h ≈ 0.45, 40h ≈ 0.70, 200h+ = 1.
export function computeStature(totalHours: number): number {
  if (totalHours <= 0) return 0.1;
  return Math.max(0.1, Math.min(1, Math.log10(1 + totalHours) / Math.log10(201)));
}

export function computeWeek(entries: ActivityLogEntry[], projectId: string): boolean[] {
  const days: boolean[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    dayStart.setDate(dayStart.getDate() - i);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    const touched = entries.some(e => {
      if (e.projectId !== projectId) return false;
      const t = new Date(e.createdAt).getTime();
      return t >= dayStart.getTime() && t < dayEnd.getTime();
    });
    days.push(touched);
  }
  return days;
}

export function computeHoursThisWeek(entries: ActivityLogEntry[], projectId: string): number {
  const weekAgo = Date.now() - 7 * DAY_MS;
  const secs = entries
    .filter(e => e.projectId === projectId && new Date(e.createdAt).getTime() >= weekAgo)
    .reduce((sum, e) => sum + (e.durationSec || 0), 0);
  return Math.round((secs / 3600) * 10) / 10;
}

export interface Recovery { note: string; gapDays: number }

// The drift-nudge feature from the vision doc: "last time this went quiet
// this long, a Tuesday morning got it going again — pulled from your own
// logged activity." Find the most recent entry that broke a quiet stretch at
// least as long as the project's own threshold, and surface its note as
// memory, not instruction. Returns null if nothing like that has happened yet.
export function findRecovery(entries: ActivityLogEntry[], projectId: string, thresholdDays: number): Recovery | null {
  const sorted = entries
    .filter(e => e.projectId === projectId)
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  let best: Recovery | null = null;
  for (let i = 1; i < sorted.length; i++) {
    const gapDays = (new Date(sorted[i].createdAt).getTime() - new Date(sorted[i - 1].createdAt).getTime()) / DAY_MS;
    if (gapDays >= thresholdDays && sorted[i].note) {
      best = { note: sorted[i].note, gapDays: Math.round(gapDays) };
    }
  }
  return best;
}

export function humanizeWhen(iso: string): string {
  const then = new Date(iso);
  const now = new Date();
  const sameDay = then.toDateString() === now.toDateString();
  const time = then.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today · ${time}`;
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (then.toDateString() === yesterday.toDateString()) return `Yesterday · ${time}`;
  const days = Math.floor((now.getTime() - then.getTime()) / DAY_MS);
  if (days < 7) return then.toLocaleDateString([], { weekday: 'long' });
  return then.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatDuration(sec: number): string {
  if (!sec) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ---- Session lines ----------------------------------------------------------
// A logged session lives as one line in its task's Notion page body, so the
// task page doubles as a human-readable work journal. The lines are also the
// app's own record, so they use a strict, parseable shape led by a marker that
// tells app-written lines apart from any prose Katie adds to the same page:
//
//   ▸ 2026-07-07T16:44:54.000Z · 45m · worked the second verse · Live
//
// Fields are " · "-separated: ISO timestamp, minutes, note, then the source
// label. The note has its own delimiters flattened so parsing stays simple.

export const SESSION_MARKER = '▸';
const FIELD_SEP = ' · ';

export interface SessionLine {
  createdAt: string;
  durationSec: number;
  note: string;
  source: 'live' | 'manual';
}

export function formatSessionLine(s: SessionLine): string {
  const mins = Math.round((s.durationSec || 0) / 60);
  const note = (s.note || '').replace(/ · /g, ' - ').trim() || '—';
  const label = s.source === 'manual' ? 'Manual' : 'Live';
  return `${SESSION_MARKER} ${new Date(s.createdAt).toISOString()}${FIELD_SEP}${mins}m${FIELD_SEP}${note}${FIELD_SEP}${label}`;
}

export function parseSessionLine(raw: string): SessionLine | null {
  const line = (raw || '').trim();
  if (!line.startsWith(SESSION_MARKER)) return null;
  const parts = line.slice(SESSION_MARKER.length).trim().split(FIELD_SEP);
  if (parts.length < 2) return null;
  const when = new Date(parts[0].trim());
  if (isNaN(when.getTime())) return null;
  const minMatch = /(\d+(?:\.\d+)?)\s*m/i.exec(parts[1]);
  const durationSec = minMatch ? Math.round(parseFloat(minMatch[1]) * 60) : 0;
  const rest = parts.slice(2);
  let source: 'live' | 'manual' = 'live';
  if (rest.length && /^(live|manual)$/i.test(rest[rest.length - 1].trim())) {
    source = rest.pop()!.trim().toLowerCase() === 'manual' ? 'manual' : 'live';
  }
  const note = rest.join(FIELD_SEP).trim();
  return { createdAt: when.toISOString(), durationSec, note, source };
}

// ---- Weekly reflection ------------------------------------------------------
// Pure derivation over the activity log: this week vs. the week before, who
// rose, who faded, who went dark, plus a couple of momentum stats. Read-only —
// touches no Notion data.

interface ReviewProjectInput { id: string; name: string; quiet: boolean }

function hoursIn(entries: ActivityLogEntry[], from: number, to: number): number {
  const secs = entries.reduce((sum, e) => {
    const t = new Date(e.createdAt).getTime();
    return t >= from && t < to ? sum + (e.durationSec || 0) : sum;
  }, 0);
  return Math.round((secs / 3600) * 10) / 10;
}

export interface Summary { streakDays: number; hoursThisWeek: number; visitsThisMonth: number }

// Stickers-row stats: the longest run of consecutive days (ending today) with
// any logged session, total hours in the last 7 days, and how many sessions
// were logged in the last 30 days — across every project.
export function computeSummary(log: ActivityLogEntry[], now: number = Date.now()): Summary {
  const thisFrom = now - 7 * DAY_MS;
  const end = now + 1;
  const hoursThisWeek = hoursIn(log, thisFrom, end);

  const touchedDays = new Set<string>();
  for (const e of log) touchedDays.add(new Date(e.createdAt).toISOString().slice(0, 10));
  let streakDays = 0;
  for (let i = 0; i < 60; i++) {
    const key = new Date(now - i * DAY_MS).toISOString().slice(0, 10);
    if (touchedDays.has(key)) streakDays++;
    else break;
  }

  const monthFrom = now - 30 * DAY_MS;
  const visitsThisMonth = log.filter(e => new Date(e.createdAt).getTime() >= monthFrom && new Date(e.createdAt).getTime() < end).length;

  return { streakDays, hoursThisWeek, visitsThisMonth };
}

export function computeWeeklyReview(
  log: ActivityLogEntry[],
  projects: ReviewProjectInput[],
  now: number = Date.now(),
): WeeklyReview {
  const thisFrom = now - 7 * DAY_MS;
  const priorFrom = now - 14 * DAY_MS;
  const end = now + 1; // inclusive of a session logged at this instant
  const nameById = new Map(projects.map(p => [p.id, p.name]));

  const byProject = projects.map(p => {
    const entries = log.filter(e => e.projectId === p.id);
    const hoursThisWeek = hoursIn(entries, thisFrom, end);
    const hoursLastWeek = hoursIn(entries, priorFrom, thisFrom);
    const delta = Math.round((hoursThisWeek - hoursLastWeek) * 10) / 10;
    const trend: Trend = hoursThisWeek > hoursLastWeek ? 'rising'
      : hoursThisWeek < hoursLastWeek ? 'fading' : 'steady';
    return { projectId: p.id, name: p.name, hoursThisWeek, hoursLastWeek, delta, trend };
  });

  const thisWeek = log.filter(e => {
    const t = new Date(e.createdAt).getTime();
    return t >= thisFrom && t < end;
  });

  // Busiest calendar day in the window.
  const dayHours = new Map<string, number>();
  for (const e of thisWeek) {
    const d = new Date(e.createdAt);
    const key = d.toISOString().slice(0, 10);
    dayHours.set(key, (dayHours.get(key) || 0) + (e.durationSec || 0) / 3600);
  }
  let busiestDay: WeeklyReview['busiestDay'] = null;
  for (const [key, hrs] of dayHours) {
    if (!busiestDay || hrs > busiestDay.hours) {
      busiestDay = { label: new Date(key + 'T12:00:00').toLocaleDateString([], { weekday: 'long' }), hours: Math.round(hrs * 10) / 10 };
    }
  }

  // Longest run of consecutive days (ending today) with any logged session.
  const touchedDays = new Set([...dayHours.keys()]);
  for (const e of log) touchedDays.add(new Date(e.createdAt).toISOString().slice(0, 10));
  let longestStreakDays = 0;
  for (let i = 0; i < 60; i++) {
    const key = new Date(now - i * DAY_MS).toISOString().slice(0, 10);
    if (touchedDays.has(key)) longestStreakDays++;
    else break;
  }

  const rising = byProject.filter(p => p.hoursThisWeek > 0 && p.delta > 0).sort((a, b) => b.delta - a.delta).map(p => p.name);
  const fading = byProject.filter(p => p.hoursLastWeek > 0 && p.delta < 0).sort((a, b) => a.delta - b.delta).map(p => p.name);
  const wentDark = projects
    .filter(p => p.quiet && log.some(e => e.projectId === p.id))
    .map(p => nameById.get(p.id) || p.name);

  return {
    totalHoursThisWeek: hoursIn(log, thisFrom, end),
    totalHoursLastWeek: hoursIn(log, priorFrom, thisFrom),
    sessionsThisWeek: thisWeek.length,
    activeProjectsThisWeek: byProject.filter(p => p.hoursThisWeek > 0).length,
    longestStreakDays,
    busiestDay,
    byProject: byProject.sort((a, b) => b.hoursThisWeek - a.hoursThisWeek),
    rising,
    fading,
    wentDark,
  };
}
