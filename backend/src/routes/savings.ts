import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  savings_estimates,
  schedules,
  environments,
  resources,
  workspace_members,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const HOURS_PER_WEEK = 168

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

type Window = { day: number; start_hour: number; end_hour: number }

// Hours/week the environment would run under these windows (interval union per day).
function effectiveHoursPerWeek(windows: Window[]): number {
  const perDay: Array<Array<[number, number]>> = Array.from({ length: 7 }, () => [])
  for (const w of windows) {
    const day = ((Math.floor(w.day) % 7) + 7) % 7
    const start = Math.max(0, Math.min(24, w.start_hour))
    const end = Math.max(0, Math.min(24, w.end_hour))
    if (end <= start) continue
    perDay[day].push([start, end])
  }
  let total = 0
  for (const intervals of perDay) {
    intervals.sort((a, b) => a[0] - b[0])
    let curStart = -1
    let curEnd = -1
    for (const [s, e] of intervals) {
      if (s > curEnd) {
        if (curEnd > curStart) total += curEnd - curStart
        curStart = s
        curEnd = e
      } else {
        curEnd = Math.max(curEnd, e)
      }
    }
    if (curEnd > curStart) total += curEnd - curStart
  }
  return Math.round(total * 100) / 100
}

// Current monthly spend for an environment = sum of its resources' monthly_cost_cents.
async function envMonthlySpend(workspaceId: string, environmentId: string): Promise<number> {
  const resRows = await db
    .select()
    .from(resources)
    .where(and(eq(resources.workspace_id, workspaceId), eq(resources.environment_id, environmentId)))
  return resRows.reduce((sum, r) => sum + (r.monthly_cost_cents ?? 0), 0)
}

// Savings from running `runningHours/week` instead of 24x7 (168h/week).
function computeSavings(currentMonthlyCents: number, runningHoursPerWeek: number) {
  const running = Math.max(0, Math.min(HOURS_PER_WEEK, runningHoursPerWeek))
  const hoursSavedPerWeek = HOURS_PER_WEEK - running
  const savingsPct = hoursSavedPerWeek / HOURS_PER_WEEK
  const monthlySavingsCents = Math.round(currentMonthlyCents * savingsPct)
  return {
    hours_saved_per_week: Math.round(hoursSavedPerWeek * 100) / 100,
    savings_pct: Math.round(savingsPct * 10000) / 10000,
    monthly_savings_cents: monthlySavingsCents,
  }
}

