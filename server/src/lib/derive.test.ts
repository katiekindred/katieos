import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ActivityLogEntry } from '../types.js';
import {
  centralDaysAgo, computeHoursThisWeek, computeStature, computeSummary, computeWeeklyReview, formatSessionLine,
  parseSessionLine, parseThresholdDays,
} from './derive.js';

test('centralDaysAgo counts Central calendar days, flipping at local midnight', () => {
  const now = Date.parse('2026-07-11T04:00:00Z'); // Fri Jul 10, 23:00 CDT — still "today" locally
  assert.equal(centralDaysAgo('2026-07-11T02:00:00Z', now), 0); // 21:00 CDT Jul 10 — same Central day
  assert.equal(centralDaysAgo('2026-07-11T03:59:00Z', now), 0); // moments earlier, still Jul 10 CDT
  assert.equal(centralDaysAgo('2026-07-09T12:00:00Z', now), 1); // Jul 9 CDT — yesterday
  assert.equal(centralDaysAgo('2026-07-04T12:00:00Z', now), 6); // Jul 3 CDT — six days back
  // A UTC-only "24h" reading would call the first two ~0-2h apart from `now` and
  // could bucket them differently; Central-day bucketing keeps them both "today".
});

test('parseThresholdDays reads days/weeks/months and falls back to 14', () => {
  assert.equal(parseThresholdDays('2 weeks'), 14);
  assert.equal(parseThresholdDays('10 days'), 10);
  assert.equal(parseThresholdDays('1 month'), 30);
  assert.equal(parseThresholdDays('whenever'), 14);
});

test('computeStature is clamped and monotonic in hours', () => {
  assert.equal(computeStature(0), 0.1);
  assert.ok(computeStature(1) < computeStature(10));
  assert.ok(computeStature(10) < computeStature(40));
  assert.ok(computeStature(10000) <= 1);
});

test('session lines round-trip through format/parse', () => {
  const line = formatSessionLine({
    createdAt: '2026-07-07T16:44:54.000Z', durationSec: 45 * 60,
    note: 'worked the second verse', source: 'live',
  });
  assert.ok(line.startsWith('▸ '));
  const parsed = parseSessionLine(line);
  assert.ok(parsed);
  assert.equal(parsed!.durationSec, 45 * 60);
  assert.equal(parsed!.note, 'worked the second verse');
  assert.equal(parsed!.source, 'live');
  assert.equal(new Date(parsed!.createdAt).toISOString(), '2026-07-07T16:44:54.000Z');
});

test('parseSessionLine ignores non-marker lines and flattens note delimiters', () => {
  assert.equal(parseSessionLine('just a note Katie typed'), null);
  const line = formatSessionLine({ createdAt: '2026-07-07T10:00:00.000Z', durationSec: 600, note: 'a · b · c', source: 'manual' });
  const parsed = parseSessionLine(line);
  assert.ok(parsed);
  assert.equal(parsed!.source, 'manual');
  assert.equal(parsed!.note, 'a - b - c');
});

test('computeWeeklyReview aggregates this week vs last, rising/fading/wentDark', () => {
  const now = Date.parse('2026-07-12T12:00:00Z'); // Sunday; week runs Mon Jul 6 – Sun Jul 12
  const DAY = 24 * 60 * 60 * 1000;
  const mk = (projectId: string, daysAgo: number, mins: number): ActivityLogEntry => ({
    id: `${projectId}-${daysAgo}`, projectId, startedAt: null, endedAt: null,
    durationSec: mins * 60, note: 'x', source: 'live',
    createdAt: new Date(now - daysAgo * DAY).toISOString(),
  });
  const log = [
    mk('p1', 0, 30), mk('p1', 2, 60), mk('p1', 6, 30), // this week (Jul 12/10/6): 2h
    mk('p1', 9, 60),                                    // last week (Jul 3): 1h
    mk('p2', 10, 45),                                   // last week only (Jul 2): 0.75h, none this week
  ];
  const projects = [
    { id: 'p1', name: 'Guitar', quiet: false },
    { id: 'p2', name: 'Novel', quiet: true },
  ];
  const r = computeWeeklyReview(log, projects, now);

  assert.equal(r.totalHoursThisWeek, 2);
  assert.equal(r.sessionsThisWeek, 3);
  assert.equal(r.activeProjectsThisWeek, 1);
  assert.deepEqual(r.rising, ['Guitar']);
  assert.deepEqual(r.fading, ['Novel']);
  assert.deepEqual(r.wentDark, ['Novel']);
  assert.equal(r.byProject[0].name, 'Guitar');
  assert.equal(r.byProject[0].delta, 1);
  assert.equal(r.longestStreakDays, 1); // a session today (Sun), none Saturday
  assert.ok(r.busiestDay);
  assert.equal(r.busiestDay!.hours, 1); // the 60m session on Friday Jul 10
});

test('computeWeeklyReview compares equal week-to-date slices, not full prior week', () => {
  const now = Date.parse('2026-07-08T12:00:00Z'); // Wednesday; this week is Mon–Wed Jul 6–8
  const DAY = 24 * 60 * 60 * 1000;
  const mk = (daysAgo: number, mins: number): ActivityLogEntry => ({
    id: `p1-${daysAgo}`, projectId: 'p1', startedAt: null, endedAt: null,
    durationSec: mins * 60, note: 'x', source: 'live',
    createdAt: new Date(now - daysAgo * DAY).toISOString(),
  });
  const log = [
    mk(0, 60),  // Wed Jul 8 — this week: 1h
    mk(9, 30),  // Mon Jun 29 — last week, within the Mon–Wed slice: 0.5h
    mk(4, 120), // Sat Jul 4 — last week but AFTER Wed, must be excluded
  ];
  const projects = [{ id: 'p1', name: 'Guitar', quiet: false }];
  const r = computeWeeklyReview(log, projects, now);
  assert.equal(r.totalHoursThisWeek, 1);
  assert.equal(r.totalHoursLastWeek, 0.5); // Saturday's 2h is beyond the to-date slice
  assert.equal(r.byProject[0].delta, 0.5); // rising by half an hour, not down 1.5h
});

