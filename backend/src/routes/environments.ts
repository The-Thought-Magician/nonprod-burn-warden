import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  environments,
  resources,
  idle_windows,
  workspace_members,
  schedules,
  holiday_calendars,
  cost_records,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

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

const createSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  env_kind: z.string().min(1).optional().default('dev'),
  timezone: z.string().min(1).optional().default('UTC'),
  holiday_calendar_id: z.string().nullable().optional(),
  schedule_id: z.string().nullable().optional(),
  description: z.string().optional().default(''),
  is_production: z.boolean().optional().default(false),
  team_id: z.string().nullable().optional(),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  env_kind: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
  holiday_calendar_id: z.string().nullable().optional(),
  schedule_id: z.string().nullable().optional(),
  description: z.string().optional(),
  is_production: z.boolean().optional(),
  team_id: z.string().nullable().optional(),
})

// ---------------------------------------------------------------------------
// GET / — list by workspace_id with rollups
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const envs = await db
    .select()
    .from(environments)
    .where(eq(environments.workspace_id, workspaceId))
    .orderBy(desc(environments.created_at))

  if (envs.length === 0) return c.json([])

  const envIds = envs.map((e) => e.id)

  // resource counts + monthly cost per environment
  const res = await db
    .select()
    .from(resources)
    .where(inArray(resources.environment_id, envIds))

  // idle waste per environment
  const idle = await db
    .select()
    .from(idle_windows)
    .where(inArray(idle_windows.environment_id, envIds))

  const result = envs.map((e) => {
    const er = res.filter((r) => r.environment_id === e.id)
    const ei = idle.filter((w) => w.environment_id === e.id)
    return {
      ...e,
      resource_count: er.length,
      monthly_cost_cents: er.reduce((s, r) => s + (r.monthly_cost_cents ?? 0), 0),
      idle_waste_cents: ei.reduce((s, w) => s + (w.wasted_cents ?? 0), 0),
    }
  })

  return c.json(result)
})

// ---------------------------------------------------------------------------
// POST / — create environment
// ---------------------------------------------------------------------------

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [env] = await db
    .insert(environments)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      env_kind: body.env_kind,
      timezone: body.timezone,
      holiday_calendar_id: body.holiday_calendar_id ?? null,
      schedule_id: body.schedule_id ?? null,
      description: body.description ?? '',
      is_production: body.is_production ?? false,
      team_id: body.team_id ?? null,
      created_by: userId,
    })
    .returning()

  return c.json(env, 201)
})

// ---------------------------------------------------------------------------
// GET /:id — detail with stats (rollups, schedule, timezone, calendar)
// ---------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [env] = await db.select().from(environments).where(eq(environments.id, id))
  if (!env) return c.json({ error: 'Not found' }, 404)

  const envResources = await db.select().from(resources).where(eq(resources.environment_id, id))
  const envIdle = await db.select().from(idle_windows).where(eq(idle_windows.environment_id, id))

  let schedule = null
  if (env.schedule_id) {
    const [s] = await db.select().from(schedules).where(eq(schedules.id, env.schedule_id))
    schedule = s ?? null
  }

  let calendar = null
  if (env.holiday_calendar_id) {
    const [cal] = await db
      .select()
      .from(holiday_calendars)
      .where(eq(holiday_calendars.id, env.holiday_calendar_id))
    calendar = cal ?? null
  }

  // current-month cost from cost_records joined via resources
  const resourceIds = envResources.map((r) => r.id)
  let costRecordsTotal = 0
  if (resourceIds.length > 0) {
    const cr = await db.select().from(cost_records).where(inArray(cost_records.resource_id, resourceIds))
    costRecordsTotal = cr.reduce((s, r) => s + (r.amount_cents ?? 0), 0)
  }

  const monthlyCostCents = envResources.reduce((s, r) => s + (r.monthly_cost_cents ?? 0), 0)
  const idleWasteCents = envIdle.reduce((s, w) => s + (w.wasted_cents ?? 0), 0)
  const offHoursIdleHours = envIdle
    .filter((w) => w.is_off_hours)
    .reduce((s, w) => s + (w.duration_hours ?? 0), 0)
  const idleHours = envIdle.reduce((s, w) => s + (w.duration_hours ?? 0), 0)

  return c.json({
    ...env,
    schedule,
    calendar,
    stats: {
      resource_count: envResources.length,
      active_resource_count: envResources.filter((r) => r.is_active).length,
      monthly_cost_cents: monthlyCostCents,
      recorded_cost_cents: costRecordsTotal,
      idle_waste_cents: idleWasteCents,
      idle_hours: idleHours,
      off_hours_idle_hours: offHoursIdleHours,
      idle_window_count: envIdle.length,
    },
  })
})

// ---------------------------------------------------------------------------
// PUT /:id — update
// ---------------------------------------------------------------------------

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(environments).where(eq(environments.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = { updated_at: new Date() }
  if (body.name !== undefined) patch.name = body.name
  if (body.env_kind !== undefined) patch.env_kind = body.env_kind
  if (body.timezone !== undefined) patch.timezone = body.timezone
  if (body.holiday_calendar_id !== undefined) patch.holiday_calendar_id = body.holiday_calendar_id
  if (body.schedule_id !== undefined) patch.schedule_id = body.schedule_id
  if (body.description !== undefined) patch.description = body.description
  if (body.is_production !== undefined) patch.is_production = body.is_production
  if (body.team_id !== undefined) patch.team_id = body.team_id

  const [updated] = await db.update(environments).set(patch).where(eq(environments.id, id)).returning()
  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /:id
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(environments).where(eq(environments.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  // detach resources pointing at this environment to satisfy FK constraints
  await db.update(resources).set({ environment_id: null }).where(eq(resources.environment_id, id))
  await db.update(idle_windows).set({ environment_id: null }).where(eq(idle_windows.environment_id, id))
  await db.delete(environments).where(eq(environments.id, id))
  return c.json({ success: true })
})

export default router
