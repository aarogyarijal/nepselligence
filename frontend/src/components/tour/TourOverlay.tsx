'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { LANG_NAMES, TOUR_UI } from './tourSteps'
import type { TourLang } from './tourSteps'
import { pageOf, useTour } from './tourContext'

/** How long a page gets to show its panels before missing ones are skipped */
const PAGE_BUDGET_MS = 6000
/** Shortest wait for any single panel, so a slow render is not mistaken for a missing one */
const STEP_MIN_MS = 400
const POLL_MS = 150
/** Delay before the "one moment" card appears, so quick steps do not flicker */
const WAIT_CARD_MS = 400
const PAD = 8
const GAP = 16
const MARGIN = 16
const CARD_WIDTH = 420
const LANGS: TourLang[] = ['en', 'ne']

interface Box { left: number; top: number; width: number; height: number }

function targetsOf(target: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)).filter(el => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  })
}

/** One box around every element of the step, in window coordinates */
function unionBox(els: HTMLElement[]): Box {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const el of els) {
    const r = el.getBoundingClientRect()
    left = Math.min(left, r.left)
    top = Math.min(top, r.top)
    right = Math.max(right, r.right)
    bottom = Math.max(bottom, r.bottom)
  }
  return { left, top, width: right - left, height: bottom - top }
}

/** Padded, and cut down to what the window can show */
function litBox(box: Box, vw: number, vh: number): Box | null {
  const left = Math.max(4, box.left - PAD)
  const top = Math.max(4, box.top - PAD)
  const right = Math.min(vw - 4, box.left + box.width + PAD)
  const bottom = Math.min(vh - 4, box.top + box.height + PAD)
  if (right - left < 8 || bottom - top < 8) return null
  return { left, top, width: right - left, height: bottom - top }
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

/** Beside the lit area where there is room: right, left, below, above, else docked at the bottom */
function placeCard(lit: Box | null, cw: number, ch: number, vw: number, vh: number): { left: number; top: number } {
  const centredLeft = (vw - cw) / 2
  if (!lit) return { left: centredLeft, top: Math.max(MARGIN, (vh - ch) / 2) }
  const right = lit.left + lit.width
  const bottom = lit.top + lit.height
  const besideTop = clamp(lit.top + lit.height / 2 - ch / 2, MARGIN, Math.max(MARGIN, vh - ch - MARGIN))
  const stackedLeft = clamp(lit.left + lit.width / 2 - cw / 2, MARGIN, Math.max(MARGIN, vw - cw - MARGIN))
  if (right + GAP + cw + MARGIN <= vw) return { left: right + GAP, top: besideTop }
  if (lit.left - GAP - cw >= MARGIN) return { left: lit.left - GAP - cw, top: besideTop }
  if (bottom + GAP + ch + MARGIN <= vh) return { left: stackedLeft, top: bottom + GAP }
  if (lit.top - GAP - ch >= MARGIN) return { left: stackedLeft, top: lit.top - GAP - ch }
  return { left: centredLeft, top: Math.max(MARGIN, vh - ch - MARGIN) }
}

function scrollToBox(box: Box) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  // The card needs room beside the panel; a panel too wide for that gets the card underneath,
  // so it is shown from the top of the window. So is a panel taller than the window.
  const sideRoom = CARD_WIDTH + GAP + MARGIN
  const tooWide = box.left - PAD - sideRoom < 0 && box.left + box.width + PAD + sideRoom > vw
  const tooTall = box.height > vh - 2 * MARGIN
  const offset = tooWide || tooTall ? MARGIN + PAD : (vh - box.height) / 2
  window.scrollTo({ top: Math.max(0, window.scrollY + box.top - offset), behavior: reduce ? 'auto' : 'smooth' })
}

