import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  schedules,
  schedule_assignments,
  environments,
  resources,
  workspace_members,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
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

type Window = { day: number; start_hour: number; end_hour: number }

// Effective running hours per week implied by the windows (a window means the
// environment is "on" during it). Overlapping/duplicate hours are de-duped per
// day so the result never exceeds 168.
function computeEffectiveHours(windows: Window[]): number {
  // Interval union per day so overlapping windows never double-count.
  let total = 0
  const perDay: Array<Array<[number, number]>> = Array.from({ length: 7 }, () => [])
  for (const w of windows) {
    const day = ((Math.floor(w.day) % 7) + 7) % 7
    const start = Math.max(0, Math.min(24, w.start_hour))
    const end = Math.max(0, Math.min(24, w.end_hour))
    if (end <= start) continue
    perDay[day].push([start, end])
  }
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

const windowSchema = z.object({
  day: z.number().int().min(0).max(6),
  start_hour: z.number().min(0).max(24),
  end_hour: z.number().min(0).max(24),
})

const createSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().default(''),
  windows: z.array(windowSchema).optional().default([]),
  treat_holidays_off: z.boolean().optional().default(true),
  is_preset: z.boolean().optional().default(false),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  windows: z.array(windowSchema).optional(),
  treat_holidays_off: z.boolean().optional(),
})

// ---------------------------------------------------------------------------
// GET / — public — list by workspace_id (presets + custom)
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(schedules)
    .where(eq(schedules.workspace_id, workspaceId))
    .orderBy(desc(schedules.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST / — auth — create schedule (windows)
// ---------------------------------------------------------------------------

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const effective = computeEffectiveHours(body.windows)
  const [created] = await db
    .insert(schedules)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      description: body.description,
      windows: body.windows,
      treat_holidays_off: body.treat_holidays_off,
      is_preset: body.is_preset,
      effective_hours_per_week: effective,
      created_by: userId,
    })
    .returning()
  return c.json(created, 201)
})

// ---------------------------------------------------------------------------
// DELETE /assignments/:assignmentId — auth — unassign
//   (declared BEFORE /:id so the literal segment is not captured as :id)
// ---------------------------------------------------------------------------

router.delete('/assignments/:assignmentId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('assignmentId')
  const [existing] = await db.select().from(schedule_assignments).where(eq(schedule_assignments.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(schedule_assignments).where(eq(schedule_assignments.id, id))
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// GET /:id — public — schedule detail + assignments
// ---------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [s] = await db.select().from(schedules).where(eq(schedules.id, id))
  if (!s) return c.json({ error: 'Not found' }, 404)
  const assignments = await db
    .select()
    .from(schedule_assignments)
    .where(eq(schedule_assignments.schedule_id, id))
    .orderBy(desc(schedule_assignments.created_at))
  return c.json({ ...s, assignments })
})

// ---------------------------------------------------------------------------
// PUT /:id — auth — update windows/name (recomputes effective_hours_per_week)
// ---------------------------------------------------------------------------

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(schedules).where(eq(schedules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = { updated_at: new Date() }
  if (body.name !== undefined) patch.name = body.name
  if (body.description !== undefined) patch.description = body.description
  if (body.treat_holidays_off !== undefined) patch.treat_holidays_off = body.treat_holidays_off
  if (body.windows !== undefined) {
    patch.windows = body.windows
    patch.effective_hours_per_week = computeEffectiveHours(body.windows)
  }

  const [updated] = await db.update(schedules).set(patch).where(eq(schedules.id, id)).returning()
  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /:id — auth — delete schedule (+ its assignments)
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(schedules).where(eq(schedules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(schedule_assignments).where(eq(schedule_assignments.schedule_id, id))
  await db.delete(schedules).where(eq(schedules.id, id))
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// POST /:id/assign — auth — assign to environment_id or resource_id
// ---------------------------------------------------------------------------

const assignSchema = z
  .object({
    environment_id: z.string().min(1).optional(),
    resource_id: z.string().min(1).optional(),
  })
  .refine((b) => !!b.environment_id || !!b.resource_id, {
    message: 'environment_id or resource_id is required',
  })

router.post('/:id/assign', authMiddleware, zValidator('json', assignSchema), async (c) => {
  const userId = getUserId(c)
  const scheduleId = c.req.param('id')
  const body = c.req.valid('json')

  const [schedule] = await db.select().from(schedules).where(eq(schedules.id, scheduleId))
  if (!schedule) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(schedule.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  // Validate the target belongs to the same workspace.
  if (body.environment_id) {
    const [env] = await db.select().from(environments).where(eq(environments.id, body.environment_id))
    if (!env || env.workspace_id !== schedule.workspace_id) {
      return c.json({ error: 'environment not in workspace' }, 400)
    }
  }
  if (body.resource_id) {
    const [res] = await db.select().from(resources).where(eq(resources.id, body.resource_id))
    if (!res || res.workspace_id !== schedule.workspace_id) {
      return c.json({ error: 'resource not in workspace' }, 400)
    }
  }

  const [assignment] = await db
    .insert(schedule_assignments)
    .values({
      workspace_id: schedule.workspace_id,
      schedule_id: scheduleId,
      environment_id: body.environment_id ?? null,
      resource_id: body.resource_id ?? null,
      created_by: userId,
    })
    .returning()

  // Convenience: when assigning to an environment, point the env at this schedule.
  if (body.environment_id) {
    await db
      .update(environments)
      .set({ schedule_id: scheduleId, updated_at: new Date() })
      .where(eq(environments.id, body.environment_id))
  }

  return c.json(assignment, 201)
})

export default router
