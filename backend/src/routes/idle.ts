import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  idle_windows,
  usage_samples,
  resources,
  environments,
  schedules,
  workspace_members,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const HOUR_MS = 3_600_000

interface ScheduleWindow {
  day: number // 0=Sun..6=Sat
  start_hour: number
  end_hour: number
}

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

// Is the given instant inside any business-hours window of the schedule?
// If no windows are defined, treat the whole week as business hours (always on).
function isBusinessHours(date: Date, windows: ScheduleWindow[]): boolean {
  if (!windows || windows.length === 0) return true
  const day = date.getUTCDay()
  const hour = date.getUTCHours()
  for (const w of windows) {
    if (w.day !== day) continue
    if (hour >= w.start_hour && hour < w.end_hour) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// GET / — public — idle_windows by workspace_id/environment_id/resource_id
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const environmentId = c.req.query('environment_id')
  const resourceId = c.req.query('resource_id')

  if (!workspaceId && !environmentId && !resourceId) {
    return c.json({ error: 'workspace_id, environment_id, or resource_id is required' }, 400)
  }

  const conds = []
  if (workspaceId) conds.push(eq(idle_windows.workspace_id, workspaceId))
  if (environmentId) conds.push(eq(idle_windows.environment_id, environmentId))
  if (resourceId) conds.push(eq(idle_windows.resource_id, resourceId))

  const rows = await db
    .select()
    .from(idle_windows)
    .where(and(...conds))
    .orderBy(desc(idle_windows.start_at))

  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST /detect — auth — run idle detection over usage_samples (threshold)
// ---------------------------------------------------------------------------

const detectSchema = z.object({
  workspace_id: z.string().min(1),
  threshold: z.number().nonnegative().optional().default(5),
  metric: z.string().min(1).optional().default('cpu'),
  environment_id: z.string().optional(),
  resource_id: z.string().optional(),
  replace: z.boolean().optional().default(true),
})

router.post('/detect', authMiddleware, zValidator('json', detectSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, threshold, metric, environment_id, resource_id, replace } = c.req.valid('json')

  if (!(await isMember(workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  // Resolve target resources.
  const resConds = [eq(resources.workspace_id, workspace_id)]
  if (environment_id) resConds.push(eq(resources.environment_id, environment_id))
  if (resource_id) resConds.push(eq(resources.id, resource_id))
  const targetResources = await db.select().from(resources).where(and(...resConds))

  // Cache environment schedule windows for off-hours classification.
  const envIds = [...new Set(targetResources.map((r) => r.environment_id).filter((x): x is string => !!x))]
  const envSchedule = new Map<string, ScheduleWindow[]>()
  for (const envId of envIds) {
    const [env] = await db.select().from(environments).where(eq(environments.id, envId))
    if (env?.schedule_id) {
      const [sched] = await db.select().from(schedules).where(eq(schedules.id, env.schedule_id))
      envSchedule.set(envId, (sched?.windows as ScheduleWindow[] | undefined) ?? [])
    } else {
      envSchedule.set(envId, [])
    }
  }

  let windowsCreated = 0
  let offHoursHours = 0
  let businessHoursHours = 0
  const createdRows: typeof idle_windows.$inferInsert[] = []

  for (const r of targetResources) {
    if (replace) {
      await db.delete(idle_windows).where(eq(idle_windows.resource_id, r.id))
    }

    const samples = await db
      .select()
      .from(usage_samples)
      .where(and(eq(usage_samples.resource_id, r.id), eq(usage_samples.metric, metric)))
      .orderBy(usage_samples.sampled_at)

    if (samples.length < 2) continue

    const windows = r.environment_id ? envSchedule.get(r.environment_id) ?? [] : []
    const hourlyRate = r.hourly_rate_cents && r.hourly_rate_cents > 0 ? r.hourly_rate_cents : 0

    // Walk samples; group contiguous below-threshold samples into idle windows.
    let runStartIdx = -1
    const flush = (startIdx: number, endIdx: number) => {
      const startAt = samples[startIdx].sampled_at instanceof Date
        ? (samples[startIdx].sampled_at as Date)
        : new Date(String(samples[startIdx].sampled_at))
      const endAt = samples[endIdx].sampled_at instanceof Date
        ? (samples[endIdx].sampled_at as Date)
        : new Date(String(samples[endIdx].sampled_at))
      const durationHours = Math.max(0, (endAt.getTime() - startAt.getTime()) / HOUR_MS)
      if (durationHours <= 0) return

      // Off-hours if the midpoint falls outside the environment's business hours.
      const midpoint = new Date((startAt.getTime() + endAt.getTime()) / 2)
      const offHours = !isBusinessHours(midpoint, windows)
      const wastedCents = Math.round(durationHours * hourlyRate)

      createdRows.push({
        workspace_id,
        resource_id: r.id,
        environment_id: r.environment_id ?? null,
        start_at: startAt,
        end_at: endAt,
        duration_hours: durationHours,
        is_off_hours: offHours,
        wasted_cents: wastedCents,
      })
      windowsCreated += 1
      if (offHours) offHoursHours += durationHours
      else businessHoursHours += durationHours
    }

    for (let i = 0; i < samples.length; i++) {
      const idle = samples[i].value <= threshold
      if (idle) {
        if (runStartIdx === -1) runStartIdx = i
      } else {
        if (runStartIdx !== -1 && i - 1 > runStartIdx) {
          flush(runStartIdx, i - 1)
        }
        runStartIdx = -1
      }
    }
    if (runStartIdx !== -1 && samples.length - 1 > runStartIdx) {
      flush(runStartIdx, samples.length - 1)
    }
  }

  if (createdRows.length > 0) {
    await db.insert(idle_windows).values(createdRows)
  }

  return c.json({
    windows_created: windowsCreated,
    off_hours_hours: offHoursHours,
    business_hours_hours: businessHoursHours,
  })
})

// ---------------------------------------------------------------------------
// GET /summary — public — per-environment idle-hours-per-week
// ---------------------------------------------------------------------------

router.get('/summary', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const envs = await db
    .select()
    .from(environments)
    .where(eq(environments.workspace_id, workspaceId))

  const windows = await db
    .select()
    .from(idle_windows)
    .where(eq(idle_windows.workspace_id, workspaceId))

  // Aggregate idle hours per environment, and track the observation span so we
  // can normalize to a per-week figure.
  const agg = new Map<string, { total: number; offHours: number; minT: number; maxT: number }>()
  for (const w of windows) {
    if (!w.environment_id) continue
    const a = agg.get(w.environment_id) ?? {
      total: 0,
      offHours: 0,
      minT: Number.POSITIVE_INFINITY,
      maxT: Number.NEGATIVE_INFINITY,
    }
    a.total += w.duration_hours
    if (w.is_off_hours) a.offHours += w.duration_hours
    const startT = w.start_at instanceof Date ? w.start_at.getTime() : Date.parse(String(w.start_at))
    const endT = w.end_at instanceof Date ? w.end_at.getTime() : Date.parse(String(w.end_at))
    if (Number.isFinite(startT)) a.minT = Math.min(a.minT, startT)
    if (Number.isFinite(endT)) a.maxT = Math.max(a.maxT, endT)
    agg.set(w.environment_id, a)
  }

  const out = envs.map((env) => {
    const a = agg.get(env.id)
    if (!a || a.total === 0) {
      return {
        environment_id: env.id,
        name: env.name,
        idle_hours_per_week: 0,
        off_hours_pct: 0,
      }
    }
    const spanMs = a.maxT > a.minT ? a.maxT - a.minT : HOUR_MS
    const spanWeeks = Math.max(spanMs / (7 * 24 * HOUR_MS), 1 / 7)
    return {
      environment_id: env.id,
      name: env.name,
      idle_hours_per_week: a.total / spanWeeks,
      off_hours_pct: a.total > 0 ? (a.offHours / a.total) * 100 : 0,
    }
  })

  return c.json(out)
})

// ---------------------------------------------------------------------------
// GET /heatmap — public — hour-of-week idle grid by environment_id
// ---------------------------------------------------------------------------

router.get('/heatmap', async (c) => {
  const environmentId = c.req.query('environment_id')
  if (!environmentId) return c.json({ error: 'environment_id is required' }, 400)

  const windows = await db
    .select()
    .from(idle_windows)
    .where(eq(idle_windows.environment_id, environmentId))

  // grid[day 0..6][hour 0..23] = accumulated idle hours falling in that
  // hour-of-week slot.
  const grid: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0))

  for (const w of windows) {
    const startT = w.start_at instanceof Date ? w.start_at.getTime() : Date.parse(String(w.start_at))
    const endT = w.end_at instanceof Date ? w.end_at.getTime() : Date.parse(String(w.end_at))
    if (!Number.isFinite(startT) || !Number.isFinite(endT) || endT <= startT) continue

    // Distribute the window across the hourly slots it spans (cap iterations
    // to avoid runaway on pathological inputs).
    let cursor = startT
    let guard = 0
    while (cursor < endT && guard < 24 * 366) {
      const d = new Date(cursor)
      const slotStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours())
      const slotEnd = slotStart + HOUR_MS
      const portionEnd = Math.min(endT, slotEnd)
      const hours = (portionEnd - cursor) / HOUR_MS
      const day = d.getUTCDay()
      const hour = d.getUTCHours()
      grid[day][hour] += hours
      cursor = portionEnd
      guard += 1
    }
  }

  return c.json({ grid })
})

export default router
