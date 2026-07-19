import type { ActivityLogEntry, Trend, WeeklyReview } from '../types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Streak/visit stats are reckoned against the local (Central) calendar, not UTC,
// so a session logged at 11pm counts toward that local day rather than tomorrow.
export const CENTRAL_TZ = 'America/Chicago';
function centralParts(ts: number): { y: string; m: string; d: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CENTRAL_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(ts));
  const get = (t: string) => parts.find(p => p.type === t)!.value;
  return { y: get('year'), m: get('month'), d: get('day') };
}
const centralDayKey = (ts: number) => { const { y, m, d } = centralParts(ts); return `${y}-${m}-${d}`; };
const centralMonthKey = (ts: number) => { const { y, m } = centralParts(ts); return `${y}-${m}`; };

// Whole Central calendar days between `iso`'s local date and today's: 0 if it's
// the same Central day, 1 if yesterday, etc. Comparing pure UTC-midnight anchors
// of each local date keeps the difference DST-proof. Lets "today"/"yesterday"
// labels flip at Central midnight, matching the streak/visit stats.
export function centralDaysAgo(iso: string, now: number = Date.now()): number {
  const then = centralParts(new Date(iso).getTime());
  const today = centralParts(now);
  const thenUTC = Date.UTC(Number(then.y), Number(then.m) - 1, Number(then.d));
  const todayUTC = Date.UTC(Number(today.y), Number(today.m) - 1, Number(today.d));
  return Math.round((todayUTC - thenUTC) / DAY_MS);
}
// Central weekday as a Monday-first index: Mon=0 … Sun=6.
const WEEKDAYS_MON0 = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function centralWeekdayIndex(ts: number): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: CENTRAL_TZ, weekday: 'short' }).format(new Date(ts));
  return WEEKDAYS_MON0.indexOf(wd);
}

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
  return Math.min(1, sessionCount / 10);
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

// The last 7 Central calendar days (oldest first, today last) with whether the
// project was touched on each — reckoned against the Central calendar like
// every other stat here, not server-local midnight.
export function computeWeek(entries: ActivityLogEntry[], projectId: string, now: number = Date.now()): boolean[] {
  const { anchorNoon } = centralWeekWindows(now);
  const touched = new Set<string>();
  for (const e of entries) {
    if (e.projectId === projectId) touched.add(centralDayKey(new Date(e.createdAt).getTime()));
  }
  const days: boolean[] = [];
  for (let i = 6; i >= 0; i--) days.push(touched.has(centralDayKey(anchorNoon - i * DAY_MS)));
  return days;
}

// Hours logged so far this Central Monday-start week (week-to-date), matching
// computeSummary — not a rolling 7 days — so the project card agrees with the
// header sticker and weekly review.
export function computeHoursThisWeek(entries: ActivityLogEntry[], projectId: string, now: number = Date.now()): number {
  const { thisWeekDays } = centralWeekWindows(now);
  return hoursOnDays(entries.filter(e => e.projectId === projectId), thisWeekDays);
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
  const time = new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: CENTRAL_TZ });
  const days = centralDaysAgo(iso);
  if (days <= 0) return `Today · ${time}`;
  if (days === 1) return `Yesterday · ${time}`;
  if (days < 7) return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', timeZone: CENTRAL_TZ });
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: CENTRAL_TZ });
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

// ---- Energy check-in lines --------------------------------------------------
// A one-tap energy check-in lives as one appended line on its own Notion page
// (NOTION_ENERGY_PAGE), mirroring the session-line pattern above so scheduled
// Claude tasks can read the same page later. Same marker, " · "-separated:
//
//   ▸ 2026-07-11T15:04:00.000Z · Yellow · long week, slept ok
//
// Levels are exactly Katie's four states — no numeric scale, no extras.

export type EnergyLevel = 'Green' | 'Yellow' | 'Orange' | 'Red';
export const ENERGY_LEVELS: readonly EnergyLevel[] = ['Green', 'Yellow', 'Orange', 'Red'];
// Rank for slide detection: higher = lower energy.
const ENERGY_RANK: Record<EnergyLevel, number> = { Green: 0, Yellow: 1, Orange: 2, Red: 3 };

