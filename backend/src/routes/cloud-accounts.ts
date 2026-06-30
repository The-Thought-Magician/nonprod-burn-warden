import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { cloud_accounts, workspace_members, resources, environments } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  workspace_id: z.string().min(1),
  provider: z.string().min(1),
  account_ref: z.string().min(1),
  nickname: z.string().min(1),
  default_region: z.string().optional(),
})

const updateSchema = z.object({
  nickname: z.string().min(1).optional(),
  default_region: z.string().optional(),
})

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

// GET / — public — list accounts by workspace_id with rollups ----------------
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const accounts = await db
    .select()
    .from(cloud_accounts)
    .where(eq(cloud_accounts.workspace_id, workspaceId))
    .orderBy(desc(cloud_accounts.created_at))

  const accountResources = await db
    .select({
      cloud_account_id: resources.cloud_account_id,
      monthly_cost_cents: resources.monthly_cost_cents,
    })
    .from(resources)
    .where(eq(resources.workspace_id, workspaceId))

  const rollup = new Map<string, { resource_count: number; monthly_cost_cents: number }>()
  for (const r of accountResources) {
    if (!r.cloud_account_id) continue
    const agg = rollup.get(r.cloud_account_id) ?? { resource_count: 0, monthly_cost_cents: 0 }
    agg.resource_count += 1
    agg.monthly_cost_cents += r.monthly_cost_cents ?? 0
    rollup.set(r.cloud_account_id, agg)
  }

  const out = accounts.map((a) => {
    const agg = rollup.get(a.id) ?? { resource_count: 0, monthly_cost_cents: 0 }
    return { ...a, resource_count: agg.resource_count, monthly_cost_cents: agg.monthly_cost_cents }
  })
  return c.json(out)
})

// POST / — auth — create account ---------------------------------------------
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const [account] = await db
    .insert(cloud_accounts)
    .values({
      workspace_id: body.workspace_id,
      provider: body.provider,
      account_ref: body.account_ref,
      nickname: body.nickname,
      default_region: body.default_region ?? null,
      created_by: userId,
    })
    .returning()
  return c.json(account, 201)
})

// GET /:id — public — account detail + env breakdown ------------------------
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [account] = await db.select().from(cloud_accounts).where(eq(cloud_accounts.id, id))
  if (!account) return c.json({ error: 'Not found' }, 404)

  const accountResources = await db
    .select({
      environment_id: resources.environment_id,
      env_kind: resources.env_kind,
      monthly_cost_cents: resources.monthly_cost_cents,
    })
    .from(resources)
    .where(eq(resources.cloud_account_id, id))

  const envRows = await db
    .select()
    .from(environments)
    .where(eq(environments.workspace_id, account.workspace_id))
  const envName = new Map(envRows.map((e) => [e.id, e.name]))

  const byEnv = new Map<string, { environment_id: string | null; name: string; env_kind: string; resource_count: number; monthly_cost_cents: number }>()
  for (const r of accountResources) {
    const key = r.environment_id ?? `__kind:${r.env_kind}`
    const agg = byEnv.get(key) ?? {
      environment_id: r.environment_id ?? null,
      name: r.environment_id ? (envName.get(r.environment_id) ?? 'Unknown') : `Unclassified (${r.env_kind})`,
      env_kind: r.env_kind,
      resource_count: 0,
      monthly_cost_cents: 0,
    }
    agg.resource_count += 1
    agg.monthly_cost_cents += r.monthly_cost_cents ?? 0
    byEnv.set(key, agg)
  }

  return c.json({ ...account, env_breakdown: [...byEnv.values()] })
})

// PUT /:id — auth — update nickname/region -----------------------------------
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [account] = await db.select().from(cloud_accounts).where(eq(cloud_accounts.id, id))
  if (!account) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(account.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(cloud_accounts)
    .set({
      ...(body.nickname !== undefined ? { nickname: body.nickname } : {}),
      ...(body.default_region !== undefined ? { default_region: body.default_region } : {}),
    })
    .where(eq(cloud_accounts.id, id))
    .returning()
  return c.json(updated)
})

// DELETE /:id — auth — delete account ----------------------------------------
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [account] = await db.select().from(cloud_accounts).where(eq(cloud_accounts.id, id))
  if (!account) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(account.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  // Detach resources from the account before deleting to satisfy the FK.
  await db
    .update(resources)
    .set({ cloud_account_id: null })
    .where(eq(resources.cloud_account_id, id))
  await db.delete(cloud_accounts).where(eq(cloud_accounts.id, id))
  return c.json({ success: true })
})

export default router
