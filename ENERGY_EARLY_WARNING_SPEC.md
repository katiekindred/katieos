# Implementation brief: Energy early-warning layer for KatieOS

Paste this whole file to Claude (Fable 5) in this repo. It is a spec, not final code. Adapt everything to the existing stack and conventions in this codebase.

## How to run this brief
You are expected to work end to end in one session: read the code, plan, implement, write tests, run the full verification list in Part E, review your own output, and iterate until everything passes. Do not stop to ask questions except at the forks listed in "Questions to confirm." If local uncommitted changes exist in `server/src/lib/derive.ts` or `derive.test.ts`, build on top of them; never revert them.

## What I want, in one line
KatieOS should notice me sliding from Yellow toward Orange before I hit Red, using a one-tap energy check-in plus inference from behavior it already tracks, and surface that as skyline weather and the gentle nudge.

Why: I rarely catch myself at Orange. Personal and mental hygiene slip first, then projects go quiet, and by the time I notice, I'm at Red. The signals are already in this app (session cadence, quiet buildings, streaks, calendar density). This layer reads them.

---

## Locked decisions (do not deviate without asking me)

1. **Check-in AND inference, not either alone.** The check-in is ground truth; inference fills gaps and catches drift I don't self-report. A recent explicit check-in always outranks inference (see B4).
2. **Warnings surface in-app only:** skyline weather plus the existing nudge slot. No emails, no notifications, no new channels.
3. **Energy levels are exactly my four states:** `Green`, `Yellow`, `Orange`, `Red`. Do not invent a numeric scale or extra states.
4. **Storage is a Notion page of appended lines**, exactly like the session-line pattern (`SESSION_MARKER`, `formatSessionLine`/`parseSessionLine` in `server/src/lib/derive.ts`). New env var `NOTION_ENERGY_PAGE`. No new database, no local JSON. Notion stays the system of record and my scheduled Claude tasks can read the page later.
5. **Every warning must be explainable.** No opaque scores. The forecast returns plain-language reasons ("3 buildings quiet, calendar heavy this week") and the UI can show them.
6. **Voice rules for any generated nudge copy are hard constraints. This app is a chief of staff, not a friend:** direct recommendations naming a concrete action; assume I'm capable and will execute; point at dependencies and risks plainly; no coddling, no reassurance, no inferred emotional barriers, no prescribed mindset. A quiet project is allocation data before it is a problem; I'm often optimizing the portfolio, not wrestling with task initiation. Still banned: shame, alarm theater, any mention of body, weight, food quantity, or exercise obligation; em dashes; corporate voice. Rest is a valid recommendation when the data supports it, framed as resource management.
7. **Check-in is low friction and always skippable.** Ask at most once per 4 hours, dismiss forever with one click per session, one tap to answer. A skipped check-in is weak signal, never treated as Red.
8. **No new heavy dependencies.** React hooks state as in `Dashboard.tsx`, `node:test` for tests, existing polling loop for refresh.
9. **Weather must respect the "cozy village" art direction.** Ambient and gentle, not alarming. A storm here is a cozy rain, not a warning siren.

---

## Part A: Check-in capture

### A1. Data layer (`server/src/lib/derive.ts` — pure, tested)
Mirror the session-line pair:

```ts
export type EnergyLevel = 'Green' | 'Yellow' | 'Orange' | 'Red';
export interface EnergyLine { createdAt: string; level: EnergyLevel; note: string }
export function formatEnergyLine(e: EnergyLine): string
export function parseEnergyLine(raw: string): EnergyLine | null
```

Line format, ` · `-joined like session lines, same marker:
```
▸ 2026-07-11T15:04:00.000Z · Yellow · long week, slept ok
```
Empty note renders as `—`. Flatten literal `" · "` in notes to `" - "` exactly as `formatSessionLine` does. `parseEnergyLine` returns null for anything that doesn't start with `SESSION_MARKER` or has an unknown level.

### A2. Notion I/O (`server/src/lib/notion.ts`)
- `appendEnergyLine(line)` appends a paragraph block to `NOTION_ENERGY_PAGE` (same block-append call as `logSession`).
- `fetchEnergyLog()` reads the page's paragraph blocks, parses with `parseEnergyLine`, returns newest-first. Cache 5 minutes like `narrativeCache`; bust on append.
- If `NOTION_ENERGY_PAGE` is unset, both are graceful no-ops: check-in UI hides, inference runs without self-report signals. Follow the `fetchPageText` philosophy: swallow read errors, fall back quietly.
- Add `NOTION_ENERGY_PAGE` to `server/.env.example` with a comment.

### A3. Routes (`server/src/routes/`)
- `POST /api/energy` body `{ level: EnergyLevel, note?: string }` → append, return the saved entry.
- `GET /api/energy?days=30` → parsed entries within window.
Match the existing router style (no try/catch wrappers; Express 5 forwards rejections; explicit `503 { error }` when unconfigured).

