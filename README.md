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

## How it behaves

- Projects with Status `Active`, `On Hold`, or empty are shown; rows whose
  "Work or Personal?" formula contains "work" are filtered out.
- Tasks count as done when Status is `Done` or `Irrelevant`. The next open
  task (earliest due date, then oldest) becomes each project's "next step".
- Completed tasks with a Date Completed become the activity log that lights
  the skyline windows.
- Timer stops and manual logs write back to the Master Task List as `Done`
  rows tagged `Live`/`Manual`; drag-reorders write `Priority` (and an
  optional reason) back to the project pages.

## Useful commands

| Where | Command | Does |
|---|---|---|
| `server/` | `npm run dev` | API with hot reload (tsx watch) |
| `server/` | `npm run build && npm start` | Compile to `dist/` and run |
| `client/` | `npm run dev` | Vite dev server with HMR |
| `client/` | `npm run build` | Typecheck + production build |
| `client/` | `npm run lint` | Oxlint |
