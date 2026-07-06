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

// activity: recency of last-edited blended with how many logged sessions
// happened in the last 30 days, normalized to 0-1. A project with no recent
// edits and no recent sessions settles near ~0.05 (never exactly 0, so a
// quiet project still shows a sliver of light — "quiet, not gone").
export function computeActivity(lastMovedAt: string | null, entries: ActivityLogEntry[]): number {
  const recency = Math.max(0, 1 - daysSince(lastMovedAt) / 30);
  const sessionCount = entriesSince(entries, 30).length;
  const sessionScore = Math.min(1, sessionCount / 10);
  const raw = recency * 0.6 + sessionScore * 0.4;
  return Math.max(0.05, Math.round(raw * 100) / 100);
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

// stature: relative ambition/size of the goal — tall buildings for long-horizon
// goals (a 5-year album) even when quiet. Prefers an explicit per-project
// "Goal horizon (days)" Notion property; falls back to spreading stated
// priority ranks evenly so the skyline still has visual variety without it.
export function computeStature(goalHorizonDays: number | null, rank: number, total: number): number {
  if (goalHorizonDays != null && goalHorizonDays > 0) {
    // 2 weeks -> ~0.1, 5 years -> ~1.0, log scale so short-horizon projects
    // aren't squashed to nothing next to multi-year goals.
    const years = goalHorizonDays / 365;
    return Math.max(0.1, Math.min(1, Math.log10(years * 10 + 1) / Math.log10(51)));
  }
  if (total <= 1) return 0.5;
  return Math.max(0.15, 1 - (rank - 1) / (total - 1) * 0.7);
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
