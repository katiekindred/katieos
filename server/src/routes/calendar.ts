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
  res.json({ events });
});