export interface EnergyLine { createdAt: string; level: EnergyLevel; note: string }

export function formatEnergyLine(e: EnergyLine): string {
  const note = (e.note || '').replace(/ · /g, ' - ').trim() || '—';
  return `${SESSION_MARKER} ${new Date(e.createdAt).toISOString()}${FIELD_SEP}${e.level}${FIELD_SEP}${note}`;
}

// Null for anything that doesn't start with the marker, has a bad timestamp,
// or names an unknown level. The empty-note placeholder `—` parses back to ''.
export function parseEnergyLine(raw: string): EnergyLine | null {
  const line = (raw || '').trim();
  if (!line.startsWith(SESSION_MARKER)) return null;
  const parts = line.slice(SESSION_MARKER.length).trim().split(FIELD_SEP);
  if (parts.length < 2) return null;
  const when = new Date(parts[0].trim());
  if (isNaN(when.getTime())) return null;
  const level = parts[1].trim() as EnergyLevel;
  if (!ENERGY_LEVELS.includes(level)) return null;
  const note = parts.slice(2).join(FIELD_SEP).trim();
  return { createdAt: when.toISOString(), level, note: note === '—' ? '' : note };
}

// ---- Weekly reflection ------------------------------------------------------
// Pure derivation over the activity log: this week vs. the week before, who
// rose, who faded, who went dark, plus a couple of momentum stats. Read-only —
// touches no Notion data.

interface ReviewProjectInput { id: string; name: string; quiet: boolean }

// Sum, in hours, the sessions whose Central date falls on one of `days`.
function hoursOnDays(entries: ActivityLogEntry[], days: Set<string>): number {
  const secs = entries.reduce((sum, e) =>
    days.has(centralDayKey(new Date(e.createdAt).getTime())) ? sum + (e.durationSec || 0) : sum, 0);
  return Math.round((secs / 3600) * 10) / 10;
}

// The two Central calendar weeks that "this week vs last week" compares against.
// Weeks start Monday; the current week runs Monday-through-today (week-to-date),
// and last week is the SAME-LENGTH slice — last Monday through last week's same
// weekday as today — so a partial week is always compared against an equal span.
// anchorNoon is noon UTC of today's Central date, a DST-safe pivot for stepping
// back whole days.
function centralWeekWindows(now: number): {
  anchorNoon: number; daysSinceMonday: number; thisWeekDays: Set<string>; lastWeekDays: Set<string>;
} {
  const today = centralParts(now);
  const anchorNoon = Date.UTC(Number(today.y), Number(today.m) - 1, Number(today.d), 12);
  const daysSinceMonday = centralWeekdayIndex(now);
  const thisWeekDays = new Set<string>();
  for (let i = 0; i <= daysSinceMonday; i++) thisWeekDays.add(centralDayKey(anchorNoon - i * DAY_MS));
  // Shift the same window back exactly 7 days: i=7 is last week's same weekday as
  // today, i=daysSinceMonday+7 is last Monday.
  const lastWeekDays = new Set<string>();
  for (let i = 7; i <= daysSinceMonday + 7; i++) lastWeekDays.add(centralDayKey(anchorNoon - i * DAY_MS));
  return { anchorNoon, daysSinceMonday, thisWeekDays, lastWeekDays };
}

export interface Summary { streakDays: number; hoursThisWeek: number; visitsThisMonth: number }

// Longest run of consecutive Central days ending today (i=0) with any logged
// session. Shared by the stickers streak and the weekly reflection. Steps back
// from anchorNoon (noon UTC of today's Central date), not `now`, so the walk
// stays DST-proof.
export function computeStreakDays(log: ActivityLogEntry[], now: number): number {
  const { anchorNoon } = centralWeekWindows(now);
  const touched = new Set<string>();
  for (const e of log) touched.add(centralDayKey(new Date(e.createdAt).getTime()));
  let streak = 0;
  for (let i = 0; i < 60; i++) {
    if (touched.has(centralDayKey(anchorNoon - i * DAY_MS))) streak++;
    else break;
  }
  return streak;
}

