export type Trend = 'rising' | 'steady' | 'fading';

export interface Project {
  id: string;
  name: string;
  blurb: string;
  status: string;
  lastMoved: string;
  lastMovedAt: string | null;
  threshold: string;
  sessions: string;
  note: string;
  nextStep: string;
  nextNote: string;
  nextTarget: string;
  priority: number;
  activity: number;
  stature: number;
  trend: Trend;
  quiet: boolean;
  week: boolean[];
  hours: number;
  recoveryNote: string | null;
}

export interface ActivityLogEntry {
  id: string;
  projectId: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number;
  note: string;
  source: 'live' | 'manual' | 'notion-task';
  createdAt: string;
}

export interface ReorderEvent {
  projectId: string;
  fromRank: number;
  toRank: number;
  reason: string | null;
  at: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  meta: string;
  type: 'Deadline' | 'Call' | 'Recurring' | 'Event';
  project: string;
  startISO: string;
}
