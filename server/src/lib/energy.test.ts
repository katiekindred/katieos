import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ActivityLogEntry, WeeklyReview } from '../types.js';
import {
  computeEnergyForecast, formatEnergyLine, HEAVY_CALENDAR_EVENTS, parseEnergyLine,
  type EnergyLine, type Summary,
} from './derive.js';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
// Saturday July 11 2026, noon CDT — a fixed "now" for every forecast test.
const NOW = Date.parse('2026-07-11T17:00:00Z');

// ---- energy line round-trip -------------------------------------------------

test('formatEnergyLine/parseEnergyLine round-trip', () => {
  const line = formatEnergyLine({ createdAt: '2026-07-11T15:04:00.000Z', level: 'Yellow', note: 'long week, slept ok' });
  assert.equal(line, '▸ 2026-07-11T15:04:00.000Z · Yellow · long week, slept ok');
  assert.deepEqual(parseEnergyLine(line), { createdAt: '2026-07-11T15:04:00.000Z', level: 'Yellow', note: 'long week, slept ok' });
});

test('formatEnergyLine flattens the field delimiter inside notes', () => {
  const line = formatEnergyLine({ createdAt: '2026-07-11T15:04:00.000Z', level: 'Green', note: 'walk · coffee' });
  assert.ok(line.endsWith('Green · walk - coffee'));
  assert.equal(parseEnergyLine(line)!.note, 'walk - coffee');
});

test('empty note renders as — and parses back to empty', () => {
  const line = formatEnergyLine({ createdAt: '2026-07-11T15:04:00.000Z', level: 'Red', note: '  ' });
  assert.ok(line.endsWith('Red · —'));
  assert.equal(parseEnergyLine(line)!.note, '');
});

test('parseEnergyLine rejects non-marker lines, unknown levels, bad timestamps', () => {
  assert.equal(parseEnergyLine('2026-07-11T15:04:00.000Z · Yellow · x'), null);
  assert.equal(parseEnergyLine('▸ 2026-07-11T15:04:00.000Z · Purple · x'), null);
  assert.equal(parseEnergyLine('▸ not-a-date · Yellow · x'), null);
  assert.equal(parseEnergyLine('▸ 2026-07-11T15:04:00.000Z'), null);
  assert.equal(parseEnergyLine('some prose Katie wrote on the page'), null);
});

// ---- forecast fixtures ------------------------------------------------------

const baseReview: WeeklyReview = {
  totalHoursThisWeek: 3, totalHoursLastWeek: 3, sessionsThisWeek: 4, sessionsLastWeek: 4,
  activeProjectsThisWeek: 2, longestStreakDays: 2, busiestDay: null,
  byProject: [], rising: [], fading: [], wentDark: [],
};
const baseSummary: Summary = { streakDays: 2, hoursThisWeek: 3, visitsThisMonth: 8 };

function checkin(msAgo: number, level: EnergyLine['level']): EnergyLine {
  return { createdAt: new Date(NOW - msAgo).toISOString(), level, note: '' };
}

function session(msAgo: number): ActivityLogEntry {
  return {
    id: `s${msAgo}`, projectId: 'p1', startedAt: null, endedAt: null,
    durationSec: 1800, note: 'x', source: 'live', createdAt: new Date(NOW - msAgo).toISOString(),
  };
}

type ForecastInputs = Parameters<typeof computeEnergyForecast>[0];
function forecast(overrides: Partial<ForecastInputs> = {}) {
  return computeEnergyForecast({
    energyLog: [], review: baseReview, summary: baseSummary, activityLog: [],
    quietProjectCount: 1, visibleProjectCount: 5, calendarEventCountNext7d: null,
    now: new Date(NOW), ...overrides,
  });
}

// ---- individual signals -----------------------------------------------------

test('everything clear: no signals, no reasons', () => {
  assert.deepEqual(forecast(), { weather: 'clear', reasons: [] });
});

test('cadence drop fires alone at under half of last week, not at exactly half', () => {
  const f = forecast({ review: { ...baseReview, sessionsThisWeek: 1, sessionsLastWeek: 6 } });
  assert.equal(f.weather, 'clouding');
  assert.deepEqual(f.reasons, ['1 session this week, down from 6 last week']);
  assert.equal(forecast({ review: { ...baseReview, sessionsThisWeek: 2, sessionsLastWeek: 4 } }).weather, 'clear');
  // Last week empty means there is no cadence to drop from (check-ins disabled
  // here so the double-silence signal can't muddy the assertion).
  assert.equal(forecast({ review: { ...baseReview, sessionsThisWeek: 0, sessionsLastWeek: 0 }, checkinEnabled: false }).weather, 'clear');
});

