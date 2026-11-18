'use client'

import { TOUR_UI } from './tourSteps'
import type { TourPage } from './tourSteps'
import { useTour } from './tourContext'

/** Starts the guided tour from the page it sits on. Labelled in words, in the language last chosen. */
export default function TourButton({ from }: { from: TourPage }) {
  const { start, lang } = useTour()
  return (
    <button
      type="button"
      onClick={() => start(from)}
      lang={lang}
      className="shrink-0 px-3 py-1.5 rounded text-sm font-semibold border border-sky-500 text-sky-300 hover:bg-sky-500/15 hover:text-sky-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 transition-colors"
    >
      {TOUR_UI[lang].button}
    </button>
  )
}
