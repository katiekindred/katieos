import { Router } from 'express';
import { computeSummary } from '../lib/derive.js';
import { configuredWorkspaces, fetchProjects } from '../lib/notion.js';

export const summaryRouter = Router();

// Stickers-row stats for the top of the dashboard: streak / hours this week /
// visits this month, all derived from the activity log.
summaryRouter.get('/', async (_req, res) => {
  if (configuredWorkspaces().length === 0) {
    return res.status(503).json({ error: 'Notion is not configured yet. See server/.env.example.' });
  }
  const { log } = await fetchProjects();
  res.json(computeSummary(log));
});
