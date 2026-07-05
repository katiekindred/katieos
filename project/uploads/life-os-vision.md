# Life Management App — Vision Doc

*Build path: Claude Design first, for a clickable visual prototype on sample data. Then hand that off to Claude Code (ideally running Fable 5) to build the real thing, wired up to live Notion and Calendar data.*

## The core idea

A personal web app that acts as an intelligence layer for life outside the 9-5, a consult, not a replacement for judgment. It turns data that already exists into information a person can't easily assemble in her own head. Not conversational, not a chatbot. A dashboard-first tool: you look at it and it tells you what's true, with recommendations layered in where useful.

It pulls live from Notion (via the Notion API) and Google Calendar rather than replacing either. Notion stays the system of record for tasks and projects. This app is the view on top that Notion itself doesn't give you.

## The two gaps this solves

**Where I've been.** Right now there's no way to look back and see the shape of a project over time: what got worked on, how consistently, and why things shifted when they did. Covered below in "The MVP moment" and "How activity actually gets captured."

**What's coming.** A combination of real calendar deadlines, self-defined roadmap steps, and pattern-based nudges when something's drifting. Covered below in "What's coming."

## The MVP moment: what should make your jaw drop

The wow moment isn't polish. It's the app showing something true about your own attention that you couldn't have assembled yourself, using data that's already sitting in Notion right now, before you've logged a single activity or dragged a single card.

**The retrospective skyline.** On first connect, one silent pass over existing Notion data (last-edited dates, whatever priority/status already exists) renders a single visual: your projects as shapes in a skyline, sized or lit by recent activity, positioned by stated priority. Underneath it, one plain-spoken line stating the single truest thing the data reveals, e.g. "You've called music your #1 priority for six weeks. It hasn't moved in that time. Substack, ranked third, moved four days ago." No judgment attached. Just the shape, handed back the way a friend who was actually paying attention would say it.

**The ghost forecast layer.** A faded, translucent overlay on that same skyline, showing where things are headed if nothing changes, built from the same pattern data plus real calendar events and roadmap steps. Calendar commitments show up as solid, bright pins ("this one's locked in"). Everything else is a soft fog showing current trend, like a weather forecast for attention instead of the sky. When something's about to drift out of the picture, instead of just flagging it, the app pulls up the last time this exact thing happened and shows what actually got it moving again, straight from your own logged activity. Not "you're behind." More like "last time this went quiet this long, a Tuesday morning got it going again."

## How activity actually gets captured

Two input pieces, both simple:

- **Start a live activity** — pick a project, the app tracks time while you work.
- **Add an activity manually** — log something after the fact.

Either way, the entry prompts for a quick "what happened" note. That note is the source for both the activity log (what got worked on, how consistently) and the decisions/turning points layer (the why behind shifts), and it's written back to Notion so it lives there, not trapped in the app. The same entries feed the "where you're spending time" visual, so that visual works across every project instead of just the ones that happen to track hours already.

## Archive & priority-drift recommendations

The rule: **surface, don't diagnose.**

The app should never guess *why* something looks dormant or assign meaning to it (not "you've abandoned this," not "you're inconsistent"). The actual trigger: last-edited data cross-referenced against stated priority. If a project is ranked highest priority and hasn't moved past its threshold, the app prompts a priority check-in rather than a verdict, something like "this hasn't moved in a while, still your top priority?" Thresholds are set **per project**, not one global number, since a 5-year music goal and an active weekly Substack don't move at the same pace. The interpretation and the decision stay with the user. The app surfaces a pattern; it does not editorialize.

## The priority view

A visual card list of projects, ranked by stated priority, that you can drag and drop to reorder. Reordering can optionally prompt for a reason, but it's never required, so it doesn't become its own friction. Reorder events (and reasoning, when given) get logged back to Notion. Sitting alongside the card list: the time-spent visual, so you can cross-reference what you say matters against where your hours actually went.

## What's coming

A combination view:

- Calendar-driven — real dates and deadlines from Google Calendar.
- Self-defined roadmap — next steps or waypoints set per project in Notion.
- Pattern-based nudges — surfaced as a callout box when something's drifting, not a hard notification demanding action.

## Data sources & architecture (MVP scope)

- Notion, via live API sync from day one. Two workspaces: the personal-projects-and-art workspace, and the home-admin workspace. A third work workspace exists but is explicitly out of scope — hard-excluded at the integration level (only specific pages shared with the Notion integration), not just filtered in app logic.
- Google Calendar, for the "what's coming" calendar layer.
- Fully web-hosted so it's reachable from every device, no local-only version. This is why the Obsidian/Claudius vault (local files, currently not engaged with meaningfully anyway) is out of MVP scope. Notion is the source of truth for now. Mapping against the vault, reconciling inconsistencies between the two, is a deliberate phase 2, not something the MVP needs to solve.

## Interaction model

Dashboard-first. Think command center, not command line. Visual layout over text-heavy lists. Recommendations appear as surfaced cards/prompts within the dashboard rather than through a chat interface.

## Design guardrails (from how this person thinks about their own life)

- Progress means consistency and showing up, not volume of output. Any "progress" visualization should reflect that, not turn into a productivity scoreboard.
- No auto-diagnosis of *why* something changed or went quiet. Observations, not conclusions.
- This app is a new layer on existing systems (Notion, Calendar), not a replacement for them.
- Nothing from the work workspace should ever be reachable, even accidentally, through this app.

## Not in v1

- **Energy/capacity tracking.** This is a real, named pain point (no early-warning system for energy), but there's no tracking method yet that feels sustainable to actually keep up with. Deliberately parked rather than bolted on half-baked. Revisit once a method exists.
- **Deep Obsidian/Claudius vault mapping.** Notion is source of truth for now. The vault gets reconciled against it later, not in the MVP.

## Open questions for the build (things not yet decided)

- Visual style specifics beyond "visual, interactive, no image generation" — color, typography, overall feel of the skyline itself.
- Which hosting service to actually deploy to (needs to be reachable from every device, so this is a real decision, not a detail).
- Whether reorder-reasoning and "what happened" entries get their own Notion database, or attach as properties/comments on existing project pages.
