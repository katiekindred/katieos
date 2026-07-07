import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ActivityLogEntry } from '../types.js';
import {
  computeStature, computeWeeklyReview, formatSessionLine, parseSessionLine,
  parseThresholdDays,
} from './derive.js';

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
  const now = Date.parse('2026-07-07T12:00:00Z');
  const DAY = 24 * 60 * 60 * 1000;
  const mk = (projectId: string, daysAgo: number, mins: number): ActivityLogEntry => ({
    id: `${projectId}-${daysAgo}`, projectId, startedAt: null, endedAt: null,
    durationSec: mins * 60, note: 'x', source: 'live',
    createdAt: new Date(now - daysAgo * DAY).toISOString(),
  });
  const log = [
    mk('p1', 0, 30), mk('p1', 2, 60), mk('p1', 5, 30), // this week: 2h
    mk('p1', 10, 60),                                   // last week: 1h
    mk('p2', 9, 45),                                    // last week only: 0.75h, none this week
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
  assert.equal(r.longestStreakDays, 1); // a session today, none yesterday
  assert.ok(r.busiestDay);
  assert.equal(r.busiestDay!.hours, 1); // the 60m session two days ago
});
