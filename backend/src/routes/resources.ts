import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  resources,
  workspace_members,
  idle_windows,
  cost_records,
  environments,
  teams,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  workspace_id: z.string().min(1),
  cloud_account_id: z.string().optional(),
  environment_id: z.string().optional(),
  team_id: z.string().optional(),
  external_id: z.string().min(1),
  name: z.string().min(1),
  resource_type: z.string().min(1),
  service: z.string().optional(),
  region: z.string().optional(),
  provider: z.string().optional(),
  env_kind: z.string().optional(),
  classification_source: z.string().optional(),
  classification_confidence: z.number().min(0).max(1).optional(),
  tags: z.record(z.string(), z.string()).optional(),
  monthly_cost_cents: z.number().int().nonnegative().optional(),
  hourly_rate_cents: z.number().nonnegative().optional(),
  is_active: z.boolean().optional(),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  resource_type: z.string().min(1).optional(),
  service: z.string().optional(),
  region: z.string().optional(),
  provider: z.string().optional(),
  cloud_account_id: z.string().nullable().optional(),
  env_kind: z.string().optional(),
  tags: z.record(z.string(), z.string()).optional(),
  monthly_cost_cents: z.number().int().nonnegative().optional(),
  hourly_rate_cents: z.number().nonnegative().optional(),
  is_active: z.boolean().optional(),
})

const assignSchema = z
  .object({
    environment_id: z.string().nullable().optional(),
    team_id: z.string().nullable().optional(),
    env_kind: z.string().optional(),
  })
  .refine(
    (b) => b.environment_id !== undefined || b.team_id !== undefined || b.env_kind !== undefined,
    { message: 'At least one of environment_id, team_id, env_kind is required' },
  )

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

// GET / — public — list/filter by workspace_id, env_kind, environment_id, team_id
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const envKind = c.req.query('env_kind')
  const environmentId = c.req.query('environment_id')
  const teamId = c.req.query('team_id')

  const conds = [eq(resources.workspace_id, workspaceId)]
  if (envKind) conds.push(eq(resources.env_kind, envKind))
  if (environmentId) conds.push(eq(resources.environment_id, environmentId))
  if (teamId) conds.push(eq(resources.team_id, teamId))

  const rows = await db
    .select()
    .from(resources)
    .where(and(...conds))
    .orderBy(desc(resources.monthly_cost_cents))
  return c.json(rows)
})

// POST / — auth — create resource --------------------------------------------
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const [r] = await db
    .insert(resources)
    .values({
      workspace_id: body.workspace_id,
      cloud_account_id: body.cloud_account_id ?? null,
      environment_id: body.environment_id ?? null,
      team_id: body.team_id ?? null,
      external_id: body.external_id,
      name: body.name,
      resource_type: body.resource_type,
      service: body.service ?? null,
      region: body.region ?? null,
      provider: body.provider ?? null,
      env_kind: body.env_kind ?? 'unknown',
      classification_source: body.classification_source ?? 'unclassified',
      classification_confidence: body.classification_confidence ?? 0,
      tags: body.tags ?? {},
      monthly_cost_cents: body.monthly_cost_cents ?? 0,
      hourly_rate_cents: body.hourly_rate_cents ?? 0,
      is_active: body.is_active ?? true,
    })
    .returning()
  return c.json(r, 201)
})

// GET /:id — public — detail with idle history + cost records ---------------
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [r] = await db.select().from(resources).where(eq(resources.id, id))
  if (!r) return c.json({ error: 'Not found' }, 404)

  const windows = await db
    .select()
    .from(idle_windows)
    .where(eq(idle_windows.resource_id, id))
    .orderBy(desc(idle_windows.start_at))

  const costs = await db
    .select()
    .from(cost_records)
    .where(eq(cost_records.resource_id, id))
    .orderBy(desc(cost_records.period))

  let environment = null
  if (r.environment_id) {
    const [e] = await db.select().from(environments).where(eq(environments.id, r.environment_id))
    environment = e ?? null
  }
  let team = null
  if (r.team_id) {
    const [t] = await db.select().from(teams).where(eq(teams.id, r.team_id))
    team = t ?? null
  }

  return c.json({ ...r, environment, team, idle_windows: windows, cost_records: costs })
})

// PUT /:id — auth — update resource ------------------------------------------
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [r] = await db.select().from(resources).where(eq(resources.id, id))
  if (!r) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(r.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const set: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined) set[k] = v
  }
  if (Object.keys(set).length === 0) return c.json(r)
  const [updated] = await db.update(resources).set(set).where(eq(resources.id, id)).returning()
  return c.json(updated)
})

// PATCH /:id/assign — auth — manual classification override ------------------
router.patch('/:id/assign', authMiddleware, zValidator('json', assignSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [r] = await db.select().from(resources).where(eq(resources.id, id))
  if (!r) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(r.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')

  // Validate that referenced environment/team belong to the same workspace.
  if (body.environment_id) {
    const [e] = await db.select().from(environments).where(eq(environments.id, body.environment_id))
    if (!e || e.workspace_id !== r.workspace_id) return c.json({ error: 'Invalid environment_id' }, 400)
  }
  if (body.team_id) {
    const [t] = await db.select().from(teams).where(eq(teams.id, body.team_id))
    if (!t || t.workspace_id !== r.workspace_id) return c.json({ error: 'Invalid team_id' }, 400)
  }

  const set: Record<string, unknown> = {
    classification_source: 'manual',
    classification_confidence: 1,
  }
  if (body.environment_id !== undefined) set.environment_id = body.environment_id
  if (body.team_id !== undefined) set.team_id = body.team_id
  if (body.env_kind !== undefined) {
    set.env_kind = body.env_kind
  } else if (body.environment_id) {
    // Inherit env_kind from the assigned environment when not explicitly set.
    const [e] = await db.select().from(environments).where(eq(environments.id, body.environment_id))
    if (e) set.env_kind = e.env_kind
  }

  const [updated] = await db.update(resources).set(set).where(eq(resources.id, id)).returning()
  return c.json(updated)
})

// DELETE /:id — auth — delete resource ---------------------------------------
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [r] = await db.select().from(resources).where(eq(resources.id, id))
  if (!r) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(r.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  // Remove dependent rows that FK to this resource.
  await db.delete(idle_windows).where(eq(idle_windows.resource_id, id))
  await db.delete(cost_records).where(eq(cost_records.resource_id, id))
  await db.delete(resources).where(eq(resources.id, id))
  return c.json({ success: true })
})

export default router