test('darkening skyline fires on 2+ wentDark or a mostly-quiet street', () => {
  const dark = forecast({ review: { ...baseReview, wentDark: ['Novel', 'Guitar'] } });
  assert.equal(dark.weather, 'clouding');
  assert.deepEqual(dark.reasons, ['2 buildings went dark this week']);

  const quiet = forecast({ quietProjectCount: 3, visibleProjectCount: 5 });
  assert.equal(quiet.weather, 'clouding');
  assert.deepEqual(quiet.reasons, ['3 of 5 buildings quiet']);

  assert.equal(forecast({ quietProjectCount: 2, visibleProjectCount: 5 }).weather, 'clear');
});

test('streak break fires when a 5+ day streak ended within the last week', () => {
  // Sessions on days 2..7 ago: a 6-day streak that ended 2 days ago.
  const log = [2, 3, 4, 5, 6, 7].map(d => session(d * DAY));
  const f = forecast({ summary: { ...baseSummary, streakDays: 0 }, activityLog: log });
  assert.equal(f.weather, 'clouding');
  assert.deepEqual(f.reasons, ['a 6-day streak ended 2 days ago']);

  // A short run (3 days) ending recently is not a broken streak.
  const short = [2, 3, 4].map(d => session(d * DAY));
  assert.equal(forecast({ summary: { ...baseSummary, streakDays: 0 }, activityLog: short }).weather, 'clear');

  // A live streak (session today) never reads as broken.
  const live = [0, 1, 2, 3, 4, 5].map(d => session(d * DAY));
  assert.equal(forecast({ summary: { ...baseSummary, streakDays: 6 }, activityLog: live }).weather, 'clear');
});

test('heavy calendar fires at the named threshold and stays silent when unavailable', () => {
  const f = forecast({ calendarEventCountNext7d: 12 });
  assert.equal(f.weather, 'clouding');
  assert.deepEqual(f.reasons, ['12 calendar events in the next 7 days']);
  assert.equal(forecast({ calendarEventCountNext7d: HEAVY_CALENDAR_EVENTS - 1 }).weather, 'clear');
  assert.equal(forecast({ calendarEventCountNext7d: null }).weather, 'clear');
});

test('self-reported slide: two most recent check-ins within 7 days strictly worsening', () => {
  const f = forecast({ energyLog: [checkin(3 * DAY, 'Orange'), checkin(5 * DAY, 'Yellow')] });
  assert.equal(f.weather, 'clouding');
  assert.deepEqual(f.reasons, ['check-ins sliding, Yellow to Orange']);
  // Improving or steady check-ins are not a slide.
  assert.equal(forecast({ energyLog: [checkin(3 * DAY, 'Yellow'), checkin(5 * DAY, 'Orange')] }).weather, 'clear');
  assert.equal(forecast({ energyLog: [checkin(3 * DAY, 'Yellow'), checkin(5 * DAY, 'Yellow')] }).weather, 'clear');
});

test('a lone Orange/Red check-in within 7 days fires the slide signal', () => {
  const f = forecast({ energyLog: [checkin(4 * DAY, 'Orange')] });
  assert.equal(f.weather, 'clouding');
  assert.deepEqual(f.reasons, ['latest check-in is Orange']);
  // Older than 7 days: out of the window.
  assert.equal(forecast({ energyLog: [checkin(8 * DAY, 'Orange')] }).weather, 'clear');
});

test('double silence fires only with check-ins enabled, and never reads as Red on its own', () => {
  const quietWeek = { ...baseReview, sessionsThisWeek: 0, sessionsLastWeek: 0 };
  const f = forecast({ review: quietWeek, energyLog: [checkin(6 * DAY, 'Green')] });
  assert.equal(f.weather, 'clouding'); // one weak signal = clouding, not storm
  assert.deepEqual(f.reasons, ['no check-in in 6 days and no sessions this week']);

  const never = forecast({ review: quietWeek });
  assert.deepEqual(never.reasons, ['no check-ins yet and no sessions this week']);

  // NOTION_ENERGY_PAGE unset: inference runs without self-report signals.
  assert.equal(forecast({ review: quietWeek, checkinEnabled: false }).weather, 'clear');
  // A fresh check-in clears the silence even if the week logged no sessions.
  assert.equal(forecast({ review: quietWeek, energyLog: [checkin(2 * HOUR, 'Yellow')] }).weather, 'clear');
});

// ---- weather boundaries and ground truth -------------------------------------