// Stickers-row stats: the longest run of consecutive days (ending today) with
// any logged session, hours logged so far this week (Central, weeks start
// Monday), and how many sessions were logged this calendar month — across every
// project. All three are reckoned against the Central calendar, not UTC.
export function computeSummary(log: ActivityLogEntry[], now: number = Date.now()): Summary {
  const { thisWeekDays } = centralWeekWindows(now);

  const streakDays = computeStreakDays(log, now);

  // Week-to-date: sum sessions whose Central date falls on Monday-through-today.
  const hoursThisWeek = hoursOnDays(log, thisWeekDays);

  const currentMonth = centralMonthKey(now);
  const visitsThisMonth = log.filter(e => centralMonthKey(new Date(e.createdAt).getTime()) === currentMonth).length;

  return { streakDays, hoursThisWeek, visitsThisMonth };
}

export function computeWeeklyReview(
  log: ActivityLogEntry[],
  projects: ReviewProjectInput[],
  now: number = Date.now(),
): WeeklyReview {
  // Central calendar weeks (Monday-start): this week is Monday-to-today; last
  // week is the same-length week-to-date slice of the prior week, so the two are
  // always compared over an equal number of days.
  const { thisWeekDays, lastWeekDays, anchorNoon, daysSinceMonday } = centralWeekWindows(now);

  const byProject = projects.map(p => {
    const entries = log.filter(e => e.projectId === p.id);
    const hoursThisWeek = hoursOnDays(entries, thisWeekDays);
    const hoursLastWeek = hoursOnDays(entries, lastWeekDays);
    const delta = Math.round((hoursThisWeek - hoursLastWeek) * 10) / 10;
    const trend: Trend = hoursThisWeek > hoursLastWeek ? 'rising'
      : hoursThisWeek < hoursLastWeek ? 'fading' : 'steady';
    return { projectId: p.id, name: p.name, hoursThisWeek, hoursLastWeek, delta, trend };
  });

  const thisWeek = log.filter(e => thisWeekDays.has(centralDayKey(new Date(e.createdAt).getTime())));
  const lastWeek = log.filter(e => lastWeekDays.has(centralDayKey(new Date(e.createdAt).getTime())));

  // Busiest Central day this week.
  const dayHours = new Map<string, number>();
  for (const e of thisWeek) {
    const key = centralDayKey(new Date(e.createdAt).getTime());
    dayHours.set(key, (dayHours.get(key) || 0) + (e.durationSec || 0) / 3600);
  }
  let busiestDay: WeeklyReview['busiestDay'] = null;
  for (const [key, hrs] of dayHours) {
    if (!busiestDay || hrs > busiestDay.hours) {
      busiestDay = { label: new Date(key + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }), hours: Math.round(hrs * 10) / 10 };
    }
  }

  const longestStreakDays = computeStreakDays(log, now);

  const rising = byProject.filter(p => p.hoursThisWeek > 0 && p.delta > 0).sort((a, b) => b.delta - a.delta).map(p => p.name);
  const fading = byProject.filter(p => p.hoursLastWeek > 0 && p.delta < 0).sort((a, b) => a.delta - b.delta).map(p => p.name);
  const wentDark = projects
    .filter(p => p.quiet && log.some(e => e.projectId === p.id))
    .map(p => p.name);

  // "Typical" pace: the median of the same Monday-through-today slice over the 4
  // prior weeks. Weeks with no logged activity at all (their FULL 7 days) are
  // skipped so a vacation or the pre-app era doesn't drag the baseline to zero.
  const priorSlices: number[] = [];
  for (let w = 1; w <= 4; w++) {
    const fullWeek = new Set<string>();
    // For w=1, d=1..7 gives last Sunday back through last Monday — exactly last
    // calendar week (e.g. today = Wed Jul 8: offsets daysSinceMonday+1..+7 =
    // 3..9 days back = Sun Jul 5 .. Mon Jun 29). Each subsequent w shifts the
    // whole 7-day block back another 7 days.
    for (let d = 1; d <= 7; d++) fullWeek.add(centralDayKey(anchorNoon - (daysSinceMonday + (w - 1) * 7 + d) * DAY_MS));
    if (hoursOnDays(log, fullWeek) === 0) continue;
    const slice = new Set<string>();
    for (let i = w * 7; i <= daysSinceMonday + w * 7; i++) slice.add(centralDayKey(anchorNoon - i * DAY_MS));
    priorSlices.push(hoursOnDays(log, slice));
  }
  priorSlices.sort((a, b) => a - b);
  const mid = priorSlices.length / 2;
  const typicalHoursWeekToDate = priorSlices.length === 0 ? 0
    : Math.round((priorSlices.length % 2 ? priorSlices[Math.floor(mid)] : (priorSlices[mid - 1] + priorSlices[mid]) / 2) * 10) / 10;

  return {
    totalHoursThisWeek: hoursOnDays(log, thisWeekDays),
    totalHoursLastWeek: hoursOnDays(log, lastWeekDays),
    sessionsThisWeek: thisWeek.length,
    sessionsLastWeek: lastWeek.length,
    activeProjectsThisWeek: byProject.filter(p => p.hoursThisWeek > 0).length,
    longestStreakDays,
    busiestDay,
    byProject: byProject.sort((a, b) => b.hoursThisWeek - a.hoursThisWeek),
    rising,
    fading,
    wentDark,
    typicalHoursWeekToDate,
  };
}

