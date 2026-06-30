import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  teams,
  resources,
  environments,
  waste_ledger_entries,
  workspace_members,
  activity_log,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

// ---------------------------------------------------------------------------
// GET / — public — list by workspace_id (+ spend rollup)
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const teamRows = await db
    .select()
    .from(teams)
    .where(eq(teams.workspace_id, workspaceId))
    .orderBy(desc(teams.created_at))

  const resourceRows = await db
    .select()
    .from(resources)
    .where(eq(resources.workspace_id, workspaceId))

  const spendByTeam = new Map<string, number>()
  const countByTeam = new Map<string, number>()
  for (const r of resourceRows) {
    if (!r.team_id) continue
    spendByTeam.set(r.team_id, (spendByTeam.get(r.team_id) ?? 0) + (r.monthly_cost_cents ?? 0))
    countByTeam.set(r.team_id, (countByTeam.get(r.team_id) ?? 0) + 1)
  }

  const out = teamRows.map((t) => ({
    ...t,
    monthly_spend_cents: spendByTeam.get(t.id) ?? 0,
    resource_count: countByTeam.get(t.id) ?? 0,
  }))
  return c.json(out)
})

// ---------------------------------------------------------------------------
// POST / — auth — create team
// ---------------------------------------------------------------------------
const createSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  lead_email: z.string().email().optional().nullable(),
})

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, name, lead_email } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [existing] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.workspace_id, workspace_id), eq(teams.name, name)))
  if (existing) return c.json({ error: 'A team with that name already exists' }, 409)

  const [team] = await db
    .insert(teams)
    .values({ workspace_id, name, lead_email: lead_email ?? null, created_by: userId })
    .returning()

  await db.insert(activity_log).values({
    workspace_id,
    actor_id: userId,
    action: 'teams.create',
    entity_type: 'team',
    entity_id: team.id,
    detail: { name },
  })

  return c.json(team, 201)
})

// ---------------------------------------------------------------------------
// GET /:id — public — team detail (environments, resources, spend)
// ---------------------------------------------------------------------------
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [team] = await db.select().from(teams).where(eq(teams.id, id))
  if (!team) return c.json({ error: 'Not found' }, 404)

  const teamResources = await db
    .select()
    .from(resources)
    .where(and(eq(resources.workspace_id, team.workspace_id), eq(resources.team_id, id)))

  const teamEnvironments = await db
    .select()
    .from(environments)
    .where(and(eq(environments.workspace_id, team.workspace_id), eq(environments.team_id, id)))

  const ledgerRows = await db
    .select()
    .from(waste_ledger_entries)
    .where(and(eq(waste_ledger_entries.workspace_id, team.workspace_id), eq(waste_ledger_entries.team_id, id)))

  const monthlySpendCents = teamResources.reduce((s, r) => s + (r.monthly_cost_cents ?? 0), 0)
  const wastedCents = ledgerRows.reduce((s, e) => s + (e.wasted_cents ?? 0), 0)

  return c.json({
    ...team,
    environments: teamEnvironments,
    resources: teamResources,
    stats: {
      resource_count: teamResources.length,
      environment_count: teamEnvironments.length,
      monthly_spend_cents: monthlySpendCents,
      wasted_cents: wastedCents,
    },
  })
})

// ---------------------------------------------------------------------------
// PUT /:id — auth — update name/lead_email
// ---------------------------------------------------------------------------
const updateSchema = z.object({
  name: z.string().min(1).optional(),
  lead_email: z.string().email().optional().nullable(),
})

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [existing] = await db.select().from(teams).where(eq(teams.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  if (body.name && body.name !== existing.name) {
    const [clash] = await db
      .select()
      .from(teams)
      .where(and(eq(teams.workspace_id, existing.workspace_id), eq(teams.name, body.name)))
    if (clash) return c.json({ error: 'A team with that name already exists' }, 409)
  }

  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.lead_email !== undefined) patch.lead_email = body.lead_email

  const [updated] = await db.update(teams).set(patch).where(eq(teams.id, id)).returning()

  await db.insert(activity_log).values({
    workspace_id: existing.workspace_id,
    actor_id: userId,
    action: 'teams.update',
    entity_type: 'team',
    entity_id: id,
    detail: patch,
  })

  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /:id — auth — delete team (detaches resources/environments first)
// ---------------------------------------------------------------------------
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db.select().from(teams).where(eq(teams.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  // Detach FK references so the delete does not violate constraints.
  await db.update(resources).set({ team_id: null }).where(eq(resources.team_id, id))
  await db.update(environments).set({ team_id: null }).where(eq(environments.team_id, id))
  await db.update(waste_ledger_entries).set({ team_id: null }).where(eq(waste_ledger_entries.team_id, id))

  await db.delete(teams).where(eq(teams.id, id))

  await db.insert(activity_log).values({
    workspace_id: existing.workspace_id,
    actor_id: userId,
    action: 'teams.delete',
    entity_type: 'team',
    entity_id: id,
    detail: { name: existing.name },
  })

  return c.json({ success: true })
})

export default router
