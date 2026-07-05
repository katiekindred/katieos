# Life OS — Data Shapes & Handoff Notes

*For the Claude Code build. The Claude Design prototype (`Dashboard.dc.html` + `Skyline.dc.html`) runs on the sample shapes below. This doc maps each prototype field to its real Notion / Google Calendar source so the wiring is mechanical, not guesswork.*

---

## 0. Integration guardrails (non-negotiable)

- **Two Notion workspaces in scope:** the personal projects/art workspace and the home-admin workspace.
- **The work workspace is hard-excluded at the integration level** — only the specific pages shared with the Notion integration are reachable. This is NOT an in-app filter. The integration token must never have access to work pages. If it can be reached, that's a bug.
- **Notion is the system of record.** This app is a read-heavy view + a thin write-back for activity logs and reorder events. It never owns tasks/projects.
- **Surface, don't diagnose.** Nothing computed below should be phrased as a verdict. The app shows patterns; interpretation stays with the user.

---

## 1. Project (the core object)

Drives the skyline buildings AND the priority list. One Notion database row = one project.

| Prototype field | Type | Notion source | Notes |
|---|---|---|---|
| `id` | string | Notion page id | stable key |
| `name` | string | Title property | |
| `blurb` | string | "Description" rich_text (or page body first line) | short "what is it" |
| `priority` (implicit = array order) | int | "Priority" select/number, OR the app's own order | **stated** priority; user reorders in-app, written back |
| `lastMoved` | display string | derived from `last_edited_time` | humanize ("4 days ago", "August 2025") |
| `lastMovedAt` | ISO datetime | `last_edited_time` | raw, for threshold math |
| `status` | enum | "Status" select | active / saving / quiet / archived |
| `threshold` | string/int | per-project "Check-in threshold" property | **per project**, not global (music ≠ substack pace) |
| `sessions` | string | count of Activity Log rows linked to project | display only |
| `note` | string | "Note" rich_text | shown in skyline detail card |

### Derived visual fields (computed, not stored)

The skyline needs two 0–1 numbers per project. Compute these in the app layer from Notion data — do not ask the user to set them.

| Field | Range | How to compute | Drives |
|---|---|---|---|
| `activity` | 0–1 | recency of `lastMovedAt` blended with # of Activity Log entries in the last N days, normalized. Quiet project → ~0.05. | # of **lit windows** (fill from ground up) + glow halo when > 0.85 |
| `stature` | 0–1 | relative "stature" of the goal — map from stated priority or goal horizon (a 5-yr album = tall). Stable-ish per project. | building **height** (`h = 150 + stature*200`px) and width |
| `trend` | enum | `rising` / `steady` / `fading` from the activity slope over recent weeks | forecast plume direction |
| `quiet` | bool | `activity` under project's own threshold | QUIET tag + priority check-in prompt |

> The whole "MVP moment" is that `activity` (lit windows) and `priority` (left→right position) can disagree — a tall #1 building sitting dark. Keep them independent.

### Consistency, not volume

| Field | Type | Source | Notes |
|---|---|---|---|
| `week` | bool[7] | one bool per day: did any Activity Log entry touch this project that day | render as dots. **Days shown up**, never hours — do not turn this into a scoreboard |
| `hours` | number | sum of Activity Log durations this week | secondary, de-emphasized |

### Roadmap (self-defined, per project)

| Field | Source |
|---|---|
| `nextStep` | "Next step" property or a Roadmap sub-list on the project page |
| `nextTarget` | optional target date/label |
| `nextNote` | optional context line |

---

## 2. Activity Log entry (the write-back)

Every timer stop or manual add creates one entry. This is the app's main **write** to Notion. Open question (below): its own DB vs. properties on the project page — recommend its **own database** related to Projects.

| Field | Type | Notion |
|---|---|---|
| `id` | string | page id |
| `projectId` | relation | → Projects DB |
| `startedAt` / `endedAt` | datetime | for live timer |
| `durationSec` | number | manual entries may set this directly |
| `note` | rich_text | the required "what happened" — **source for both the activity log and the decisions/turning-points layer** |
| `source` | enum | `live` \| `manual` |
| `createdAt` | datetime | |

The `note` is load-bearing: it feeds the activity history, the "why things shifted" layer, and the drift nudge ("last time a Tuesday morning got it going"). Don't drop it.

---

## 3. Reorder / decision event

Written when the user drags to reorder the priority list. Reason is **optional** (never block the interaction).

| Field | Type | Notion |
|---|---|---|
| `projectId` | relation | |
| `fromRank` / `toRank` | int | |
| `reason` | rich_text \| null | optional |
| `at` | datetime | |

---

## 4. Calendar event (Google Calendar, read-only)

Feeds the "Locked in" list and the bright forecast pins. Read-only pull.

| Prototype field | Google Calendar field |
|---|---|
| `title` | `summary` |
| `date` / `time` | `start.dateTime` / `start.date` |
| `type` | derived from calendar name or keyword (Deadline / Call / Recurring) |
| `project` | best-effort link: match event to a project by title/keyword, else `Home` / unassigned |
| `meta` | computed "in N days", location, etc. |

Calendar commitments render as **solid bright pins** ("locked in"). Everything else in the forecast is soft fog (trend), never a hard pin.

---

## 5. Forecast layer (computed)

No new storage. Built from: `trend` per project + real calendar events + roadmap steps. The drift nudge pulls the most recent Activity Log `note` from the last time this project's `activity` recovered after a comparable quiet stretch. Phrase as memory, not instruction.

---

## 6. Open questions (carried from the vision doc)

1. **Activity Log & reorder-reason storage:** own Notion database (recommended, reled to Projects) vs. properties/comments on existing project pages.
2. **Hosting:** must be reachable from every device (web-hosted, no local-only). Real decision, TBD.
3. **`activity` / `stature` normalization:** exact formula + window (last 14 / 30 days?) to tune once real last-edited data is connected.

## 7. Explicitly out of MVP scope

- Energy/capacity tracking (no sustainable capture method yet).
- Deep Obsidian/Claudius vault mapping/reconciliation (phase 2; Notion is source of truth for now).
