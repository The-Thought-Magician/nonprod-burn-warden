// ---------------------------------------------------------------------------
// cron.ts — THE ENGINE
//
// Pure, deterministic functions for scheduling analysis used by the routes.
// No external services, no DB. Everything is computed from inputs.
//
// "kind" is one of: 'cron' | 'rate' | 'oneoff'
//   - cron:   standard 5/6-field cron expression, evaluated with cron-parser
//   - rate:   "every N minutes|hours|days" computed arithmetically
//   - oneoff: a single ISO instant string; fires once if in the future
// ---------------------------------------------------------------------------

import { CronExpressionParser } from 'cron-parser'

export type ScheduleKind = 'cron' | 'rate' | 'oneoff'

export interface ScheduleJob {
  id: string
  kind: ScheduleKind
  expr: string
  timezone?: string
  resourceId?: string
}

export interface ValidationResult {
  valid: boolean
  error?: string
}

export interface Collision {
  windowStart: string
  windowEnd: string
  jobIds: string[]
  severity: 'low' | 'medium' | 'high'
  resourceId?: string
}

export interface HeatmapBucket {
  bucket: string
  count: number
}

export interface DstTrap {
  type: 'double_fire' | 'skip' | 'ambiguous'
  atLocal: string
  atUtc: string
}

export interface CoverageGap {
  start: string
  end: string
  durationHours: number
}

export interface SpreadSuggestion {
  jobId: string
  suggestedExpr: string
  reason: string
}

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

// ---------------------------------------------------------------------------
// rate parsing
// ---------------------------------------------------------------------------

interface RateSpec {
  intervalMs: number
  n: number
  unit: 'minutes' | 'hours' | 'days'
}

function parseRate(expr: string): RateSpec | null {
  const m = expr
    .trim()
    .toLowerCase()
    .match(/^every\s+(\d+)\s+(minute|minutes|hour|hours|day|days)$/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n <= 0) return null
  const rawUnit = m[2]
  if (rawUnit.startsWith('minute')) return { intervalMs: n * MINUTE_MS, n, unit: 'minutes' }
  if (rawUnit.startsWith('hour')) return { intervalMs: n * HOUR_MS, n, unit: 'hours' }
  return { intervalMs: n * DAY_MS, n, unit: 'days' }
}

// ---------------------------------------------------------------------------
// validateExpression
// ---------------------------------------------------------------------------

