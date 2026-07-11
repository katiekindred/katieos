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
  recentSessions: number;
  totalHours: number;
  stature: number;
  trend: Trend;
  quiet: boolean;
  week: boolean[];
  hours: number;
  recoveryNote: string | null;
  houseColor: string | null;
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

export interface TaskLite {
  id: string;
  projectId: string | null;
  name: string;
  status: string;
  priorityCalc: number | null;
  isNextStep: boolean;
  importanceId: string | null;
  urgencyId: string | null;
  statusNotes: string;
}

export interface FieldUpdate {
  name: string;
  type: 'select' | 'status' | 'multi_select' | 'text';
  optionIds?: string[];
  text?: string;
}

export interface FieldOption {
  id: string;
  name: string;
  color: string;
}

export interface PickerField {
  name: string;
  type: 'select' | 'status' | 'multi_select';
  options: FieldOption[];
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
  sessionsLastWeek: number;
  activeProjectsThisWeek: number;
  longestStreakDays: number;
  busiestDay: { label: string; hours: number } | null;
  byProject: WeeklyReviewProject[];
  rising: string[];
  fading: string[];
  wentDark: string[];
}

export interface FeedEntry {
  id: string;
  project: string;
  note: string;
  when: string;
  dur: string;
  durationSec: number;
}

export interface Narrative {
  skyline: string | null;
  nudge: string | null;
}

export interface Summary {
  streakDays: number;
  hoursThisWeek: number;
  visitsThisMonth: number;
}

// Energy check-ins: exactly Katie's four states, no numeric scale.
export type EnergyLevel = 'Green' | 'Yellow' | 'Orange' | 'Red';

export interface EnergyEntry {
  createdAt: string;
  level: EnergyLevel;
  note: string;
}

// The energy forecast: skyline weather plus the plain-language reasons that
// produced it — every warning can name its evidence.
export type Weather = 'clear' | 'clouding' | 'storm';

export interface EnergyForecast {
  weather: Weather;
  reasons: string[];
}
