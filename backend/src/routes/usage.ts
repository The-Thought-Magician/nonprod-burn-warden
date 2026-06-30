import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { usage_samples, resources, workspace_members } from '../db/schema.js'
import { eq, and, desc, gte, lte } from 'drizzle-orm'
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

// ---------------------------------------------------------------------------
// GET / — public — usage samples by resource_id (filter metric, range)
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const resourceId = c.req.query('resource_id')
  if (!resourceId) return c.json({ error: 'resource_id is required' }, 400)

  const metric = c.req.query('metric')
  const from = c.req.query('from')
  const to = c.req.query('to')
  const limitRaw = parseInt(c.req.query('limit') ?? '1000', 10)
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 5000)) : 1000

  const conds = [eq(usage_samples.resource_id, resourceId)]
  if (metric) conds.push(eq(usage_samples.metric, metric))
  if (from) {
    const d = new Date(from)
    if (!Number.isNaN(d.getTime())) conds.push(gte(usage_samples.sampled_at, d))
  }
  if (to) {
    const d = new Date(to)
    if (!Number.isNaN(d.getTime())) conds.push(lte(usage_samples.sampled_at, d))
  }

  const rows = await db
    .select()
    .from(usage_samples)
    .where(and(...conds))
    .orderBy(desc(usage_samples.sampled_at))
    .limit(limit)

  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST / — auth — record sample(s) (array)
// ---------------------------------------------------------------------------

const sampleItem = z.object({
  resource_id: z.string().min(1),
  metric: z.string().min(1),
  value: z.number(),
  sampled_at: z.string().min(1),
})

const recordSchema = z.object({
  workspace_id: z.string().min(1),
  samples: z.array(sampleItem).min(1),
})

router.post('/', authMiddleware, zValidator('json', recordSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, samples } = c.req.valid('json')

  if (!(await isMember(workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  // Validate all referenced resources belong to this workspace.
  const resourceIds = [...new Set(samples.map((s) => s.resource_id))]
  const owned = await db
    .select({ id: resources.id })
    .from(resources)
    .where(eq(resources.workspace_id, workspace_id))
  const ownedSet = new Set(owned.map((r) => r.id))
  for (const rid of resourceIds) {
    if (!ownedSet.has(rid)) {
      return c.json({ error: `Resource ${rid} not in workspace` }, 400)
    }
  }

  const values = samples.map((s) => {
    const d = new Date(s.sampled_at)
    if (Number.isNaN(d.getTime())) {
      throw new Error(`Invalid sampled_at: ${s.sampled_at}`)
    }
    return {
      workspace_id,
      resource_id: s.resource_id,
      metric: s.metric,
      value: s.value,
      sampled_at: d,
    }
  })

  let inserted = 0
  try {
    const result = await db.insert(usage_samples).values(values).returning({ id: usage_samples.id })
    inserted = result.length
  } catch {
    return c.json({ error: 'Invalid sample data' }, 400)
  }

  return c.json({ inserted }, 201)
})

// ---------------------------------------------------------------------------
// GET /hourly — public — hourly-bucketed aggregate by resource_id/environment_id
// ---------------------------------------------------------------------------

router.get('/hourly', async (c) => {
  const resourceId = c.req.query('resource_id')
  const environmentId = c.req.query('environment_id')
  const metric = c.req.query('metric')
  const from = c.req.query('from')
  const to = c.req.query('to')

  if (!resourceId && !environmentId) {
    return c.json({ error: 'resource_id or environment_id is required' }, 400)
  }

  // Resolve the set of resource ids to aggregate over.
  let resourceIds: string[] = []
  if (resourceId) {
    resourceIds = [resourceId]
  } else if (environmentId) {
    const rows = await db
      .select({ id: resources.id })
      .from(resources)
      .where(eq(resources.environment_id, environmentId))
    resourceIds = rows.map((r) => r.id)
  }

  if (resourceIds.length === 0) return c.json([])

  // Aggregate in app code over the workspace's samples (filtered by the
  // resolved resource id set, optional metric, and optional time range).
  const all = await db
    .select()
    .from(usage_samples)
    .orderBy(usage_samples.sampled_at)

  const idSet = new Set(resourceIds)
  const fromT = from ? Date.parse(from) : NaN
  const toT = to ? Date.parse(to) : NaN

  // bucket key -> { metric -> { sum, count, max } }
  const buckets = new Map<string, Map<string, { sum: number; count: number; max: number }>>()

  for (const s of all) {
    if (!idSet.has(s.resource_id)) continue
    if (metric && s.metric !== metric) continue
    const t = s.sampled_at instanceof Date ? s.sampled_at.getTime() : Date.parse(String(s.sampled_at))
    if (Number.isNaN(t)) continue
    if (Number.isFinite(fromT) && t < fromT) continue
    if (Number.isFinite(toT) && t > toT) continue

    const d = new Date(t)
    // Hour bucket truncated to the top of the UTC hour.
    const hourStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours())
    const hourKey = new Date(hourStart).toISOString()

    let byMetric = buckets.get(hourKey)
    if (!byMetric) {
      byMetric = new Map()
      buckets.set(hourKey, byMetric)
    }
    let agg = byMetric.get(s.metric)
    if (!agg) {
      agg = { sum: 0, count: 0, max: Number.NEGATIVE_INFINITY }
      byMetric.set(s.metric, agg)
    }
    agg.sum += s.value
    agg.count += 1
    if (s.value > agg.max) agg.max = s.value
  }

  const out: Array<{ hour: string; metric: string; avg: number; max: number; count: number }> = []
  for (const [hour, byMetric] of buckets.entries()) {
    for (const [m, agg] of byMetric.entries()) {
      out.push({
        hour,
        metric: m,
        avg: agg.count > 0 ? agg.sum / agg.count : 0,
        max: agg.max === Number.NEGATIVE_INFINITY ? 0 : agg.max,
        count: agg.count,
      })
    }
  }
  out.sort((a, b) => (a.hour < b.hour ? -1 : a.hour > b.hour ? 1 : a.metric < b.metric ? -1 : 1))

  return c.json(out)
})

export default router
