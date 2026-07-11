import { Router } from 'express';
import {
  computeEnergyForecast, computeSummary, computeWeeklyReview, ENERGY_LEVELS,
  type EnergyLevel,
} from '../lib/derive.js';
import { appendEnergyLine, configuredWorkspaces, fetchEnergyLog, fetchProjects, isEnergyConfigured } from '../lib/notion.js';
import { fetchUpcomingEvents, isGoogleAuthorized, isGoogleConfigured } from '../lib/google.js';

export const energyRouter = Router();

const DAY_MS = 24 * 60 * 60 * 1000;

// One-tap check-in. Body: { level: 'Green'|'Yellow'|'Orange'|'Red', note? }.
// Appends a line to NOTION_ENERGY_PAGE and returns the saved entry.
energyRouter.post('/', async (req, res) => {
  if (!isEnergyConfigured()) {
    return res.status(503).json({ error: 'Energy check-ins are not configured yet. Set NOTION_ENERGY_PAGE. See server/.env.example.' });
  }
  const level = req.body?.level as EnergyLevel;
  if (!ENERGY_LEVELS.includes(level)) {
    return res.status(400).json({ error: `level must be one of ${ENERGY_LEVELS.join(', ')}` });
  }
  const entry = { createdAt: new Date().toISOString(), level, note: typeof req.body?.note === 'string' ? req.body.note : '' };
  await appendEnergyLine(entry);
  res.json({ entry });
});

// Parsed check-ins within the window (?days=30, default 30), newest first.
energyRouter.get('/', async (req, res) => {
  if (!isEnergyConfigured()) {
    return res.status(503).json({ error: 'Energy check-ins are not configured yet. Set NOTION_ENERGY_PAGE. See server/.env.example.' });
  }
  const days = Math.max(1, Number(req.query.days) || 30);
  const cutoff = Date.now() - days * DAY_MS;
  const entries = (await fetchEnergyLog()).filter(e => new Date(e.createdAt).getTime() >= cutoff);
  res.json({ entries });
});

// The forecast: skyline weather plus the plain-language reasons behind it.
// Composed entirely from data the app already derives; a missing energy page
// or calendar auth just means those signals contribute nothing.
energyRouter.get('/forecast', async (_req, res) => {
  if (configuredWorkspaces().length === 0) {
    return res.status(503).json({ error: 'Notion is not configured yet. See server/.env.example.' });
  }
  const { projects, log } = await fetchProjects();
  const review = computeWeeklyReview(log, projects.map(p => ({ id: p.id, name: p.name, quiet: p.quiet })));
  const summary = computeSummary(log);

  // Calendar density, when the calendar is readable; null keeps that signal
  // silent (matches the 503/401 handling on /api/calendar).
  let calendarEventCountNext7d: number | null = null;
  if (isGoogleConfigured() && isGoogleAuthorized()) {
    try {
      const events = await fetchUpcomingEvents(projects.map(p => p.name));
      const horizon = Date.now() + 7 * DAY_MS;
      calendarEventCountNext7d = events.filter(e => new Date(e.startISO).getTime() <= horizon).length;
    } catch {
      calendarEventCountNext7d = null;
    }
  }

  const energyLog = await fetchEnergyLog();
  res.json(computeEnergyForecast({
    energyLog,
    review,
    summary,
    activityLog: log,
    quietProjectCount: projects.filter(p => p.quiet).length,
    visibleProjectCount: projects.length,
    calendarEventCountNext7d,
    checkinEnabled: isEnergyConfigured(),
  }));
});
