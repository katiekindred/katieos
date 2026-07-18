import { Router } from 'express';
import { fetchProjects } from '../lib/notion.js';
import { fetchUpcomingEvents, isGoogleAuthorized, isGoogleConfigured } from '../lib/google.js';

export const calendarRouter = Router();

calendarRouter.get('/', async (_req, res) => {
  if (!isGoogleConfigured()) {
    return res.status(503).json({ error: 'Google Calendar is not configured yet. See server/.env.example.' });
  }
  if (!isGoogleAuthorized()) {
    return res.status(401).json({ error: 'Google Calendar not authorized yet.', authUrl: '/api/auth/google' });
  }
  const { projects } = await fetchProjects();
  const events = await fetchUpcomingEvents(projects.map(p => p.name));

  // Dedupe FOR DISPLAY ONLY: collapse each recurring series to its next
  // occurrence. Events are already ordered by startTime ascending, so the
  // first occurrence seen per recurringEventId is the next one. This does
  // not affect the energy route, which counts every raw occurrence.
  const seen = new Set<string>();
  const deduped = events.filter(e => {
    if (!e.recurringEventId) return true;
    if (seen.has(e.recurringEventId)) return false;
    seen.add(e.recurringEventId);
    return true;
  });

  res.json({ events: deduped });
});