// ---------------------------------------------------------------------------
// GET / — public — savings_estimates by workspace_id/environment_id
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const environmentId = c.req.query('environment_id')

  const conds = [eq(savings_estimates.workspace_id, workspaceId)]
  if (environmentId) conds.push(eq(savings_estimates.environment_id, environmentId))

  const rows = await db
    .select()
    .from(savings_estimates)
    .where(and(...conds))
    .orderBy(desc(savings_estimates.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST /calculate — auth — compute savings for environment_id + candidate windows
//   (what-if), persists estimate
// ---------------------------------------------------------------------------

const windowSchema = z.object({
  day: z.number().int().min(0).max(6),
  start_hour: z.number().min(0).max(24),
  end_hour: z.number().min(0).max(24),
})

const calculateSchema = z
  .object({
    workspace_id: z.string().min(1),
    environment_id: z.string().min(1),
    windows: z.array(windowSchema).optional(),
    schedule_id: z.string().min(1).optional(),
  })
  .refine((b) => !!b.windows || !!b.schedule_id, {
    message: 'windows or schedule_id is required',
  })

router.post('/calculate', authMiddleware, zValidator('json', calculateSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [env] = await db.select().from(environments).where(eq(environments.id, body.environment_id))
  if (!env || env.workspace_id !== body.workspace_id) {
    return c.json({ error: 'environment not in workspace' }, 400)
  }

  let windows: Window[] = body.windows ?? []
  let scheduleId: string | null = body.schedule_id ?? null
  if (!body.windows && body.schedule_id) {
    const [sched] = await db.select().from(schedules).where(eq(schedules.id, body.schedule_id))
    if (!sched || sched.workspace_id !== body.workspace_id) {
      return c.json({ error: 'schedule not in workspace' }, 400)
    }
    windows = (sched.windows ?? []) as Window[]
  }

  const runningHours = effectiveHoursPerWeek(windows)
  const currentMonthly = await envMonthlySpend(body.workspace_id, body.environment_id)
  const calc = computeSavings(currentMonthly, runningHours)

  const [estimate] = await db
    .insert(savings_estimates)
    .values({
      workspace_id: body.workspace_id,
      environment_id: body.environment_id,
      schedule_id: scheduleId,
      hours_saved_per_week: calc.hours_saved_per_week,
      monthly_savings_cents: calc.monthly_savings_cents,
      savings_pct: calc.savings_pct,
      current_monthly_cents: currentMonthly,
      created_by: userId,
    })
    .returning()

  return c.json(estimate)
})

// ---------------------------------------------------------------------------
// POST /compare — auth — compare multiple schedules for an environment
// ---------------------------------------------------------------------------

const compareSchema = z.object({
  workspace_id: z.string().min(1),
  environment_id: z.string().min(1),
  schedule_ids: z.array(z.string().min(1)).min(1),
})

router.post('/compare', authMiddleware, zValidator('json', compareSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [env] = await db.select().from(environments).where(eq(environments.id, body.environment_id))
  if (!env || env.workspace_id !== body.workspace_id) {
    return c.json({ error: 'environment not in workspace' }, 400)
  }

  const currentMonthly = await envMonthlySpend(body.workspace_id, body.environment_id)

  const options: Array<{
    schedule_id: string
    name: string | null
    effective_hours_per_week: number
    monthly_savings_cents: number
    savings_pct: number
  }> = []

  for (const sid of body.schedule_ids) {
    const [sched] = await db.select().from(schedules).where(eq(schedules.id, sid))
    if (!sched || sched.workspace_id !== body.workspace_id) continue
    const runningHours = effectiveHoursPerWeek((sched.windows ?? []) as Window[])
    const calc = computeSavings(currentMonthly, runningHours)
    options.push({
      schedule_id: sid,
      name: sched.name,
      effective_hours_per_week: runningHours,
      monthly_savings_cents: calc.monthly_savings_cents,
      savings_pct: calc.savings_pct,
    })
  }

  options.sort((a, b) => b.monthly_savings_cents - a.monthly_savings_cents)

  return c.json({ environment_id: body.environment_id, current_monthly_cents: currentMonthly, options })
})

// ---------------------------------------------------------------------------
// GET /potential — public — org-wide aggregate recoverable potential
// ---------------------------------------------------------------------------

router.get('/potential', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const envs = await db.select().from(environments).where(eq(environments.workspace_id, workspaceId))
  const resRows = await db.select().from(resources).where(eq(resources.workspace_id, workspaceId))

  // Spend per environment.
  const spendByEnv = new Map<string, number>()
  for (const r of resRows) {
    if (!r.environment_id) continue
    spendByEnv.set(r.environment_id, (spendByEnv.get(r.environment_id) ?? 0) + (r.monthly_cost_cents ?? 0))
  }

  // For each non-production env, recoverable = spend × (1 − effective_hours/168)
  // using the env's assigned schedule if any; default to a business-hours
  // assumption (5×10h = 50h/week) when no schedule is assigned.
  const DEFAULT_RUNNING = 50

  let totalRecoverable = 0
  const byEnvironment: Array<{
    environment_id: string
    name: string
    recoverable_cents: number
    current_monthly_cents: number
  }> = []

  for (const env of envs) {
    if (env.is_production) continue
    const spend = spendByEnv.get(env.id) ?? 0
    if (spend <= 0) continue

    let runningHours = DEFAULT_RUNNING
    if (env.schedule_id) {
      const [sched] = await db.select().from(schedules).where(eq(schedules.id, env.schedule_id))
      if (sched) runningHours = effectiveHoursPerWeek((sched.windows ?? []) as Window[])
    }
    const calc = computeSavings(spend, runningHours)
    totalRecoverable += calc.monthly_savings_cents
    byEnvironment.push({
      environment_id: env.id,
      name: env.name,
      recoverable_cents: calc.monthly_savings_cents,
      current_monthly_cents: spend,
    })
  }

  byEnvironment.sort((a, b) => b.recoverable_cents - a.recoverable_cents)

  return c.json({ total_recoverable_cents: totalRecoverable, by_environment: byEnvironment })
})

export default router
