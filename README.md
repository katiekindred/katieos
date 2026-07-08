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
scheduled Claude task instead of the app's built-in templates. Create a
Notion page containing two lines:

```
Skyline: <one sentence for under the skyline>
Nudge: <the gentle nudge body>
```

Share the page with the KatieOS integration, put its ID in
`NOTION_NARRATIVE_PAGE` in `server/.env`, and the dashboard will prefer that
copy whenever those lines exist (refreshed every few minutes). A recurring
Claude task can then rewrite the page on a schedule using your recent
Notion activity — no code edits involved.

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