test('computeWeeklyReview typicalHoursWeekToDate is the median week-to-date slice of prior weeks', () => {
  const now = Date.parse('2026-07-08T12:00:00Z'); // Wed Jul 8; slice = Mon..Wed
  const DAY = 24 * 60 * 60 * 1000;
  const mk = (daysAgo: number, mins: number): ActivityLogEntry => ({
    id: `p1-${daysAgo}`, projectId: 'p1', startedAt: null, endedAt: null,
    durationSec: mins * 60, note: 'x', source: 'live', createdAt: new Date(now - daysAgo * DAY).toISOString(),
  });
  const log = [
    mk(0, 60),   // this week (Wed Jul 8): 1h — not part of the baseline
    mk(9, 60),   // last week Mon Jun 29 → w=1 slice: 1h
    mk(16, 120), // two weeks back Mon Jun 22 → w=2 slice: 2h
    mk(23, 240), // three weeks back Mon Jun 15 → w=3 slice: 4h
    // w=4 (Jun 8-14) has no activity at all → skipped
  ];
  const r = computeWeeklyReview(log, [{ id: 'p1', name: 'Guitar', quiet: false }], now);
  assert.equal(r.typicalHoursWeekToDate, 2); // median of [1, 2, 4]
});

test('computeWeeklyReview typicalHoursWeekToDate is 0 with no history', () => {
  const now = Date.parse('2026-07-08T12:00:00Z');
  const r = computeWeeklyReview([], [{ id: 'p1', name: 'Guitar', quiet: false }], now);
  assert.equal(r.typicalHoursWeekToDate, 0);
});

test('computeSummary derives streak/hours/visits from the activity log', () => {
  const now = Date.parse('2026-07-07T12:00:00Z');
  const DAY = 24 * 60 * 60 * 1000;
  const mk = (daysAgo: number, mins: number): ActivityLogEntry => ({
    id: `e-${daysAgo}`, projectId: 'p1', startedAt: null, endedAt: null,
    durationSec: mins * 60, note: 'x', source: 'live',
    createdAt: new Date(now - daysAgo * DAY).toISOString(),
  });
  const log = [mk(0, 30), mk(1, 30), mk(2, 60), mk(20, 45)];
  const s = computeSummary(log, now);
  assert.equal(s.streakDays, 3); // today, yesterday, two days ago — unbroken
  assert.equal(s.hoursThisWeek, 1); // Jul 7 is Tue: only Mon Jul 6 (30m) + Tue Jul 7 (30m) count; Sun Jul 5 is last week
  assert.equal(s.visitsThisMonth, 3); // three entries fall in July; the 20-days-ago one is June
});

test('computeSummary buckets streak/visits by Central date, not UTC', () => {
  const now = Date.parse('2026-07-01T12:00:00Z'); // Jul 1, 07:00 CDT
  const mk = (id: string, iso: string): ActivityLogEntry => ({
    id, projectId: 'p1', startedAt: null, endedAt: null,
    durationSec: 60, note: 'x', source: 'live', createdAt: iso,
  });
  // Both timestamps are Jul 1 in UTC, but in Central one falls on Jun 30 night.
  const june = mk('a', '2026-07-01T02:00:00Z'); // Jun 30, 21:00 CDT
  const july = mk('b', '2026-07-01T06:00:00Z'); // Jul 1, 01:00 CDT
  const s = computeSummary([june, july], now);
  assert.equal(s.visitsThisMonth, 1); // only the Central-July session counts
  assert.equal(s.streakDays, 2); // Jul 1 and Jun 30 are distinct local days
});

test('hoursThisWeek is a Central week-to-date starting Monday', () => {
  const now = Date.parse('2026-07-08T12:00:00Z'); // Wed, 07:00 CDT; week began Mon Jul 6
  const mk = (id: string, iso: string, mins: number): ActivityLogEntry => ({
    id, projectId: 'p1', startedAt: null, endedAt: null,
    durationSec: mins * 60, note: 'x', source: 'live', createdAt: iso,
  });
  // Sunday-night-Central session reads as Monday in UTC but must NOT count.
  const sunNight = mk('a', '2026-07-06T02:00:00Z', 60); // Sun Jul 5, 21:00 CDT
  const monEarly = mk('b', '2026-07-06T06:00:00Z', 30); // Mon Jul 6, 01:00 CDT
  const s = computeSummary([sunNight, monEarly], now);
  assert.equal(s.hoursThisWeek, 0.5); // only Monday's 30m falls in the current week
});

test('computeHoursThisWeek is the Central Monday-start week-to-date, not a rolling 7 days', () => {
  const now = Date.parse('2026-07-08T12:00:00Z'); // Wed Jul 8, 07:00 CDT; week began Mon Jul 6
  const mk = (id: string, iso: string, mins: number): ActivityLogEntry => ({
    id, projectId: 'p1', startedAt: null, endedAt: null,
    durationSec: mins * 60, note: 'x', source: 'live', createdAt: iso,
  });
  const sun = mk('a', '2026-07-05T18:00:00Z', 60); // Sun Jul 5 — inside a rolling 7d, outside the Mon-start week
  const tue = mk('b', '2026-07-07T18:00:00Z', 30); // Tue Jul 7 — this week
  assert.equal(computeHoursThisWeek([sun, tue], 'p1', now), 0.5);
});
