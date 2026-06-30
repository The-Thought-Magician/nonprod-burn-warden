import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { cost_records, resources, workspace_members } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Hours per month used to derive an hourly rate from a monthly cost figure
// (730 = 365.25 * 24 / 12).
const HOURS_PER_MONTH = 730

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

// ---------------------------------------------------------------------------
// GET / — public — cost_records by workspace_id/resource_id/period
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const resourceId = c.req.query('resource_id')
  const period = c.req.query('period')

  if (!workspaceId && !resourceId) {
    return c.json({ error: 'workspace_id or resource_id is required' }, 400)
  }

  const conds = []
  if (workspaceId) conds.push(eq(cost_records.workspace_id, workspaceId))
  if (resourceId) conds.push(eq(cost_records.resource_id, resourceId))
  if (period) conds.push(eq(cost_records.period, period))

  const rows = await db
    .select()
    .from(cost_records)
    .where(and(...conds))
    .orderBy(desc(cost_records.period))

  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST / — auth — upsert cost record (by resource_id+period)
// ---------------------------------------------------------------------------

const upsertSchema = z.object({
  workspace_id: z.string().min(1),
  resource_id: z.string().min(1),
  period: z.string().min(1),
  amount_cents: z.number().int(),
  run_hours: z.number().nonnegative().optional().default(0),
  currency: z.string().min(1).optional().default('USD'),
})

router.post('/', authMiddleware, zValidator('json', upsertSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  if (!(await isMember(body.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  // Resource must belong to the workspace.
  const [res] = await db
    .select()
    .from(resources)
    .where(and(eq(resources.id, body.resource_id), eq(resources.workspace_id, body.workspace_id)))
  if (!res) return c.json({ error: 'Resource not in workspace' }, 400)

  const [row] = await db
    .insert(cost_records)
    .values({
      workspace_id: body.workspace_id,
      resource_id: body.resource_id,
      period: body.period,
      amount_cents: body.amount_cents,
      run_hours: body.run_hours,
      currency: body.currency,
    })
    .onConflictDoUpdate({
      target: [cost_records.resource_id, cost_records.period],
      set: {
        amount_cents: body.amount_cents,
        run_hours: body.run_hours,
        currency: body.currency,
      },
    })
    .returning()

  return c.json(row, 201)
})

// ---------------------------------------------------------------------------
// GET /rates — public — derived hourly rate per resource + blended env rate
// ---------------------------------------------------------------------------

router.get('/rates', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const res = await db
    .select()
    .from(resources)
    .where(eq(resources.workspace_id, workspaceId))

  const costs = await db
    .select()
    .from(cost_records)
    .where(eq(cost_records.workspace_id, workspaceId))

  // Most-recent cost record per resource (period is a sortable string like
  // YYYY-MM). Fall back to the resource's stored hourly_rate / monthly_cost.
  const latestByResource = new Map<string, { amount_cents: number; run_hours: number; period: string }>()
  for (const cr of costs) {
    const prev = latestByResource.get(cr.resource_id)
    if (!prev || cr.period > prev.period) {
      latestByResource.set(cr.resource_id, {
        amount_cents: cr.amount_cents,
        run_hours: cr.run_hours,
        period: cr.period,
      })
    }
  }

  const perResource: Array<{
    resource_id: string
    name: string
    environment_id: string | null
    env_kind: string
    hourly_rate_cents: number
    source: string
  }> = []

  for (const r of res) {
    const latest = latestByResource.get(r.id)
    let hourly = 0
    let source = 'none'

    if (latest && latest.run_hours > 0) {
      hourly = latest.amount_cents / latest.run_hours
      source = 'cost_record_run_hours'
    } else if (latest) {
      // No run-hours: amortize the period amount over a standard month.
      hourly = latest.amount_cents / HOURS_PER_MONTH
      source = 'cost_record_amortized'
    } else if (r.hourly_rate_cents && r.hourly_rate_cents > 0) {
      hourly = r.hourly_rate_cents
      source = 'resource_hourly_rate'
    } else if (r.monthly_cost_cents && r.monthly_cost_cents > 0) {
      hourly = r.monthly_cost_cents / HOURS_PER_MONTH
      source = 'resource_monthly_cost'
    }

    perResource.push({
      resource_id: r.id,
      name: r.name,
      environment_id: r.environment_id ?? null,
      env_kind: r.env_kind,
      hourly_rate_cents: hourly,
      source,
    })
  }

  // Blended hourly rate per environment = mean of member resource rates.
  const envAgg = new Map<string, { sum: number; count: number }>()
  for (const pr of perResource) {
    if (!pr.environment_id) continue
    const a = envAgg.get(pr.environment_id) ?? { sum: 0, count: 0 }
    a.sum += pr.hourly_rate_cents
    a.count += 1
    envAgg.set(pr.environment_id, a)
  }

  const blendedByEnv: Array<{ environment_id: string; blended_hourly_rate_cents: number; resource_count: number }> = []
  for (const [envId, a] of envAgg.entries()) {
    blendedByEnv.push({
      environment_id: envId,
      blended_hourly_rate_cents: a.count > 0 ? a.sum / a.count : 0,
      resource_count: a.count,
    })
  }

  return c.json({
    rates: perResource.map((pr) => ({
      resource_id: pr.resource_id,
      name: pr.name,
      environment_id: pr.environment_id,
      env_kind: pr.env_kind,
      hourly_rate_cents: pr.hourly_rate_cents,
      source: pr.source,
    })),
    blended_by_env: blendedByEnv,
  })
})

export default router
