# Guided Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Take the tour" button in the top bar that walks a non-technical user through the dashboard and a stock page, one lit-up panel at a time, in English or Nepali.

**Architecture:** A React context mounted in the root layout holds tour state so it survives the dashboard → stock page navigation. An overlay component finds the current step's panel by a `data-tour` attribute, dims everything else and shows a large-text card. Step order and all copy live in one data file.

**Tech Stack:** Next.js 14 app router, React 18, Tailwind 3. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-18-guided-tour-design.md`

## Global Constraints

- No new npm dependencies and no backend changes.
- Builds and checks go through Docker, never `npm` directly. The active Docker context is `swift`, which is the live machine: build with a throwaway tag and never run `docker compose up` as part of this plan.
- Build check command, from the repo root (called "the build check" below):
  `docker build -f Dockerfile.frontend -t nepselligence-frontend:tour-check .`
  Passing means it ends with `naming to docker.io/library/nepselligence-frontend:tour-check` and Next's "Compiled successfully" / no type errors.
- Works from 700px wide upward and with touch as well as mouse and keyboard (tablet support is being added to the app in parallel).
- Card text: body 18px, title 22px, buttons at least 48px tall. Words on every control, no icon-only buttons.
- Copy: two or three short sentences per step, no jargon. In Nepali, NEPSE, LTP and turnover stay in English.
- localStorage keys: `nepse-tour-seen`, `nepse-tour-lang`. Every read and write is wrapped in try/catch.
- The tour must not change app state: no range switch, no admin action, no search.
- Commit after each task, staging only the files that task names. The working tree holds another session's uncommitted tablet work; never `git add -A`.

## Review Focus

1. A panel with no data (market closed, empty widget) — the step still shows, because `data-tour` sits on the wrapper in the page file, not inside the widget. Checked in Task 4.
2. The stock page fails to load (backend down, unknown symbol) — every stock step times out and is skipped, the tour ends by itself, nothing hangs. Checked in Task 4.
3. localStorage unavailable or throwing — the tour still runs; it may auto-start again next visit. Checked in Task 2.
4. Next pressed several times quickly, including while the stock page is loading — the index never runs past the last step or advances twice per press. Checked in Task 3.
5. Browser Back, or any navigation the tour did not cause, while it is running — the tour closes instead of pointing at panels that are gone. Checked in Task 4.

---

### Task 1: Step list and copy

**Files:**
- Create: `frontend/src/components/tour/tourSteps.ts`

**Interfaces:**
- Produces:

```ts
export type TourLang = 'en' | 'ne'
export type TourPage = 'dashboard' | 'stock'
export interface TourStep {
  id: string
  page: TourPage
  target: string | null            // data-tour value; null = card centred, nothing lit
  title: Record<TourLang, string>
  body: Record<TourLang, string>
}
export const TOUR_STEPS: TourStep[]
export function stepsFor(start: TourPage): TourStep[]   // 'dashboard' → all; 'stock' → stock steps only
export const TOUR_UI: Record<TourLang, {
  button: string; next: string; back: string; close: string; finish: string
  stepOf: (n: number, total: number) => string
}>
export const LANG_NAMES: Record<TourLang, string>       // { en: 'English', ne: 'नेपाली' }
```

Steps, in order (`id` = `target` unless noted):

| page | id | target |
|---|---|---|
| dashboard | welcome | null |
| dashboard | status | status |
| dashboard | search | search |
| dashboard | admin-actions | admin-actions |
| dashboard | range | range |
| dashboard | index-chart | index-chart |
| dashboard | sectors | sectors |
| dashboard | movers | movers |
| dashboard | turnover | turnover |
| dashboard | breadth | breadth |
| dashboard | trade-activity | trade-activity |
| dashboard | ai-insights | ai-insights |
| dashboard | news | news |
| stock | stock-header | stock-header |
| stock | stock-chart | stock-chart |
| stock | stock-news | stock-news |
| stock | stock-technicals | stock-technicals |
| stock | stock-stats | stock-stats |
| stock | stock-ai | stock-ai |
| stock | stock-floorsheet | stock-floorsheet |
| stock | stock-back | stock-back |

- [ ] **Step 1:** Write `tourSteps.ts` with the types, the 21 steps with `en` and `ne` copy, `stepsFor`, `TOUR_UI` and `LANG_NAMES`. The `stock-header` copy opens by saying the tour has opened one share as an example. The `stock-back` copy says how to return to the dashboard and that the tour button is always there to run this again. The `admin-actions` copy says these are for maintenance and can be ignored.
- [ ] **Step 2:** Run the build check. Expected: passes.
- [ ] **Step 3:** Commit `frontend/src/components/tour/tourSteps.ts` — `feat: tour steps and bilingual copy`.

### Task 2: Tour state

**Files:**
- Create: `frontend/src/components/tour/TourProvider.tsx`
- Modify: `frontend/src/app/layout.tsx` (wrap `{children}` in `<TourProvider>`)

**Interfaces:**
- Consumes: `TourStep`, `TourLang`, `TourPage`, `stepsFor` from Task 1; `fetchTopTurnover` from `@/lib/api`.
- Produces:

```ts
export interface TourState {
  running: boolean
  steps: TourStep[]
  index: number
  lang: TourLang
  start: (from: TourPage) => void
  next: () => void      // on the last step, closes
  back: () => void      // no-op on the first step
  close: () => void
  skip: (direction: 1 | -1) => void   // used by the overlay when a target never appears; closes at either end
  setLang: (lang: TourLang) => void
}
export function useTour(): TourState
export default function TourProvider({ children }: { children: React.ReactNode }): JSX.Element
```

- [ ] **Step 1:** Write `TourProvider` (client component). `start('dashboard')` resolves the example symbol once: first row of `fetchTopTurnover()`, falling back to `'NABIL'` on error or empty. `start('stock')` uses the symbol in the current path.
- [ ] **Step 2:** Page changes: when the current step's `page` differs from the page the path is on (`/` = dashboard, `/stock/...` = stock), `router.push` to `/stock/<symbol>` or `/`. Record the path the tour pushed; a path change to anything else while running calls `close()`.
- [ ] **Step 3:** Storage: read `nepse-tour-lang` on mount (default `'en'`), write it in `setLang`. On mount, if the path is `/` and `nepse-tour-seen` is not set, call `start('dashboard')`. `start` sets `nepse-tour-seen`. All in try/catch.
- [ ] **Step 4:** Mount in `layout.tsx`, run the build check. Expected: passes.
- [ ] **Step 5:** Commit both files — `feat: tour state that survives page changes`.

### Task 3: Overlay and card

**Files:**
- Create: `frontend/src/components/tour/TourOverlay.tsx`
- Modify: `frontend/src/components/tour/TourProvider.tsx` (render `<TourOverlay />` after `{children}`)

**Interfaces:**
- Consumes: `useTour()` from Task 2; `TOUR_UI`, `LANG_NAMES` from Task 1.
- Produces: `export default function TourOverlay(): JSX.Element | null` — renders nothing when not running.

- [ ] **Step 1:** Target lookup: `document.querySelectorAll('[data-tour="<target>"]')`, lit area = union of their bounding rects plus 8px padding, clamped to the window. Poll every 150ms until found; after 6000ms call `skip(direction)` where direction is the way the user was travelling.
- [ ] **Step 2:** On finding the target, `scrollIntoView({ behavior: 'smooth', block })` with `block: 'center'`, or `'start'` when the target is taller than the window. Re-measure on `scroll` and `resize` through `requestAnimationFrame`.
- [ ] **Step 3:** Layers, all `position: fixed`: a transparent full-screen click blocker (z 9000); the lit area as a box with `box-shadow: 0 0 0 9999px rgba(2,6,23,0.78)` and a 2px blue ring (z 9001); the card (z 9002). For `target: null` the blocker itself is dimmed and the card is centred.
- [ ] **Step 4:** Card: width `min(420px, 100vw - 32px)`; placed right of the lit area, else left, else below, else above, else docked bottom-centre, 16px gap, always fully inside the window. Contents top to bottom: step counter and language switch (two buttons, current one filled), title, body, then Close on the left and Back / Next on the right. Back is hidden on the first step; Next reads `finish` on the last. `role="dialog"`, `aria-modal`, labelled by the title; focus moves to Next on every step.
- [ ] **Step 5:** Keys: ArrowRight / Enter = next, ArrowLeft = back, Escape = close. Ignore key repeat (`event.repeat`).
- [ ] **Step 6:** Run the build check. Expected: passes.
- [ ] **Step 7:** Commit — `feat: tour spotlight and card`.

### Task 4: Button, targets and browser checks

Before starting: the tablet work touching `page.tsx`, the stock page and `MarketStatusBar.tsx` must be committed, so this task's edits can be staged on their own. Stop and ask if it is not.

**Files:**
- Create: `frontend/src/components/tour/TourButton.tsx`
- Modify: `frontend/src/components/MarketStatusBar.tsx` (button before the admin buttons; `data-tour` on status + index pills wrapper `status`, admin buttons wrapper `admin-actions`, search wrapper `search`)
- Modify: `frontend/src/app/page.tsx` (`data-tour` on the range bar `range`, and on the wrapper divs: `index-chart`, `sectors`, `movers` on both gainers and losers columns, `turnover`, `breadth`, `trade-activity`, `ai-insights`, and a new wrapper div around `<NewsFeed />` `news`)
- Modify: `frontend/src/app/stock/[symbol]/page.tsx` (button on the right of the nav bar next to the symbol label; `stock-back` on the back button; wrapper divs for `stock-header`, `stock-ai`, `stock-floorsheet`; `stock-chart` on the chart card; `stock-news` on the news column; `stock-technicals` on both the technicals and signals columns; `stock-stats` on the row-2 grid)

**Interfaces:**
- Consumes: `useTour()`, `TOUR_UI`.
- Produces: `export default function TourButton({ from }: { from: TourPage }): JSX.Element` — label `TOUR_UI[lang].button`, calls `start(from)`.

- [ ] **Step 1:** Write `TourButton` and add the attributes and wrappers listed above. Wrappers must not change layout (no classes beyond what the wrapped element's grid cell already needs).
- [ ] **Step 2:** Run the build check. Expected: passes.
- [ ] **Step 3:** Run the image as a preview against the live backend and walk it in a browser at 1440px and 800px wide, in both languages: every step lights the right panel, the card is fully on screen, the page change to the stock page and back works.
- [ ] **Step 4:** Review Focus checks: (1) with the market closed, every dashboard step still shows; (2) start the tour from `/stock/NOSUCH` — it ends by itself within about 6 seconds per step and leaves the error page usable; (3) with storage blocked, the tour runs; (4) hammer Next and ArrowRight — the counter never passes 21 and the tour closes cleanly; (5) press browser Back mid-tour on the stock page — the tour closes.
- [ ] **Step 5:** Stop the preview container and confirm its port is free.
- [ ] **Step 6:** Commit the four files — `feat: take-the-tour button on both pages`.

### Task 5: Nepali read-through

- [ ] **Step 1:** Give Aarogya the Nepali copy to read; apply his corrections to `tourSteps.ts`.
- [ ] **Step 2:** Run the build check, commit — `fix: tour Nepali wording`.

Deploying to `nepse.rogi` is not part of this plan.
