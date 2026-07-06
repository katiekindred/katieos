import { google } from 'googleapis';
import fs from 'node:fs';
import path from 'node:path';
import type { CalendarEvent } from '../types.js';

const TOKEN_PATH = path.join(process.cwd(), '.data', 'google-tokens.json');
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

function oauthClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) return null;
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

export function isGoogleConfigured(): boolean {
  return oauthClient() !== null;
}

export function isGoogleAuthorized(): boolean {
  return fs.existsSync(TOKEN_PATH);
}

export function getAuthUrl(): string {
  const client = oauthClient();
  if (!client) throw new Error('Google OAuth is not configured (missing env vars)');
  return client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });
}

export async function handleOAuthCallback(code: string): Promise<void> {
  const client = oauthClient();
  if (!client) throw new Error('Google OAuth is not configured (missing env vars)');
  const { tokens } = await client.getToken(code);
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

function authorizedClient() {
  const client = oauthClient();
  if (!client) throw new Error('Google OAuth is not configured (missing env vars)');
  if (!fs.existsSync(TOKEN_PATH)) throw new Error('Google Calendar is not authorized yet — visit /api/auth/google');
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
  client.setCredentials(tokens);
  client.on('tokens', updated => {
    const merged = { ...tokens, ...updated };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
  });
  return client;
}

// Best-effort match of an event's title against known project names, per the
// handoff doc ("match event to a project by title/keyword, else Home/unassigned").
function matchProject(summary: string, projectNames: string[]): string {
  const lower = summary.toLowerCase();
  for (const name of projectNames) {
    const key = name.split(/[\s/]+/)[0].toLowerCase();
    if (key.length > 2 && lower.includes(key)) return name;
  }
  return 'Home';
}

function inferType(summary: string, calendarSummary: string): CalendarEvent['type'] {
  const s = `${summary} ${calendarSummary}`.toLowerCase();
  if (/due|deadline|submit/.test(s)) return 'Deadline';
  if (/call|meeting|1:1|sync/.test(s)) return 'Call';
  if (/recurring|weekly|therapy|standing/.test(s)) return 'Recurring';
  return 'Event';
}

export async function fetchUpcomingEvents(projectNames: string[]): Promise<CalendarEvent[]> {
  const client = authorizedClient();
  const calendar = google.calendar({ version: 'v3', auth: client });
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86400000);
  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: in30.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 25,
  });

  return (res.data.items || []).map(ev => {
    const startISO = ev.start?.dateTime || ev.start?.date || now.toISOString();
    const start = new Date(startISO);
    const hasTime = !!ev.start?.dateTime;
    const dateStr = start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const timeStr = hasTime ? start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    const daysOut = Math.round((new Date(start).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
    const inDays = daysOut <= 0 ? 'today' : daysOut === 1 ? 'tomorrow' : `in ${daysOut} days`;
    return {
      id: ev.id || '',
      title: ev.summary || 'Untitled event',
      date: dateStr,
      meta: timeStr ? `${timeStr} · ${inDays}` : inDays,
      type: inferType(ev.summary || '', ''),
      project: matchProject(ev.summary || '', projectNames),
      startISO,
    };
  });
}