export default function TourOverlay() {
  const { running, steps, index, lang, direction, next, back, close, skip, setLang } = useTour()
  const pathname = usePathname()
  const step = running ? steps[index] : undefined
  const stepId = step?.id
  const target = step?.target ?? null
  const onStepPage = step ? pageOf(pathname) === step.page : false

  /** Panel located (or the step has none) and the card can be shown */
  const [ready, setReady] = useState(false)
  const [waitCard, setWaitCard] = useState(false)
  const [lit, setLit] = useState<Box | null>(null)
  const [viewport, setViewport] = useState({ w: 0, h: 0 })
  const [cardSize, setCardSize] = useState({ w: 0, h: 0 })

  const cardRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const arrivedAtRef = useRef(0)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const directionRef = useRef(direction)
  directionRef.current = direction

  const measure = useCallback(() => {
    setViewport({ w: window.innerWidth, h: window.innerHeight })
    if (!target) { setLit(null); return }
    const els = targetsOf(target)
    setLit(els.length ? litBox(unionBox(els), window.innerWidth, window.innerHeight) : null)
  }, [target])

  // The clock for "this page has had long enough" restarts on every page arrival
  useEffect(() => {
    arrivedAtRef.current = performance.now()
  }, [pathname, running])

  // Find the step's panel, bring it into view, and give up on it if it never appears
  useEffect(() => {
    setReady(false)
    setWaitCard(false)
    setLit(null)
    if (!stepId) return
    setViewport({ w: window.innerWidth, h: window.innerHeight })
    if (!target) { setReady(true); return }

    const waitTimer = window.setTimeout(() => setWaitCard(true), WAIT_CARD_MS)
    if (!onStepPage) return () => window.clearTimeout(waitTimer)   // the provider is changing page

    const startedAt = performance.now()
    let pollTimer = 0
    const look = () => {
      const els = targetsOf(target)
      if (els.length) {
        window.clearTimeout(waitTimer)
        scrollToBox(unionBox(els))
        setReady(true)
        measure()
        return
      }
      const now = performance.now()
      if (now - arrivedAtRef.current > PAGE_BUDGET_MS && now - startedAt > STEP_MIN_MS) {
        skip(directionRef.current)
        return
      }
      pollTimer = window.setTimeout(look, POLL_MS)
    }
    look()
    return () => {
      window.clearTimeout(waitTimer)
      window.clearTimeout(pollTimer)
    }
  }, [stepId, target, onStepPage, measure, skip])

  // Keep the lit area on its panel while the page scrolls, resizes or fills with data
  useEffect(() => {
    if (!ready) return
    let raf = 0
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    const interval = window.setInterval(schedule, 300)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      window.clearInterval(interval)
    }
  }, [ready, measure])

  // Card size, for placing it fully inside the window
  const showCard = ready || waitCard
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el) return
    const read = () => setCardSize({ w: el.offsetWidth, h: el.offsetHeight })
    read()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    observer.observe(el)
    return () => observer.disconnect()
  }, [showCard, stepId, lang])

  // Focus: into the card on every step, back to where it was when the tour ends
  useEffect(() => {
    if (!running) return
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      const el = restoreFocusRef.current
      if (el && document.contains(el)) el.focus({ preventScroll: true })
    }
  }, [running])

  useEffect(() => {
    if (!showCard) return
    const el = ready ? nextRef.current : closeRef.current
    el?.focus({ preventScroll: true })
  }, [showCard, ready, stepId])

  // Keyboard. Enter and Space are left to whichever button has focus (Next, by default).
  useEffect(() => {
    if (!running) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return }
      if (e.key === 'Tab') {
        // Keep Tab inside the card; everything behind it is blocked anyway
        const buttons = Array.from(cardRef.current?.querySelectorAll<HTMLElement>('button') ?? [])
        if (!buttons.length) { e.preventDefault(); return }
        const first = buttons[0]
        const last = buttons[buttons.length - 1]
        const active = document.activeElement
        if (!cardRef.current?.contains(active)) { e.preventDefault(); first.focus(); return }
        if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
        return
      }
      if (e.repeat || !ready) return
      if (e.key === 'ArrowRight') { e.preventDefault(); next() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running, ready, next, back, close])

  if (!step) return null

  const ui = TOUR_UI[lang]
  const isFirst = index === 0
  const isLast = index === steps.length - 1
  const spotlight = ready ? lit : null
  const measured = cardSize.w > 0 && viewport.w > 0
  const pos = placeCard(spotlight, cardSize.w, cardSize.h, viewport.w, viewport.h)

  return (
    <>
      {/* Catches every click and tap so nothing behind the tour can be pressed */}
      <div
        className="fixed inset-0 z-[9000] transition-colors duration-200"
        style={{ backgroundColor: spotlight ? 'transparent' : 'rgba(2, 6, 23, 0.78)' }}
        aria-hidden="true"
      />

      {spotlight && (
        <div
          className="fixed z-[9001] rounded-xl pointer-events-none ring-2 ring-sky-400 transition-all duration-200 motion-reduce:transition-none"
          style={{
            left: spotlight.left,
            top: spotlight.top,
            width: spotlight.width,
            height: spotlight.height,
            boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.78)',
          }}
          aria-hidden="true"
        />
      )}

      {showCard && (
        <div
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-title"
          lang={lang}
          className="fixed z-[9002] bg-slate-900 border border-slate-500 rounded-2xl shadow-2xl p-6 text-slate-100"
          style={{
            width: `min(${CARD_WIDTH}px, calc(100vw - ${2 * MARGIN}px))`,
            maxHeight: 'calc(100vh - 32px)',
            overflowY: 'auto',
            left: pos.left,
            top: pos.top,
            // Not visibility:hidden — a hidden card cannot take focus
            opacity: measured ? 1 : 0,
          }}
        >
          <div className="flex items-center justify-between gap-3 mb-4">
            <span className="text-sm font-medium text-slate-400">{ui.stepOf(index + 1, steps.length)}</span>
            <div className="flex rounded-lg border border-slate-600 overflow-hidden" role="group" aria-label="Language / भाषा">
              {LANGS.map(l => (
                <button
                  key={l}
                  type="button"
                  lang={l}
                  onClick={() => setLang(l)}
                  aria-pressed={lang === l}
                  className={`px-3 min-h-[40px] text-sm font-semibold transition-colors ${
                    lang === l ? 'bg-sky-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {LANG_NAMES[l]}
                </button>
              ))}
            </div>
          </div>

          <div aria-live="polite">
            {ready ? (
              <>
                <h2 id="tour-title" className="text-[22px] leading-snug font-semibold text-white mb-2">
                  {step.title[lang]}
                </h2>
                <p className="text-[18px] leading-relaxed text-slate-200">{step.body[lang]}</p>
              </>
            ) : (
              <h2 id="tour-title" className="text-[22px] leading-snug font-semibold text-white">
                {ui.loading}
              </h2>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 mt-6">
            <button
              ref={closeRef}
              type="button"
              onClick={close}
              className="min-h-[48px] px-4 rounded-lg text-base font-semibold text-slate-300 border border-slate-600 hover:bg-slate-800 hover:text-white transition-colors"
            >
              {ui.close}
            </button>
            {ready && (
              <div className="flex items-center gap-3">
                {!isFirst && (
                  <button
                    type="button"
                    onClick={back}
                    className="min-h-[48px] px-5 rounded-lg text-base font-semibold text-slate-100 bg-slate-700 hover:bg-slate-600 transition-colors"
                  >
                    {ui.back}
                  </button>
                )}
                <button
                  ref={nextRef}
                  type="button"
                  onClick={next}
                  className="min-h-[48px] px-6 rounded-lg text-base font-semibold text-white bg-sky-600 hover:bg-sky-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-white transition-colors"
                >
                  {isLast ? ui.finish : ui.next}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
