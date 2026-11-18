# Guided tour — design

Date: 2026-11-18

## Intent

Aarogya's father uses nepselligence and is not comfortable with software. He
follows NEPSE already; what he needs is to be shown what each part of the
screen is for and what he can do with it. A guided tour, restartable at any
time from a button in the top bar, gives him that without anyone sitting next
to him.

## Goals

- A clearly worded "Take the tour" button in the top bar of both pages.
- The tour lights up one panel at a time, with a large-text card explaining it.
- He only ever presses Next, Back or Close. The tour does the scrolling and
  the page change for him.
- Text in English and Nepali, with a switch on the card. His choice is
  remembered.
- Starts by itself on his first visit; afterwards only from the button.

## Non-goals

- Teaching what an indicator means. The hover tooltips on the stock page
  already do that.
- Steps that make him click something in the app to continue.
- Translating the app itself. Only the tour is bilingual.
- A phone layout. The app is desktop only (1280px and up).
- Backend changes or new dependencies.

## Anti-goals

- Small text, icon-only controls, or jargon in the copy.
- A tour he can get stuck in: every step has a visible Close, and a panel that
  fails to load is skipped, not waited on forever.
- A tour that leaves the app in a changed state (a range switched, an admin
  job triggered).

## Approaches

1. **Hand-built spotlight tour — chosen.** Our own component. No dependency,
   full control over card size, the language switch and the page change.
2. **Tour library (driver.js / react-joyride).** Ready-made spotlight, but
   the cross-page step, the in-card language switch and the oversized
   controls would all still be custom, and it adds a dependency to the
   Docker build.
3. **Slideshow of annotated screenshots.** Least code, but he would have to
   match pictures to the real screen and the pictures go stale.

Aarogya left the how to Claude; option 1 is Claude's call.

## Design (Claude's calls)

**Files**, all under `frontend/src/components/tour/`:

- `TourProvider.tsx` — holds tour state (running, step index, language) in a
  React context. Mounted in `app/layout.tsx` so it survives the move from the
  dashboard to a stock page.
- `TourOverlay.tsx` — the dimmed backdrop, the lit-up cutout and the card.
- `TourButton.tsx` — the "Take the tour" button.
- `tourSteps.ts` — the ordered step list, each with a target id, the page it
  lives on, and its title and body in `en` and `ne`.

**Targets.** Panels get a `data-tour="<id>"` attribute. Steps find their
panel by that attribute, so the tour does not depend on class names or layout.

**Steps.** About 12 on the dashboard (welcome, market status and index
figures, maintenance buttons, search, range selector, index chart, sectors,
gainers and losers, turnover leaders, breadth and trade activity, AI
insights, news) and about 8 on the stock page (header, price chart, news,
technicals and signals, volume / volatility / relative performance, AI
analysis and chat, floorsheet timeline, how to get back).

**Where it starts.** From the dashboard it runs the whole tour, moving to the
stock page of the day's top turnover share (falling back to NABIL) for the
second half. From a stock page it runs only that page's steps, on the share
he is already looking at.

**Each step.** Scroll the panel into view, wait for it to exist (the stock
page loads its data first), light it up, place the card beside it where
there is room. A panel taller than the window is lit only as far as the
window shows. If the panel has not appeared after a few seconds the step is
skipped. Clicks on the app are blocked while the tour runs.

**The card.** Large text (about 18px body, 22px title), "Step 5 of 20", big
Back / Next buttons, a Close button, and an `English | नेपाली` switch. The
last step's button reads "Finish". Keyboard: right / left arrows, Esc to
close. Focus moves to Next on each step.

**Remembered in the browser.** `nepse-tour-seen` (so it auto-starts only
once) and `nepse-tour-lang`. Reads and writes are guarded so the page still
works if storage is unavailable.

**Copy.** Says what the panel is for and what he can do there, in two or
three short sentences. The Nepali is written naturally, not word for word;
market terms he would know in English from NEPSE itself (NEPSE, LTP,
turnover) stay as they are. Aarogya reads the Nepali over before it ships.

## Checking it

There is no frontend test setup, so: `docker compose build frontend` for the
type check and build, then a walk through every step in the browser in both
languages, from both starting pages, including Close mid-tour and a restart.

## Left to the builder

Exact wording of each step, card placement rules, and transition timing.
