import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  workspace_members,
  import_batches,
  resources,
  cost_records,
  usage_samples,
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
// GET / — public — list import batches by workspace_id
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(import_batches)
    .where(eq(import_batches.workspace_id, workspaceId))
    .orderBy(desc(import_batches.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST /resources — auth — import resource CSV rows
// ---------------------------------------------------------------------------

const resourceRowSchema = z.object({
  external_id: z.string().min(1),
  name: z.string().min(1),
  resource_type: z.string().min(1),
  service: z.string().optional(),
  region: z.string().optional(),
  provider: z.string().optional(),
  env_kind: z.string().optional(),
  monthly_cost_cents: z.number().int().optional(),
  hourly_rate_cents: z.number().optional(),
  tags: z.record(z.string(), z.string()).optional(),
})

const importResourcesSchema = z.object({
  workspace_id: z.string().min(1),
  cloud_account_id: z.string().optional(),
  source: z.string().optional(),
  rows: z.array(z.record(z.string(), z.unknown())).min(1),
})

router.post('/resources', authMiddleware, zValidator('json', importResourcesSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, cloud_account_id, source, rows } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const errors: string[] = []
  let inserted = 0

  for (let i = 0; i < rows.length; i++) {
    const parsed = resourceRowSchema.safeParse(rows[i])
    if (!parsed.success) {
      errors.push(`Row ${i + 1}: ${parsed.error.issues.map((e) => `${e.path.join('.')} ${e.message}`).join('; ')}`)
      continue
    }
    const r = parsed.data
    try {
      await db
        .insert(resources)
        .values({
          workspace_id,
          cloud_account_id: cloud_account_id ?? null,
          external_id: r.external_id,
          name: r.name,
          resource_type: r.resource_type,
          service: r.service ?? null,
          region: r.region ?? null,
          provider: r.provider ?? null,
          env_kind: r.env_kind ?? 'unknown',
          tags: r.tags ?? {},
          monthly_cost_cents: r.monthly_cost_cents ?? 0,
          hourly_rate_cents: r.hourly_rate_cents ?? 0,
        })
        .onConflictDoUpdate({
          target: [resources.workspace_id, resources.external_id],
          set: {
            name: r.name,
            resource_type: r.resource_type,
            service: r.service ?? null,
            region: r.region ?? null,
            provider: r.provider ?? null,
            monthly_cost_cents: r.monthly_cost_cents ?? 0,
            hourly_rate_cents: r.hourly_rate_cents ?? 0,
            ...(r.env_kind ? { env_kind: r.env_kind } : {}),
            ...(r.tags ? { tags: r.tags } : {}),
          },
        })
      inserted++
    } catch (e) {
      errors.push(`Row ${i + 1}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const [batch] = await db
    .insert(import_batches)
    .values({
      workspace_id,
      cloud_account_id: cloud_account_id ?? null,
      kind: 'resources',
      source: source ?? 'upload',
      period: null,
      row_count: inserted,
      error_count: errors.length,
      status: errors.length === 0 ? 'completed' : inserted > 0 ? 'partial' : 'failed',
      errors,
      created_by: userId,
    })
    .returning()

  return c.json(batch, 201)
})

// ---------------------------------------------------------------------------
// POST /costs — auth — import cost_records CSV rows
// ---------------------------------------------------------------------------

const costRowSchema = z.object({
  resource_external_id: z.string().min(1).optional(),
  resource_id: z.string().min(1).optional(),
  period: z.string().min(1),
  amount_cents: z.number().int(),
  run_hours: z.number().optional(),
  currency: z.string().optional(),
})

const importCostsSchema = z.object({
  workspace_id: z.string().min(1),
  cloud_account_id: z.string().optional(),
  period: z.string().optional(),
  source: z.string().optional(),
  rows: z.array(z.record(z.string(), z.unknown())).min(1),
})

router.post('/costs', authMiddleware, zValidator('json', importCostsSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, cloud_account_id, period, source, rows } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  // Map external_id -> resource id for the workspace.
  const wsResources = await db
    .select()
    .from(resources)
    .where(eq(resources.workspace_id, workspace_id))
  const idByExternal = new Map(wsResources.map((r) => [r.external_id, r.id]))
  const knownIds = new Set(wsResources.map((r) => r.id))

  const errors: string[] = []
  let inserted = 0

  for (let i = 0; i < rows.length; i++) {
    const parsed = costRowSchema.safeParse(rows[i])
    if (!parsed.success) {
      errors.push(`Row ${i + 1}: ${parsed.error.issues.map((e) => `${e.path.join('.')} ${e.message}`).join('; ')}`)
      continue
    }
    const r = parsed.data
    let resourceId: string | undefined = r.resource_id && knownIds.has(r.resource_id) ? r.resource_id : undefined
    if (!resourceId && r.resource_external_id) resourceId = idByExternal.get(r.resource_external_id)
    if (!resourceId) {
      errors.push(`Row ${i + 1}: resource not found (resource_id/resource_external_id)`)
      continue
    }
    try {
      await db
        .insert(cost_records)
        .values({
          workspace_id,
          resource_id: resourceId,
          period: r.period,
          amount_cents: r.amount_cents,
          run_hours: r.run_hours ?? 0,
          currency: r.currency ?? 'USD',
        })
        .onConflictDoUpdate({
          target: [cost_records.resource_id, cost_records.period],
          set: {
            amount_cents: r.amount_cents,
            run_hours: r.run_hours ?? 0,
            currency: r.currency ?? 'USD',
          },
        })
      inserted++
    } catch (e) {
      errors.push(`Row ${i + 1}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const [batch] = await db
    .insert(import_batches)
    .values({
      workspace_id,
      cloud_account_id: cloud_account_id ?? null,
      kind: 'costs',
      source: source ?? 'upload',
      period: period ?? null,
      row_count: inserted,
      error_count: errors.length,
      status: errors.length === 0 ? 'completed' : inserted > 0 ? 'partial' : 'failed',
      errors,
      created_by: userId,
    })
    .returning()

  return c.json(batch, 201)
})

// ---------------------------------------------------------------------------
// POST /usage — auth — import usage_samples CSV rows
// ---------------------------------------------------------------------------

const usageRowSchema = z.object({
  resource_external_id: z.string().min(1).optional(),
  resource_id: z.string().min(1).optional(),
  metric: z.string().min(1),
  value: z.number(),
  sampled_at: z.string().min(1),
})

const importUsageSchema = z.object({
  workspace_id: z.string().min(1),
  cloud_account_id: z.string().optional(),
  source: z.string().optional(),
  rows: z.array(z.record(z.string(), z.unknown())).min(1),
})

router.post('/usage', authMiddleware, zValidator('json', importUsageSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, cloud_account_id, source, rows } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const wsResources = await db
    .select()
    .from(resources)
    .where(eq(resources.workspace_id, workspace_id))
  const idByExternal = new Map(wsResources.map((r) => [r.external_id, r.id]))
  const knownIds = new Set(wsResources.map((r) => r.id))

  const errors: string[] = []
  let inserted = 0

  for (let i = 0; i < rows.length; i++) {
    const parsed = usageRowSchema.safeParse(rows[i])
    if (!parsed.success) {
      errors.push(`Row ${i + 1}: ${parsed.error.issues.map((e) => `${e.path.join('.')} ${e.message}`).join('; ')}`)
      continue
    }
    const r = parsed.data
    let resourceId: string | undefined = r.resource_id && knownIds.has(r.resource_id) ? r.resource_id : undefined
    if (!resourceId && r.resource_external_id) resourceId = idByExternal.get(r.resource_external_id)
    if (!resourceId) {
      errors.push(`Row ${i + 1}: resource not found (resource_id/resource_external_id)`)
      continue
    }
    const sampledAt = new Date(r.sampled_at)
    if (Number.isNaN(sampledAt.getTime())) {
      errors.push(`Row ${i + 1}: sampled_at is not a valid timestamp`)
      continue
    }
    try {
      await db.insert(usage_samples).values({
        workspace_id,
        resource_id: resourceId,
        metric: r.metric,
        value: r.value,
        sampled_at: sampledAt,
      })
      inserted++
    } catch (e) {
      errors.push(`Row ${i + 1}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const [batch] = await db
    .insert(import_batches)
    .values({
      workspace_id,
      cloud_account_id: cloud_account_id ?? null,
      kind: 'usage',
      source: source ?? 'upload',
      period: null,
      row_count: inserted,
      error_count: errors.length,
      status: errors.length === 0 ? 'completed' : inserted > 0 ? 'partial' : 'failed',
      errors,
      created_by: userId,
    })
    .returning()

  return c.json(batch, 201)
})

// ---------------------------------------------------------------------------
// GET /:id — public — batch detail (errors)
// ---------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [batch] = await db.select().from(import_batches).where(eq(import_batches.id, id))
  if (!batch) return c.json({ error: 'Not found' }, 404)
  return c.json(batch)
})

export default router
