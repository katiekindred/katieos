import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { authRouter } from './routes/auth.js';
import { activityRouter } from './routes/activity.js';
import { calendarRouter } from './routes/calendar.js';
import { projectsRouter } from './routes/projects.js';
import { reviewRouter } from './routes/review.js';
import { tasksRouter } from './routes/tasks.js';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/projects', projectsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/activity', activityRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/review', reviewRouter);
app.use('/api/auth', authRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => console.log(`Life OS server listening on http://localhost:${port}`));
