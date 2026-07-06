import type { CalendarEvent, FeedEntry, Narrative, Project } from './types';

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
  updateProject: (id: string, fields: Partial<{ name: string; blurb: string; nextStep: string; status: string }>) =>
    req<{ ok: true }>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }),
  removeProject: (id: string) => req<{ ok: true }>(`/projects/${id}`, { method: 'DELETE' }),
  reorder: (order: string[], reason: string | null) =>
    req<{ ok: true }>('/projects/reorder', { method: 'POST', body: JSON.stringify({ order, reason }) }),

  calendar: () => req<{ events: CalendarEvent[] }>('/calendar').then(r => r.events),

  feed: () => req<{ feed: FeedEntry[] }>('/activity/feed').then(r => r.feed),
  logActivity: (entry: {
    projectId: string; note: string; durationSec: number; source: 'live' | 'manual';
    startedAt?: string; endedAt?: string;
  }) => req<{ ok: true }>('/activity', { method: 'POST', body: JSON.stringify(entry) }),
  updateActivity: (id: string, fields: { note?: string; durationSec?: number }) =>
    req<{ ok: true }>(`/activity/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }),
  narrative: () => req<Narrative>('/activity/narrative'),
};