test('signal counts cross the clouding/storm boundaries', () => {
  const two = forecast({
    review: { ...baseReview, sessionsThisWeek: 1, sessionsLastWeek: 6, wentDark: ['Novel', 'Guitar'] },
  });
  assert.equal(two.weather, 'clouding');
  assert.equal(two.reasons.length, 2);

  const three = forecast({
    review: { ...baseReview, sessionsThisWeek: 1, sessionsLastWeek: 6, wentDark: ['Novel', 'Guitar'] },
    calendarEventCountNext7d: 12,
  });
  assert.equal(three.weather, 'storm');
  assert.equal(three.reasons.length, 3);
});

test('a recent Orange or Red check-in is ground truth: storm on that alone', () => {
  const f = forecast({ energyLog: [checkin(2 * HOUR, 'Orange')] });
  assert.equal(f.weather, 'storm');
  assert.deepEqual(f.reasons, ['latest check-in is Orange']); // still explainable
  assert.equal(forecast({ energyLog: [checkin(2 * HOUR, 'Red')] }).weather, 'storm');
});

test('a recent Yellow check-in with a signal firing stays clouding', () => {
  const f = forecast({
    energyLog: [checkin(2 * HOUR, 'Yellow')],
    review: { ...baseReview, wentDark: ['Novel', 'Guitar'] },
  });
  assert.equal(f.weather, 'clouding');
});

test('Green within 24h caps a 3-signal storm at clouding and says why', () => {
  const f = forecast({
    energyLog: [checkin(2 * HOUR, 'Green')],
    review: { ...baseReview, sessionsThisWeek: 1, sessionsLastWeek: 6, wentDark: ['Novel', 'Guitar'] },
    calendarEventCountNext7d: 12,
  });
  assert.equal(f.weather, 'clouding');
  assert.equal(f.reasons[0], 'you said Green recently, so treating this as clouds, not a storm');
  assert.equal(f.reasons.length, 4); // the cap explains itself on top of the evidence
});

test('empty energy log with behavioral signals still forecasts', () => {
  const f = forecast({
    energyLog: [],
    review: { ...baseReview, sessionsThisWeek: 1, sessionsLastWeek: 6, wentDark: ['Novel', 'Guitar'] },
    calendarEventCountNext7d: 12,
  });
  assert.equal(f.weather, 'storm'); // no Green on file, nothing to cap it
});

// ---- timezone edges ----------------------------------------------------------

test('check-in recency windows are Central calendar days, not UTC', () => {
  // 23:00 CDT July 10; a check-in at 21:00 CDT the same local evening is
  // "today", and one from the previous local evening still counts as recent.
  const lateNight = Date.parse('2026-07-11T04:00:00Z');
  const stormy = {
    review: { ...baseReview, sessionsThisWeek: 1, sessionsLastWeek: 6, wentDark: ['Novel', 'Guitar'] },
    calendarEventCountNext7d: 12,
  };
  const sameEvening = computeEnergyForecast({
    energyLog: [{ createdAt: '2026-07-11T02:00:00Z', level: 'Green', note: '' }],
    summary: baseSummary, activityLog: [], quietProjectCount: 1, visibleProjectCount: 5,
    now: new Date(lateNight), ...stormy,
  });
  assert.equal(sameEvening.weather, 'clouding'); // Green caps the storm

  const eightDaysBack = computeEnergyForecast({
    energyLog: [{ createdAt: '2026-07-03T02:00:00Z', level: 'Green', note: '' }],
    summary: baseSummary, activityLog: [], quietProjectCount: 1, visibleProjectCount: 5,
    now: new Date(lateNight), ...stormy,
  });
  assert.equal(eightDaysBack.weather, 'storm'); // too old to be ground truth
});

test('recency survives the DST fall-back edge', () => {
  // DST ends Nov 1 2026. Now: midnight CST Nov 2. A Green check-in at
  // 01:00 CDT Nov 1 is exactly one Central day back across the changeover,
  // so it still reads as recent and caps the storm.
  const afterFallBack = Date.parse('2026-11-02T06:00:00Z');
  const f = computeEnergyForecast({
    energyLog: [{ createdAt: '2026-11-01T06:00:00Z', level: 'Green', note: '' }],
    review: { ...baseReview, sessionsThisWeek: 1, sessionsLastWeek: 6, wentDark: ['Novel', 'Guitar'] },
    summary: baseSummary, activityLog: [], quietProjectCount: 1, visibleProjectCount: 5,
    calendarEventCountNext7d: 12, now: new Date(afterFallBack),
  });
  assert.equal(f.weather, 'clouding');
});
