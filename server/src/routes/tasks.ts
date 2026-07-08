import { Router } from 'express';
import { completeTask, configuredWorkspaces, createTask, fetchOpenTasks, fetchTaskFieldSchema, updateTaskFields } from '../lib/notion.js';

export const tasksRouter = Router();

// The task DB's select/status/multi_select properties with their options and
// Notion colors, so the UI can render each field's chips live from Notion.
tasksRouter.get('/schema', async (_req, res) => {
  if (configuredWorkspaces().length === 0) {
    return res.status(503).json({ error: 'Notion is not configured yet. See server/.env.example.' });
  }
  const fields = await fetchTaskFieldSchema();
  res.json({ fields });
});

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

// Set field values (Importance / Urgency / Status Notes) on a task.
// Body: { updates: FieldUpdate[] }
tasksRouter.patch('/:id/fields', async (req, res) => {
  const updates = Array.isArray(req.body.updates) ? req.body.updates : [];
  await updateTaskFields(req.params.id, updates);
  res.json({ ok: true });
});
