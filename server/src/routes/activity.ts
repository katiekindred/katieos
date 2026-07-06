import { Router } from 'express';
import { formatDuration, humanizeWhen } from '../lib/derive.js';
import { fetchProjects, writeActivityLogEntry } from '../lib/notion.js';

export const activityRouter = Router();

activityRouter.get('/feed', async (_req, res) => {
  const { projects, log } = await fetchProjects();
  const nameById = new Map(projects.map(p => [p.id, p.name]));
  const entries = log
    .filter(e => nameById.has(e.projectId))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 20);
  const feed = entries.map(e => ({
    project: nameById.get(e.projectId) || 'Unknown',
    note: e.note,
    when: humanizeWhen(e.createdAt),
    dur: formatDuration(e.durationSec),
  }));
  res.json({ feed });
});

// Body: { projectId, note, durationSec, source: 'live'|'manual', startedAt?, endedAt? }
activityRouter.post('/', async (req, res) => {
  const { projectId, note, durationSec, source, startedAt, endedAt } = req.body;
  if (!projectId) return res.status(400).json({ error: 'Missing projectId' });
  await writeActivityLogEntry({
    projectId,
    note: note || (source === 'manual' ? 'Logged after the fact.' : 'Worked a little.'),
    durationSec: Number(durationSec) || 0,
    source: source === 'manual' ? 'manual' : 'live',
    startedAt,
    endedAt,
  });
  res.json({ ok: true });
});
