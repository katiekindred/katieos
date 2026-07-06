import type { ActivityLogEntry, Trend } from '../types.js';

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