### A4. Client (`client/src/components/Dashboard.tsx` + `api.ts`)
A small check-in strip near the top of the dashboard: four colored dots (use the level names as labels, not just color — I'm the user, but label them anyway), an optional single-line note input, a skip control. Show only when the latest check-in is older than 4 hours. Persist "dismissed at" in `localStorage` like the live-timer state. One tap posts and the strip thanks me in three words or fewer, then gets out of the way.

---

## Part B: Inference (the forecast)

### B1. Pure function in `derive.ts`
```ts
export type Weather = 'clear' | 'clouding' | 'storm';
export interface EnergyForecast { weather: Weather; reasons: string[] }
export function computeEnergyForecast(inputs: {
  energyLog: EnergyLine[];          // newest first
  review: WeeklyReview;             // existing computeWeeklyReview output
  summary: Summary;                 // existing computeSummary output
  quietProjectCount: number;
  visibleProjectCount: number;
  calendarEventCountNext7d: number;
  now?: Date;
}): EnergyForecast
```
No I/O. Central timezone via the existing `CENTRAL_TZ` helpers.

### B2. Signals (simple explainable rules, no ML)
Each signal that fires contributes one plain-language reason string:
- **Cadence drop:** `sessionsThisWeek` less than half of last week's (both from `WeeklyReview`), and last week was nonzero.
- **Darkening skyline:** `wentDark.length >= 2`, or quiet projects are more than half of visible projects.
- **Streak break:** `streakDays === 0` when the recent log shows a streak of 5+ days ended within the last 7.
- **Heavy calendar:** 10+ events in the next 7 days (tune the constant, name it, and document it).
- **Self-reported slide:** the two most recent check-ins within 7 days are strictly descending (Green→Yellow, Yellow→Orange, etc.), or the latest is Orange or Red.
- **Double silence:** no check-in in 5+ days AND `sessionsThisWeek === 0`. This is the "hygiene slips first" tell. Weak signal on its own.

### B3. Weather rules
- `storm`: latest check-in (within 24h) is Orange or Red, OR 3+ signals fire.
- `clouding`: exactly 1–2 signals fire, or latest check-in (within 24h) is Yellow while any signal fires.
- `clear`: otherwise.

### B4. Ground truth trumps inference
A Green check-in within the last 24 hours caps the weather at `clouding` no matter how many behavioral signals fire, and prepends the reason "you said Green recently, so treating this as clouds, not a storm."

### B5. Endpoint
`GET /api/energy/forecast` → `EnergyForecast`. Compose the inputs server-side from the existing derivation paths (`buildActivityLog`, `computeWeeklyReview`, `computeSummary`, project quiet flags, `fetchUpcomingEvents`). Note `buildActivityLog` is currently module-private in `notion.ts`; either export it or expose a small composed accessor there rather than duplicating its logic. Calendar unavailable (401/503 path) means that signal silently contributes nothing.

---

## Part C: Surfacing

### C1. Skyline weather (`Skyline.tsx`, `SkylineAmbience.tsx`, `skylineTheme.ts`)
Map weather to ambience: `clear` is today's behavior unchanged; `clouding` adds a soft overcast layer (dimmer sky, a couple of drifting clouds); `storm` adds gentle rain and warmer window light (the village hunkers down cozy, it does not flash red). Reuse the existing theme/ambience mechanisms rather than bolting on a parallel system.

### C2. Nudge slot (`Dashboard.tsx`)
Current precedence is Claude-written nudge from `GET /api/activity/narrative`, else quiet-project fallback. New precedence: Claude-written nudge, else **forecast nudge when weather is clouding or storm**, else quiet-project fallback. The forecast nudge is template-composed from the reasons list and must obey locked decision 6: evidence, then a direct recommendation. Shape: "Two buildings dark and a heavy calendar ahead. Recommend picking one project this week and parking the rest." Not: "Maybe take it easy, no pressure." Give me 3 to 4 templates, not one, rotated deterministically by date so it doesn't feel like a broken record.

### C3. Refresh
Fold forecast fetching into the existing 60-second polling loop in `Dashboard.tsx`. No websockets, no new timers.

---

## Part D: Tests (`node:test`, in `derive.test.ts` or a sibling file)
- `formatEnergyLine`/`parseEnergyLine` round-trip, delimiter flattening, empty note, unknown level rejected.
- `computeEnergyForecast`: one test per signal firing alone; combinations crossing the clouding/storm boundaries; the Green-trumps rule; empty energy log with signals; everything-clear case.
- Timezone edges: check-in "within 24h/7d" windows computed in Central time using the existing helpers, with a DST-adjacent case like the existing `centralDaysAgo` tests.

## Part E: Verification (run all before declaring done)
1. `cd server && npm test` — all green, including preexisting tests.
2. `cd server && npm run build` and `cd client && npm run build` — clean typecheck.
3. `cd client && npm run lint` — clean.
4. Manual pass with the dev servers: check in, confirm the line lands on the Notion page correctly formatted, confirm forecast responds, force each weather state by stubbing and confirm skyline renders each.
5. Reread every user-facing string against locked decision 6. Fix anything that coddles, reassures, nags, shames, or infers feelings from data.
6. Self-review the diff as if reviewing a stranger's PR. Then update README.md: env var, endpoints, one paragraph on the feature.

## Acceptance criteria
- One tap logs a check-in; the line on the Notion page round-trips through the parser.
- Forecast returns explainable reasons; every warning names its evidence.
- Green check-in within 24h caps at clouding.
- Missing `NOTION_ENERGY_PAGE`, missing calendar auth, and empty logs all degrade gracefully to current behavior.
- Skyline weather reads cozy in all three states; nudge copy passes the tone rules.
- No regressions: all preexisting tests pass, existing endpoints untouched.

## Questions to confirm with me before or during the build
1. I will create the Notion page and share it with the KatieOS integration; ask me for the page ID when you need it.
2. Exact weather art (cloud shapes, rain density) is yours to propose; show me before polishing if you're unsure between directions.
3. If you find the 4-hour re-ask or the signal constants create noise in practice, propose different values with reasoning instead of silently changing them.
