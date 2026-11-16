/**
 * Collapse non-trading gaps in intraday data so candles/lines render contiguously.
 * Returns virtualTime→realTime map for axis labels + legend.
 * Only applies to numeric (intraday) timestamps with session breaks.
 */
export function collapseSessionGaps(
  items: Array<{ time: number; [k: string]: unknown }>,
): { collapsed: typeof items; timeMap: Map<number, number> } | null {
  if (items.length < 2 || typeof items[0].time !== 'number') return null

  // Find median gap to estimate the interval
  const gaps: number[] = []
  for (let i = 1; i < items.length; i++) {
    gaps.push(items[i].time - items[i - 1].time)
  }
  gaps.sort((a, b) => a - b)
  const medianGap = gaps[Math.floor(gaps.length / 2)]

  // Only collapse if there's at least one gap > 3× the median (session break)
  const hasSessionBreak = gaps.some(g => g > medianGap * 3)
  if (!hasSessionBreak) return null

  const timeMap = new Map<number, number>()
  const collapsed: typeof items = []

  for (let i = 0; i < items.length; i++) {
    if (i === 0) {
      timeMap.set(items[i].time, items[i].time)
      collapsed.push(items[i])
      continue
    }
    const realGap = items[i].time - items[i - 1].time
    const step = realGap > medianGap * 3 ? medianGap : realGap
    const prevVirtual = collapsed[i - 1].time
    const virtualTime = prevVirtual + step
    timeMap.set(virtualTime, items[i].time)
    collapsed.push({ ...items[i], time: virtualTime })
  }

  return { collapsed, timeMap }
}
