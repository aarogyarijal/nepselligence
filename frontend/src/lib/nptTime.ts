// Nepal Time (NPT) helpers.
//
// Every time the app shows is NPT, wherever the viewer is. Nothing here reads
// the viewer's own timezone: NPT has been a fixed UTC+5:45 with no daylight
// saving since 1986, so all conversions are plain arithmetic on UTC.

/** NPT offset in seconds (UTC+5:45). */
export const NPT_OFFSET_SECONDS = 5 * 3600 + 45 * 60 // 20700
const NPT_OFFSET_MS = NPT_OFFSET_SECONDS * 1000

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const NAIVE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/
const DAILY_TIME = /^\d{4}-\d{2}-\d{2}(?:T00:00(?::00(?:\.0+)?)?)?$/

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

/**
 * Parse an API time string to epoch milliseconds (NaN if unreadable).
 * A string with no offset is NPT wall time, and a bare date is NPT midnight.
 * `new Date()` would read those in the viewer's own timezone (or UTC), giving
 * a different instant in Kathmandu and New York.
 */
export function parseApiTime(value: string): number {
  const m = NAIVE_TIME.exec(value.trim())
  if (m) {
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) - NPT_OFFSET_MS
  }
  return new Date(value).getTime()
}

/** True for a daily point: a bare date, or a timestamp at midnight with no offset. */
export function isDailyTime(value: string): boolean {
  return DAILY_TIME.test(value.trim())
}

export interface NPTFields {
  year: number
  /** 1–12 */
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/** Break an instant (epoch ms) into NPT calendar and clock fields. */
export function nptFields(epochMs: number): NPTFields {
  return shiftedFields(Math.floor((epochMs + NPT_OFFSET_MS) / 1000))
}

/** Fields of a chart timestamp, which already has the NPT offset added. */
function shiftedFields(shiftedSeconds: number): NPTFields {
  const d = new Date(shiftedSeconds * 1000)
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  }
}

/**
 * Unix seconds shifted by the NPT offset. lightweight-charts labels its axis
 * from the UTC fields of a timestamp, so the shift makes it read as NPT.
 */
export function toNPTUnix(value: string): number {
  return Math.floor(parseApiTime(value) / 1000) + NPT_OFFSET_SECONDS
}

/** Today's date in Nepal as YYYY-MM-DD. */
export function nptToday(now: number = Date.now()): string {
  const f = nptFields(now)
  return `${f.year}-${pad(f.month)}-${pad(f.day)}`
}

/** Move a YYYY-MM-DD date by whole days and months, as calendar arithmetic. */
export function shiftDate(ymd: string, by: { days?: number; months?: number }): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  if (by.months) date.setUTCMonth(date.getUTCMonth() + by.months)
  if (by.days) date.setUTCDate(date.getUTCDate() + by.days)
  return date.toISOString().slice(0, 10)
}

/** "18 Nov, 3:07 pm NPT". Pass withZone=false where a heading already says NPT. */
export function formatNPT(value: string | null | undefined, withZone = true): string {
  if (!value) return '—'
  const ms = parseApiTime(value)
  if (Number.isNaN(ms)) return value
  const f = nptFields(ms)
  const hour12 = f.hour % 12 === 0 ? 12 : f.hour % 12
  const text = `${f.day} ${MONTHS[f.month - 1]}, ${hour12}:${pad(f.minute)} ${f.hour < 12 ? 'am' : 'pm'}`
  return withZone ? `${text} NPT` : text
}

/** 24-hour NPT clock time, "14:05". */
export function formatNPTClock(value: string): string {
  const ms = parseApiTime(value)
  if (Number.isNaN(ms)) return value
  const f = nptFields(ms)
  return `${pad(f.hour)}:${pad(f.minute)}`
}

/** Start of the NPT clock bucket an instant falls in, e.g. "11:00" for 11:07 with 10-minute buckets. */
export function nptBucketKey(value: string, bucketMinutes = 10): string {
  const ms = parseApiTime(value)
  if (Number.isNaN(ms)) return '??:??'
  const f = nptFields(ms)
  return `${pad(f.hour)}:${pad(Math.floor(f.minute / bucketMinutes) * bucketMinutes)}`
}

/** lightweight-charts hands formatters back the time it was given: a shifted timestamp or a YYYY-MM-DD day. */
type ChartTime = number | string | { year: number; month: number; day: number }

function chartTimeFields(time: ChartTime, realTime?: (t: number) => number): { f: NPTFields; daily: boolean } {
  if (typeof time === 'number') {
    return { f: shiftedFields(realTime ? realTime(time) : time), daily: false }
  }
  if (typeof time === 'string') {
    const [year, month, day] = time.slice(0, 10).split('-').map(Number)
    return { f: { year, month, day, hour: 0, minute: 0, second: 0 }, daily: true }
  }
  return { f: { ...time, hour: 0, minute: 0, second: 0 }, daily: true }
}

/**
 * Axis and crosshair labels for lightweight-charts, built without the viewer's
 * timezone. The library's own formatter rebuilds each time as a local Date,
 * which shifts a label wherever that local time is skipped by daylight saving.
 *
 * `realTime` maps a collapsed-axis timestamp back to the real one (see
 * collapseSessionGaps); with it, every tick carries the full date and time.
 */
export function chartTimeFormatters(realTime?: (t: number) => number) {
  // tickMarkType: 0 year, 1 month, 2 day of month, 3 time, 4 time with seconds
  const tickMarkFormatter = (time: ChartTime, tickMarkType: number): string => {
    const { f, daily } = chartTimeFields(time, realTime)
    const clock = `${pad(f.hour)}:${pad(f.minute)}`
    if (realTime && !daily) return `${f.day} ${MONTHS[f.month - 1]} ${clock}`
    switch (tickMarkType) {
      case 0: return String(f.year)
      case 1: return MONTHS[f.month - 1]
      case 2: return String(f.day)
      case 4: return daily ? String(f.day) : `${clock}:${pad(f.second)}`
      default: return daily ? String(f.day) : clock
    }
  }
  const timeFormatter = (time: ChartTime): string => {
    const { f, daily } = chartTimeFields(time, realTime)
    const date = `${f.day} ${MONTHS[f.month - 1]} ${f.year}`
    return daily ? date : `${date} ${pad(f.hour)}:${pad(f.minute)} NPT`
  }
  return { tickMarkFormatter, timeFormatter }
}

/**
 * First date (YYYY-MM-DD) of a daily chart range, counted back from today in
 * Nepal. Empty for ranges that show everything loaded.
 */
export function dailyRangeStart(range: string, now: number = Date.now()): string {
  const today = nptToday(now)
  switch (range) {
    case '5D': return shiftDate(today, { days: -5 })
    case '1M': return shiftDate(today, { months: -1 })
    case '3M': return shiftDate(today, { months: -3 })
    case '6M': return shiftDate(today, { months: -6 })
    default: return ''
  }
}
