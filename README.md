# KatieOS — Life OS Dashboard

A personal "Life OS" dashboard that renders your projects as a living city
skyline. Notion is the system of record; the app is a read-heavy view with a
thin write-back for activity logs and priority reorders. Google Calendar
feeds the upcoming-events panel (read-only).

- **`client/`** — React 19 + Vite + TypeScript front end (the skyline UI)
- **`server/`** — Express + TypeScript API that proxies Notion and Google Calendar

## Quick start

Run both halves side by side (two terminals):

```bash
# Terminal 1 — API server on http://localhost:4000
cd server
npm install
npm run dev

# Terminal 2 — UI on http://localhost:5173 (proxies /api to :4000)
cd client
npm install
npm run dev
```

Then open http://localhost:5173.

## Configuration

The server reads `server/.env` (never committed — see `server/.env.example`
for the template):

| Variable | What it is |
|---|---|
| `NOTION_TOKEN` | Internal integration token ("KatieOS" integration) |
| `NOTION_PROJECTS_DB` | Database ID of the TIGFBAO projects board |
| `NOTION_TASKS_DB` | Database ID of the Master Task List Table |
| `NOTION_SKYLINE_PAGE` / `NOTION_NUDGE_PAGE` | Optional pages for Claude-written copy (see below) |
| `NOTION_ENERGY_PAGE` | Optional page for one-tap energy check-ins (see below) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth client from Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | `http://localhost:4000/api/auth/google/callback` |

### One-time setup

1. **Notion sharing** — both databases must be connected to the integration:
   open each database in Notion → `⋯` menu → **Connections** → add
   **KatieOS**. (Database IDs are the 32-char hex string in the database URL.)
2. **Google authorization** — with the server running, visit
   `http://localhost:4000/api/auth/google` once and approve read-only
   calendar access. Tokens are stored in `server/.data/` and auto-refresh.
3. **Notion schema** — nothing manual. On first request the server adds the
   extra properties it needs (Description, Check-in threshold, Priority,
   Next Step Override, Last Reorder Reason on projects; Duration (min) and
   Source on tasks). Existing rows are untouched.

## Claude-written copy (optional)

The skyline's one-line header and the "gentle nudge" can be written by a
scheduled Claude task instead of the app's built-in templates. Create two
Notion pages — one for the skyline line, one for the nudge body — share each
with the KatieOS integration, and put their IDs in `NOTION_SKYLINE_PAGE` and
`NOTION_NUDGE_PAGE` in `server/.env`. Each page's body text is read
**verbatim** (no labels or prefixes; lines starting with `<!--` are treated
as guidance comments and skipped) and shown in place of the app's built-in
copy, refreshed every few minutes. A recurring Claude task can then rewrite
either page on a schedule using your recent Notion activity — no code edits
involved.

## Energy early-warning layer (optional)

The dashboard can notice a slide from Yellow toward Orange before it hits
Red. A one-tap check-in strip (Green / Yellow / Orange / Red, optional note,
always skippable, asked at most once per 4 hours) appends lines to a Notion
page — create one, share it with the KatieOS integration, and set
`NOTION_ENERGY_PAGE`. Alongside the check-ins, the server infers an energy
forecast from behavior the app already tracks: session cadence vs last week,
buildings going dark, broken streaks, calendar density, and silence on both
channels at once. The forecast is a weather word (`clear` / `clouding` /
`storm`) plus plain-language reasons, surfaced as gentle skyline weather
(overcast, then a cozy drizzle with warmer window light) and, when cloudy or
stormy, an evidence-first nudge. A recent explicit check-in always outranks
inference: Orange or Red within a day forces a storm, Green caps it at
clouding. Endpoints: `POST /api/energy` (`{ level, note? }`),
`GET /api/energy?days=30`, `GET /api/energy/forecast`. Everything degrades
gracefully — no energy page means the strip hides and inference runs on
behavioral signals alone; no calendar auth just silences that signal.

## How it behaves

- Projects with Status `Active`, `On Hold`, or empty are shown; rows whose
  "Work or Personal?" formula contains "work" are filtered out.
- Tasks count as done when Status is `Done` or `Irrelevant`. The next open
  task with the highest `Priority Calculation` — the same key the Master Task
  List's Priority View sorts by — becomes each project's "next step".
- Each project card lists its open tasks: check one off to set Status `Done`
  and Date Completed in Notion, or add a task inline (it lands under the
  project for you to set Importance/Urgency).
- Logging a session (live timer or after-the-fact) attaches to a task — by
  default the project's next step, or one you pick, or a fresh stub. The
  session is appended as a dated line in that task's Notion page (a running
  work journal) and the task's `Duration (min)` is kept as the sum across
  sessions. Those session lines light the skyline windows; a completed task
  contributes its total on its completion date.
- "Your week in the city" is a read-only weekly reflection (hours by project,
  what rose or faded, what went quiet, streak) derived from that same log.
- Drag-reorders write `Priority` (and an optional reason) back to the project
  pages.

## Useful commands

| Where | Command | Does |
|---|---|---|
| `server/` | `npm run dev` | API with hot reload (tsx watch) |
| `server/` | `npm run build && npm start` | Compile to `dist/` and run |
| `client/` | `npm run dev` | Vite dev server with HMR |
| `client/` | `npm run build` | Typecheck + production build |
| `client/` | `npm run lint` | Oxlint |
