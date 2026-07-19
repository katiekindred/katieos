import { Router } from 'express';
import {
  archiveProject, configuredWorkspaces, createProject, explainLastVisit, fetchProjects,
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

// Debug: explain what "last visited" resolves to for a project and which task drives it.
projectsRouter.get('/:id/last-visit', async (req, res) => {
  res.json(await explainLastVisit(req.params.id));
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

// Body: { order: string[] (project ids, new rank order), reason?: string, movedId?: string }
projectsRouter.post('/reorder', async (req, res) => {
  const order: string[] = req.body.order || [];
  const reason: string | null = req.body.reason || null;
  const movedId: string | null = req.body.movedId || null;
  const { projects } = await fetchProjects();
  const currentRank = new Map(projects.map(p => [p.id, p.priority]));
  // Sequential, changed-ranks-only writes keep Notion's rate limit happy; the
  // reason lands only on the project that was dragged.
  for (const [i, id] of order.entries()) {
    const newRank = i + 1;
    const withReason = reason != null && id === movedId;
    if (currentRank.get(id) !== newRank || withReason) {
      await writeReorderEvent(id, newRank, withReason ? reason : null);
    }
  }
  res.json({ ok: true });
});
