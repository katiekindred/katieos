# KatieOS client

React 19 + Vite + TypeScript front end for the Life OS dashboard — the
skyline visualization, priority list, activity feed, and calendar panel.

```bash
npm install
npm run dev     # http://localhost:5173
```

The dev server proxies `/api/*` to the Express server on `localhost:4000`
(see `vite.config.ts`), so start `../server` first — see the root README for
full setup.

- `npm run build` — typecheck + production build to `dist/`
- `npm run lint` — Oxlint

Key files: `src/components/Skyline.tsx` (the city), `src/components/Dashboard.tsx`
(layout + panels), `src/api.ts` (server calls), `src/types.ts` (shared shapes).
