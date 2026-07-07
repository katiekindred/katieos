import { Router } from 'express';
import { completeTask, configuredWorkspaces, createTask, fetchOpenTasks } from '../lib/notion.js';

export const tasksRouter = Router();

// Open tasks across the visible projects, each flagged if it's its project's
// current next step (highest Priority Calculation).
tasksRouter.get('/', async (_req, res) => {
  if (configuredWorkspaces().length === 0) {
    return res.status(503).json({ error: 'Notion is not configured yet. See server/.env.example.' });
  }
  const tasks = await fetchOpenTasks();
  res.json({ tasks });
});

// Body: { projectId, name } — create a task under a project (Importance/Urgency
// left for Katie to set in Notion).
tasksRouter.post('/', async (req, res) => {
  if (configuredWorkspaces().length === 0) return res.status(503).json({ error: 'Notion is not configured.' });
  const name: string = req.body.name || 'New task';
  const projectId: string | null = req.body.projectId || null;
  const id = await createTask({ projectId, name });
  res.json({ id });
});

// Mark a task done (Status → Done, Date Completed → now).
tasksRouter.post('/:id/complete', async (req, res) => {
  await completeTask(req.params.id);
  res.json({ ok: true });
});
