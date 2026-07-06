import { Router } from 'express';
import {
  archiveProject, configuredWorkspaces, createProject, fetchProjects,
  updateProjectFields, writeReorderEvent
} from '../lib/notion.js';

export const projectsRouter = Router();

projectsRouter.get('/', async (_req, res) => {
  if (configuredWorkspaces().length === 0) {
    return res.status(503).json({ error: 'Notion is not configured yet. See server/.env.example.' });
  }
  const { projects } = await fetchProjects();
  res.json({ projects });
});

projectsRouter.post('/', async (req, res) => {
  if (configuredWorkspaces().length === 0) return res.status(503).json({ error: 'Notion is not configured.' });
  const priority = Number(req.body.priority) || 999;
  const id = await createProject({ name: req.body.name || 'New project', priority });
  res.json({ id });
});

projectsRouter.patch('/:id', async (req, res) => {
  await updateProjectFields(req.params.id, req.body);
  res.json({ ok: true });
});

projectsRouter.delete('/:id', async (req, res) => {
  await archiveProject(req.params.id);
  res.json({ ok: true });
});

// Body: { order: string[] (project ids, new rank order), reason?: string }
projectsRouter.post('/reorder', async (req, res) => {
  const order: string[] = req.body.order || [];
  const reason: string | null = req.body.reason || null;
  await Promise.all(order.map((id, i) => writeReorderEvent(id, i + 1, reason)));
  res.json({ ok: true });
});
