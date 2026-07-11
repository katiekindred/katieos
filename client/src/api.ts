import type { CalendarEvent, FeedEntry, FieldUpdate, Narrative, PickerField, Project, Summary, TaskLite, WeeklyReview } from './types';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  projects: () => req<{ projects: Project[] }>('/projects').then(r => r.projects),
  createProject: (name: string, priority: number) =>
    req<{ id: string }>('/projects', { method: 'POST', body: JSON.stringify({ name, priority }) }),
  updateProject: (id: string, fields: Partial<{ name: string; blurb: string; nextStep: string; status: string; houseColor: string | null }>) =>
    req<{ ok: true }>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }),
  removeProject: (id: string) => req<{ ok: true }>(`/projects/${id}`, { method: 'DELETE' }),
  reorder: (order: string[], reason: string | null) =>
    req<{ ok: true }>('/projects/reorder', { method: 'POST', body: JSON.stringify({ order, reason }) }),

  calendar: () => req<{ events: CalendarEvent[] }>('/calendar').then(r => r.events),

  tasks: () => req<{ tasks: TaskLite[] }>('/tasks').then(r => r.tasks),
  taskSchema: () => req<{ fields: PickerField[] }>('/tasks/schema').then(r => r.fields),
  createTask: (projectId: string, name: string) =>
    req<{ id: string }>('/tasks', { method: 'POST', body: JSON.stringify({ projectId, name }) }),
  completeTask: (id: string) => req<{ ok: true }>(`/tasks/${id}/complete`, { method: 'POST' }),
  updateTaskFields: (id: string, updates: FieldUpdate[]) =>
    req<{ ok: true }>(`/tasks/${id}/fields`, { method: 'PATCH', body: JSON.stringify({ updates }) }),

  feed: () => req<{ feed: FeedEntry[] }>('/activity/feed').then(r => r.feed),
  // A session attaches to a task: an explicit taskId, else the project's current
  // next step, else a fresh stub (newTask). Returns the task it landed on.
  logActivity: (entry: {
    projectId?: string; taskId?: string | null; newTask?: boolean;
    note: string; durationSec: number; source: 'live' | 'manual';
  }) => req<{ taskId: string }>('/activity', { method: 'POST', body: JSON.stringify(entry) }),
  updateActivity: (id: string, fields: { note?: string; durationSec?: number }) =>
    req<{ ok: true }>(`/activity/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }),
  narrative: () => req<Narrative>('/activity/narrative'),

  weeklyReview: () => req<WeeklyReview>('/review/weekly'),
  summary: () => req<Summary>('/summary'),
};
