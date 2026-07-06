export type Trend = 'rising' | 'steady' | 'fading';

export interface Project {
  id: string;
  workspace: 'personal' | 'home';
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

export interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  meta: string;
  type: 'Deadline' | 'Call' | 'Recurring' | 'Event';
  project: string;
  startISO: string;
}

export interface FeedEntry {
  project: string;
  note: string;
  when: string;
  dur: string;
}