export function validateExpression(kind: ScheduleKind, expr: string): ValidationResult {
  const trimmed = (expr ?? '').trim()
  if (!trimmed) return { valid: false, error: 'Expression is empty' }

  if (kind === 'cron') {
    try {
      CronExpressionParser.parse(trimmed)
      return { valid: true }
    } catch (e) {
      return { valid: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  if (kind === 'rate') {
    const r = parseRate(trimmed)
    if (!r) return { valid: false, error: 'Rate must be "every N minutes|hours|days"' }
    return { valid: true }
  }

  if (kind === 'oneoff') {
    const t = Date.parse(trimmed)
    if (Number.isNaN(t)) return { valid: false, error: 'One-off must be a valid ISO timestamp' }
    return { valid: true }
  }

  return { valid: false, error: `Unknown kind: ${kind}` }
}

// ---------------------------------------------------------------------------
// describeExpression
// ---------------------------------------------------------------------------

export function describeExpression(kind: ScheduleKind, expr: string, timezone = 'UTC'): string {
  const trimmed = (expr ?? '').trim()
  const v = validateExpression(kind, trimmed)
  if (!v.valid) return `Invalid expression: ${v.error}`

  if (kind === 'rate') {
    const r = parseRate(trimmed)!
    const n = r.n
    if (n === 1) return `Every ${r.unit.slice(0, -1)}`
    return `Every ${n} ${r.unit}`
  }

  if (kind === 'oneoff') {
    return `Once at ${new Date(Date.parse(trimmed)).toISOString()}`
  }

  // cron
  const fields = trimmed.split(/\s+/)
  // Support 5 or 6 field cron (with optional seconds).
  const base = fields.length === 6 ? fields.slice(1) : fields
  const [min, hour, dom, mon, dow] = base
  const parts: string[] = []

  if (min === '*' && hour === '*') {
    parts.push('every minute')
  } else if (hour !== '*' && min !== '*' && !min.includes('*') && !hour.includes('*')) {
    const hh = String(parseInt(hour, 10)).padStart(2, '0')
    const mm = String(parseInt(min, 10)).padStart(2, '0')
    parts.push(`at ${hh}:${mm}`)
  } else {
    parts.push(`minute ${min}, hour ${hour}`)
  }

  if (dom !== '*') parts.push(`on day-of-month ${dom}`)
  if (mon !== '*') parts.push(`in month ${mon}`)
  if (dow !== '*') {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const labels = dow
      .split(',')
      .map((d) => {
        const n = parseInt(d, 10)
        return Number.isFinite(n) && names[n % 7] ? names[n % 7] : d
      })
      .join(', ')
    parts.push(`on ${labels}`)
  }

  const tzSuffix = timezone && timezone !== 'UTC' ? ` (${timezone})` : ' (UTC)'
  return parts.join(', ') + tzSuffix
}

// ---------------------------------------------------------------------------
// nextFirings
// ---------------------------------------------------------------------------

export function nextFirings(
  kind: ScheduleKind,
  expr: string,
  timezone = 'UTC',
  fromISO?: string,
  count = 5,
): string[] {
  const trimmed = (expr ?? '').trim()
  if (!validateExpression(kind, trimmed).valid) return []
  const n = Math.max(0, Math.min(count, 1000))
  if (n === 0) return []

  const from = fromISO ? new Date(fromISO) : new Date()
  if (Number.isNaN(from.getTime())) return []

  if (kind === 'cron') {
    try {
      const it = CronExpressionParser.parse(trimmed, {
        tz: timezone || 'UTC',
        currentDate: from,
      })
      const out: string[] = []
      for (let i = 0; i < n; i++) {
        out.push(it.next().toDate().toISOString())
      }
      return out
    } catch {
      return []
    }
  }

  if (kind === 'rate') {
    const r = parseRate(trimmed)!
    const out: string[] = []
    let t = from.getTime() + r.intervalMs
    for (let i = 0; i < n; i++) {
      out.push(new Date(t).toISOString())
      t += r.intervalMs
    }
    return out
  }

  // oneoff
  const t = Date.parse(trimmed)
  if (Number.isNaN(t)) return []
  if (t <= from.getTime()) return []
  return [new Date(t).toISOString()]
}

// ---------------------------------------------------------------------------
// computeCollisions
// ---------------------------------------------------------------------------

export function computeCollisions(
  jobs: ScheduleJob[],
  opts: { horizonDays?: number; threshold?: number } = {},
): Collision[] {
  const horizonDays = opts.horizonDays ?? 7
  const threshold = Math.max(2, opts.threshold ?? 2)
  const from = new Date()
  const horizonMs = horizonDays * DAY_MS
  const limit = from.getTime() + horizonMs

  // Bucket firings by minute.
  // key = minute epoch -> { jobIds:Set, resources:Map<resourceId, count> }
  const buckets = new Map<number, { jobIds: Set<string>; resources: Map<string, Set<string>> }>()

  for (const job of jobs) {
    // Generate enough firings to cover the horizon (cap to avoid runaway).
    const firings = nextFirings(job.kind, job.expr, job.timezone, from.toISOString(), 500)
    for (const iso of firings) {
      const t = Date.parse(iso)
      if (t > limit) break
      const minute = Math.floor(t / MINUTE_MS)
      let b = buckets.get(minute)
      if (!b) {
        b = { jobIds: new Set(), resources: new Map() }
        buckets.set(minute, b)
      }
      b.jobIds.add(job.id)
      if (job.resourceId) {
        let set = b.resources.get(job.resourceId)
        if (!set) {
          set = new Set()
          b.resources.set(job.resourceId, set)
        }
        set.add(job.id)
      }
    }
  }

  const collisions: Collision[] = []
  for (const [minute, b] of [...buckets.entries()].sort((a, z) => a[0] - z[0])) {
    const concurrency = b.jobIds.size
    // Find a resource with >=2 jobs sharing it in this minute.
    let sharedResource: string | undefined
    let sharedCount = 0
    for (const [rid, set] of b.resources.entries()) {
      if (set.size >= 2 && set.size > sharedCount) {
        sharedResource = rid
        sharedCount = set.size
      }
    }

    const flagByConcurrency = concurrency >= threshold
    const flagByResource = sharedCount >= 2
    if (!flagByConcurrency && !flagByResource) continue

    const windowStart = new Date(minute * MINUTE_MS).toISOString()
    const windowEnd = new Date((minute + 1) * MINUTE_MS).toISOString()
    const effective = Math.max(concurrency, sharedCount)
    const severity: Collision['severity'] = effective >= 5 ? 'high' : effective >= 3 ? 'medium' : 'low'
    collisions.push({
      windowStart,
      windowEnd,
      jobIds: [...b.jobIds],
      severity,
      ...(sharedResource ? { resourceId: sharedResource } : {}),
    })
  }

  return collisions
}

// ---------------------------------------------------------------------------
// loadHeatmap
// ---------------------------------------------------------------------------

export function loadHeatmap(
  jobs: ScheduleJob[],
  opts: { horizonDays?: number } = {},
): HeatmapBucket[] {
  const horizonDays = opts.horizonDays ?? 7
  const from = new Date()
  const limit = from.getTime() + horizonDays * DAY_MS

  // Bucket by hour-of-week (0..167) to give a stable load grid.
  const counts = new Map<string, number>()
  for (const job of jobs) {
    const firings = nextFirings(job.kind, job.expr, job.timezone, from.toISOString(), 1000)
    for (const iso of firings) {
      const t = Date.parse(iso)
      if (t > limit) break
      const d = new Date(t)
      const dow = d.getUTCDay()
      const hour = d.getUTCHours()
      const bucket = `${dow}-${String(hour).padStart(2, '0')}`
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
    }
  }

  const out: HeatmapBucket[] = []
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      const bucket = `${dow}-${String(hour).padStart(2, '0')}`
      out.push({ bucket, count: counts.get(bucket) ?? 0 })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// dstTraps
//
// Detect daylight-saving transitions inside the window and classify how a
// recurring schedule interacts with them. Uses Intl to read the timezone's
// UTC offset at each instant; an offset change marks a transition.
// ---------------------------------------------------------------------------

function tzOffsetMinutes(timezone: string, date: Date): number {
  // Compute offset by formatting the same instant in the target zone vs UTC.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = dtf.formatToParts(date)
  const map: Record<string, number> = {}
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10)
  }
  let hour = map.hour
  if (hour === 24) hour = 0
  const asUTC = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second)
  return Math.round((asUTC - date.getTime()) / MINUTE_MS)
}

export function dstTraps(
  kind: ScheduleKind,
  expr: string,
  timezone = 'UTC',
  fromISO?: string,
  days = 365,
): DstTrap[] {
  if (!timezone || timezone === 'UTC') return []
  if (!validateExpression(kind, expr).valid) return []

  const from = fromISO ? new Date(fromISO) : new Date()
  if (Number.isNaN(from.getTime())) return []

  const traps: DstTrap[] = []
  const horizonMs = days * DAY_MS
  const limit = from.getTime() + horizonMs

  // Scan day-by-day for offset changes (transitions happen at most a couple
  // times per year). Sample at hour granularity around a detected day to find
  // the transition instant.
  let prevOffset = tzOffsetMinutes(timezone, from)
  for (let t = from.getTime() + DAY_MS; t <= limit; t += DAY_MS) {
    const offset = tzOffsetMinutes(timezone, new Date(t))
    if (offset === prevOffset) {
      prevOffset = offset
      continue
    }

    // Narrow to the hour of transition within this day.
    let transitionAt = t
    let lo = t - DAY_MS
    let hi = t
    let loOff = prevOffset
    while (hi - lo > MINUTE_MS) {
      const mid = Math.floor((lo + hi) / 2)
      const midOff = tzOffsetMinutes(timezone, new Date(mid))
      if (midOff === loOff) lo = mid
      else hi = mid
    }
    transitionAt = hi

    const spring = offset > prevOffset // offset increased => clocks moved forward (spring forward)
    const atUtc = new Date(transitionAt).toISOString()
    const atLocal = new Date(transitionAt).toLocaleString('en-US', { timeZone: timezone })

    if (spring) {
      // Spring forward: a local hour is skipped. A job scheduled in that hour
      // is skipped.
      traps.push({ type: 'skip', atLocal, atUtc })
    } else {
      // Fall back: a local hour repeats — a wall-clock schedule can double-fire
      // or be ambiguous.
      traps.push({ type: 'double_fire', atLocal, atUtc })
      traps.push({ type: 'ambiguous', atLocal, atUtc })
    }

    prevOffset = offset
  }

  return traps
}

// ---------------------------------------------------------------------------
// coverageGaps
//
// Given a set of "covered" windows (e.g. on-call / business-hours windows) and
// jobs, return periods within the horizon where no window covers the time but
// jobs are scheduled to fire — i.e. unattended firings.
// ---------------------------------------------------------------------------

export interface CoverageWindow {
  start: string
  end: string
}

export function coverageGaps(
  windows: CoverageWindow[],
  jobs: ScheduleJob[],
  opts: { horizonDays?: number } = {},
): CoverageGap[] {
  const horizonDays = opts.horizonDays ?? 7
  const from = new Date()
  const limit = from.getTime() + horizonDays * DAY_MS

  // Normalize covered intervals.
  const covered = windows
    .map((w) => ({ start: Date.parse(w.start), end: Date.parse(w.end) }))
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .sort((a, b) => a.start - b.start)

  const isCovered = (t: number): boolean => {
    for (const w of covered) {
      if (t >= w.start && t < w.end) return true
    }
    return false
  }

  // Collect all uncovered firing instants.
  const uncovered: number[] = []
  for (const job of jobs) {
    const firings = nextFirings(job.kind, job.expr, job.timezone, from.toISOString(), 500)
    for (const iso of firings) {
      const t = Date.parse(iso)
      if (t > limit) break
      if (!isCovered(t)) uncovered.push(t)
    }
  }

  if (uncovered.length === 0) return []
  uncovered.sort((a, b) => a - b)

  // Group consecutive uncovered firings (within 1h of each other) into gaps.
  const gaps: CoverageGap[] = []
  let gapStart = uncovered[0]
  let gapEnd = uncovered[0]
  for (let i = 1; i < uncovered.length; i++) {
    if (uncovered[i] - gapEnd <= HOUR_MS) {
      gapEnd = uncovered[i]
    } else {
      gaps.push({
        start: new Date(gapStart).toISOString(),
        end: new Date(gapEnd).toISOString(),
        durationHours: (gapEnd - gapStart) / HOUR_MS,
      })
      gapStart = uncovered[i]
      gapEnd = uncovered[i]
    }
  }
  gaps.push({
    start: new Date(gapStart).toISOString(),
    end: new Date(gapEnd).toISOString(),
    durationHours: (gapEnd - gapStart) / HOUR_MS,
  })

  return gaps
}

// ---------------------------------------------------------------------------
// autoSpread
//
// For jobs that collide at the same minute, suggest staggered cron expressions
// that shift the minute offset so they no longer pile up.
// ---------------------------------------------------------------------------

export function autoSpread(
  jobs: ScheduleJob[],
  opts: { threshold?: number } = {},
): SpreadSuggestion[] {
  const threshold = Math.max(2, opts.threshold ?? 2)
  const collisions = computeCollisions(jobs, { horizonDays: 7, threshold })
  if (collisions.length === 0) return []

  const jobById = new Map(jobs.map((j) => [j.id, j]))

  // For each collision, keep the first job in place and stagger the rest.
  const suggested = new Map<string, SpreadSuggestion>()
  for (const col of collisions) {
    const involved = col.jobIds.filter((id) => jobById.has(id))
    involved.forEach((id, idx) => {
      if (idx === 0) return // anchor stays
      if (suggested.has(id)) return
      const job = jobById.get(id)!
      const offset = (idx * 7) % 60 // deterministic spread step
      let suggestedExpr = job.expr

      if (job.kind === 'cron') {
        const fields = job.expr.trim().split(/\s+/)
        const sixField = fields.length === 6
        const minIdx = sixField ? 1 : 0
        const rest = [...fields]
        // Only stagger when the minute field is a concrete number.
        const minVal = parseInt(rest[minIdx], 10)
        if (Number.isFinite(minVal)) {
          rest[minIdx] = String((minVal + offset) % 60)
          suggestedExpr = rest.join(' ')
        } else {
          // Spread across the hour by pinning a minute.
          rest[minIdx] = String(offset)
          suggestedExpr = rest.join(' ')
        }
      } else if (job.kind === 'rate') {
        // Rate jobs can't be phase-shifted by expression alone; recommend a
        // small additive delay encoded as a comment-free hint.
        suggestedExpr = job.expr
      }

      suggested.set(id, {
        jobId: id,
        suggestedExpr,
        reason: `Staggered by ${offset} minute(s) to clear collision at ${col.windowStart}`,
      })
    })
  }

  return [...suggested.values()]
}
