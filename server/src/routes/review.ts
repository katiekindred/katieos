import { Router } from 'express';
import { configuredWorkspaces, fetchWeeklyReview } from '../lib/notion.js';

export const reviewRouter = Router();

// Read-only weekly reflection ("your week in the city"), derived from the
// activity log. Writes nothing back to Notion.
reviewRouter.get('/weekly', async (_req, res) => {
  if (configuredWorkspaces().length === 0) {
    return res.status(503).json({ error: 'Notion is not configured yet. See server/.env.example.' });
  }
  res.json(await fetchWeeklyReview());
});
