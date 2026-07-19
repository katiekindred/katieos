import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { authRouter } from './routes/auth.js';
import { activityRouter } from './routes/activity.js';
import { calendarRouter } from './routes/calendar.js';
import { energyRouter } from './routes/energy.js';
import { projectsRouter } from './routes/projects.js';
import { reviewRouter } from './routes/review.js';
import { summaryRouter } from './routes/summary.js';
import { tasksRouter } from './routes/tasks.js';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/projects', projectsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/activity', activityRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/energy', energyRouter);
app.use('/api/review', reviewRouter);
app.use('/api/summary', summaryRouter);
app.use('/api/auth', authRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Express 5 forwards async route rejections here instead of crashing the
// process, but the default handler replies with an HTML page — surface the
// real error message as JSON so the client's error toasts show it. The unused
// `_next` param is required: Express tells error middleware apart by arity.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err?.message || 'Internal server error' });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => console.log(`Life OS server listening on http://localhost:${port}`));