// ---- Energy forecast --------------------------------------------------------
// The early-warning layer: read the signals the app already tracks (session
// cadence, quiet buildings, streaks, calendar density, self-reported check-ins)
// and turn them into skyline weather. Simple explainable rules, no ML — every
// fired signal contributes one plain-language reason, so a warning can always
// name its evidence.

export type Weather = 'clear' | 'clouding' | 'storm';
export interface EnergyForecast { weather: Weather; reasons: string[] }

// 10+ events in the coming week reads as a heavy calendar. Tuned by feel, not
// data — if it proves noisy in practice, change it here (and only here).
export const HEAVY_CALENDAR_EVENTS = 10;

// "Recent" for check-ins is today-or-yesterday on the Central calendar (the
// spec's "within 24h", bucketed the same way as every other stat in this app).
const RECENT_CHECKIN_DAYS = 1;
// A check-in is stale after this many Central days without one ("hygiene slips
// first" — silence on both channels is itself a signal).
const CHECKIN_SILENCE_DAYS = 5;

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

// The most recent run of consecutive Central days with a session that ended
// 1–7 days ago: its length and how many days ago it ended. Null if the last
// touched day is today (streak alive) or more than a week back.
function recentEndedStreak(log: ActivityLogEntry[], anchorNoon: number): { length: number; endedDaysAgo: number } | null {
  const touched = new Set<string>();
  for (const e of log) touched.add(centralDayKey(new Date(e.createdAt).getTime()));
  if (touched.has(centralDayKey(anchorNoon))) return null; // still going — not "ended"
  for (let gap = 1; gap <= 7; gap++) {
    if (!touched.has(centralDayKey(anchorNoon - gap * DAY_MS))) continue;
    let length = 0;
    for (let i = gap; i < gap + 60; i++) {
      if (touched.has(centralDayKey(anchorNoon - i * DAY_MS))) length++;
      else break;
    }
    return { length, endedDaysAgo: gap };
  }
  return null;
}

