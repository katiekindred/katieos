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
  recentSessions: number;
  totalHours: number;
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

// A Notion select/status/multi-select option, with its Notion color name so the
// UI can render it as a chip in the exact Notion color.
export interface FieldOption {
  id: string;
  name: string;
  color: string;
}

// A pickable Notion property (select / status / multi_select) with its options,
// read live from the data-source schema.
export interface PickerField {
  name: string;
  type: 'select' | 'status' | 'multi_select';
  options: FieldOption[];
}

// A lightweight open task, surfaced so the app can show a per-project task
// list and let a session attach to a specific task.
export interface TaskLite {
  id: string;
  projectId: string | null;
  name: string;
  status: string;
  priorityCalc: number | null;
  isNextStep: boolean;
  // Current values of the fields the logger can set, so they populate when the
  // task already exists. Select values are option ids; statusNotes is text.
  importanceId: string | null;
  urgencyId: string | null;
  statusNotes: string;
}

// One field write from the logger. Select/status carry an option id list
// (empty = clear); text carries a string.
export interface FieldUpdate {
  name: string;
  type: 'select' | 'status' | 'multi_select' | 'text';
  optionIds?: string[];
  text?: string;
}

export interface WeeklyReviewProject {
  projectId: string;
  name: string;
  hoursThisWeek: number;
  hoursLastWeek: number;
  delta: number;
  trend: Trend;
}

export interface WeeklyReview {
  totalHoursThisWeek: number;
  totalHoursLastWeek: number;
  sessionsThisWeek: number;
  activeProjectsThisWeek: number;
  longestStreakDays: number;
  busiestDay: { label: string; hours: number } | null;
  byProject: WeeklyReviewProject[];
  rising: string[];
  fading: string[];
  wentDark: string[];
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