// Inputs deviate from the original sketch in three deliberate ways:
// `activityLog` is passed so the streak-break signal can see which days were
// touched (Summary alone can't say a 5+ day streak just ended);
// `calendarEventCountNext7d` is nullable so an unconfigured/unauthorized
// calendar contributes nothing rather than reading as an empty week; and
// `checkinEnabled` lets the double-silence signal stand down when
// NOTION_ENERGY_PAGE isn't set (no check-ins ever ≠ five days of silence).
export function computeEnergyForecast(inputs: {
  energyLog: EnergyLine[];                  // newest first
  review: WeeklyReview;
  summary: Summary;
  activityLog: ActivityLogEntry[];
  quietProjectCount: number;
  visibleProjectCount: number;
  calendarEventCountNext7d: number | null;  // null = calendar unavailable
  checkinEnabled?: boolean;                 // default true
  now?: Date;
}): EnergyForecast {
  const { energyLog, review, summary, activityLog, quietProjectCount, visibleProjectCount } = inputs;
  const checkinEnabled = inputs.checkinEnabled !== false;
  const nowMs = (inputs.now ?? new Date()).getTime();
  const today = centralParts(nowMs);
  const anchorNoon = Date.UTC(Number(today.y), Number(today.m) - 1, Number(today.d), 12);

  const reasons: string[] = [];

  // Cadence drop: this week's sessions fell to less than half of last week's
  // (equal week-to-date slices, so a Tuesday is compared against last Tuesday).
  if (review.sessionsLastWeek > 0 && review.sessionsThisWeek < review.sessionsLastWeek / 2) {
    const thisPart = review.sessionsThisWeek === 0 ? 'no sessions this week' : `${plural(review.sessionsThisWeek, 'session')} this week`;
    reasons.push(`${thisPart}, down from ${review.sessionsLastWeek} last week`);
  }

  // Darkening skyline: several houses went dark this week, or most of the
  // visible street is quiet.
  if (review.wentDark.length >= 2) {
    reasons.push(`${review.wentDark.length} buildings went dark this week`);
  } else if (visibleProjectCount > 0 && quietProjectCount > visibleProjectCount / 2) {
    reasons.push(`${quietProjectCount} of ${visibleProjectCount} buildings quiet`);
  }

  // Streak break: a 5+ day streak ended within the last 7 days and nothing has
  // been logged today.
  if (summary.streakDays === 0) {
    const ended = recentEndedStreak(activityLog, anchorNoon);
    if (ended && ended.length >= 5) {
      reasons.push(`a ${ended.length}-day streak ended ${plural(ended.endedDaysAgo, 'day')} ago`);
    }
  }

  // Heavy calendar: only when the calendar is actually readable.
  if (inputs.calendarEventCountNext7d != null && inputs.calendarEventCountNext7d >= HEAVY_CALENDAR_EVENTS) {
    reasons.push(`${inputs.calendarEventCountNext7d} calendar events in the next 7 days`);
  }

  // Self-reported slide: the two most recent check-ins within 7 days are
  // strictly worsening, or the latest of them is already Orange or Red.
  const within7 = energyLog.filter(e => centralDaysAgo(e.createdAt, nowMs) <= 7);
  if (within7.length >= 2 && ENERGY_RANK[within7[0].level] > ENERGY_RANK[within7[1].level]) {
    reasons.push(`check-ins sliding, ${within7[1].level} to ${within7[0].level}`);
  } else if (within7.length >= 1 && (within7[0].level === 'Orange' || within7[0].level === 'Red')) {
    reasons.push(`latest check-in is ${within7[0].level}`);
  }

  // Double silence: no check-in in 5+ days AND no sessions this week — the
  // "hygiene slips first" tell. Weak on its own (one signal = clouding at most).
  if (checkinEnabled && review.sessionsThisWeek === 0) {
    const lastCheckinDaysAgo = energyLog.length ? centralDaysAgo(energyLog[0].createdAt, nowMs) : null;
    if (lastCheckinDaysAgo == null) {
      reasons.push('no check-ins yet and no sessions this week');
    } else if (lastCheckinDaysAgo >= CHECKIN_SILENCE_DAYS) {
      reasons.push(`no check-in in ${plural(lastCheckinDaysAgo, 'day')} and no sessions this week`);
    }
  }

  // Weather. A recent explicit check-in is ground truth: Orange/Red forces
  // storm; Green caps at clouding no matter how many behavioral signals fire.
  const latest = energyLog[0];
  const latestRecent = latest && centralDaysAgo(latest.createdAt, nowMs) <= RECENT_CHECKIN_DAYS ? latest : null;

  let weather: Weather;
  if ((latestRecent && (latestRecent.level === 'Orange' || latestRecent.level === 'Red')) || reasons.length >= 3) {
    weather = 'storm';
  } else if (reasons.length >= 1) {
    weather = 'clouding';
  } else {
    weather = 'clear';
  }

  if (weather === 'storm' && latestRecent?.level === 'Green') {
    weather = 'clouding';
    reasons.unshift('you said Green recently, so treating this as clouds, not a storm');
  }

  return { weather, reasons };
}
