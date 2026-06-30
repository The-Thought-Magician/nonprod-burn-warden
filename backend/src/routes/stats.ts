import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  resources,
  environments,
  idle_windows,
  waste_ledger_entries,
  recommendations,
  cost_records,
} from '../db/schema.js'
import { eq, and, desc, sql } from 'drizzle-orm'

const router = new Hono()

// ---------------------------------------------------------------------------
// GET /overview — org overview by workspace_id
//   { total_spend_cents, nonprod_spend_cents, idle_waste_cents,
//     recoverable_potential_cents, counts: { resources, nonprod_resources,
//     idle_resources, environments } }
// ---------------------------------------------------------------------------
router.get('/overview', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const allResources = await db
    .select()
    .from(resources)
    .where(eq(resources.workspace_id, workspaceId))

  const allEnvironments = await db
    .select()
    .from(environments)
    .where(eq(environments.workspace_id, workspaceId))

  const nonprodEnvIds = new Set(
    allEnvironments.filter((e) => !e.is_production).map((e) => e.id),
  )

  const isNonprod = (r: (typeof allResources)[number]): boolean => {
    if (r.environment_id && nonprodEnvIds.has(r.environment_id)) return true
    if (!r.environment_id) return r.env_kind !== 'prod' && r.env_kind !== 'production'
    return false
  }

  let totalSpendCents = 0
  let nonprodSpendCents = 0
  let nonprodResourceCount = 0
  for (const r of allResources) {
    totalSpendCents += r.monthly_cost_cents ?? 0
    if (isNonprod(r)) {
      nonprodSpendCents += r.monthly_cost_cents ?? 0
      nonprodResourceCount += 1
    }
  }

  // Idle waste: sum wasted_cents across idle windows for this workspace.
  const idleAgg = await db
    .select({
      total: sql<number>`coalesce(sum(${idle_windows.wasted_cents}), 0)`,
      idle_resource_count: sql<number>`count(distinct ${idle_windows.resource_id})`,
    })
    .from(idle_windows)
    .where(eq(idle_windows.workspace_id, workspaceId))

  const idleWasteCents = Number(idleAgg[0]?.total ?? 0)
  const idleResourceCount = Number(idleAgg[0]?.idle_resource_count ?? 0)

  // Recoverable potential: sum recoverable_cents of open recommendations.
  const recAgg = await db
    .select({
      total: sql<number>`coalesce(sum(${recommendations.recoverable_cents}), 0)`,
    })
    .from(recommendations)
    .where(
      and(
        eq(recommendations.workspace_id, workspaceId),
        eq(recommendations.status, 'open'),
      ),
    )

  const recoverablePotentialCents = Number(recAgg[0]?.total ?? 0)

  return c.json({
    total_spend_cents: totalSpendCents,
    nonprod_spend_cents: nonprodSpendCents,
    idle_waste_cents: idleWasteCents,
    recoverable_potential_cents: recoverablePotentialCents,
    counts: {
      resources: allResources.length,
      nonprod_resources: nonprodResourceCount,
      idle_resources: idleResourceCount,
      environments: allEnvironments.length,
    },
  })
})

// ---------------------------------------------------------------------------
// GET /trends — waste over time (per period) by workspace_id
//   [{ period, waste_cents, nonprod_spend_cents }]
//   - waste_cents from waste_ledger_entries grouped by period
//   - nonprod_spend_cents from cost_records for non-prod resources by period
// ---------------------------------------------------------------------------
router.get('/trends', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  // Waste per period from the ledger.
  const wasteRows = await db
    .select({
      period: waste_ledger_entries.period,
      waste_cents: sql<number>`coalesce(sum(${waste_ledger_entries.wasted_cents}), 0)`,
    })
    .from(waste_ledger_entries)
    .where(eq(waste_ledger_entries.workspace_id, workspaceId))
    .groupBy(waste_ledger_entries.period)

  // Determine which resources are non-prod (by environment or env_kind).
  const allResources = await db
    .select({
      id: resources.id,
      environment_id: resources.environment_id,
      env_kind: resources.env_kind,
    })
    .from(resources)
    .where(eq(resources.workspace_id, workspaceId))

  const allEnvironments = await db
    .select({ id: environments.id, is_production: environments.is_production })
    .from(environments)
    .where(eq(environments.workspace_id, workspaceId))

  const nonprodEnvIds = new Set(
    allEnvironments.filter((e) => !e.is_production).map((e) => e.id),
  )

  const nonprodResourceIds = new Set(
    allResources
      .filter((r) => {
        if (r.environment_id) return nonprodEnvIds.has(r.environment_id)
        return r.env_kind !== 'prod' && r.env_kind !== 'production'
      })
      .map((r) => r.id),
  )

  // Non-prod spend per period from cost_records.
  const costRows = await db
    .select({
      period: cost_records.period,
      resource_id: cost_records.resource_id,
      amount_cents: cost_records.amount_cents,
    })
    .from(cost_records)
    .where(eq(cost_records.workspace_id, workspaceId))

  const nonprodSpendByPeriod = new Map<string, number>()
  for (const row of costRows) {
    if (!nonprodResourceIds.has(row.resource_id)) continue
    nonprodSpendByPeriod.set(
      row.period,
      (nonprodSpendByPeriod.get(row.period) ?? 0) + (row.amount_cents ?? 0),
    )
  }

  const wasteByPeriod = new Map<string, number>()
  for (const row of wasteRows) {
    wasteByPeriod.set(row.period, Number(row.waste_cents ?? 0))
  }

  // Union of all periods seen, sorted ascending.
  const periods = new Set<string>([
    ...wasteByPeriod.keys(),
    ...nonprodSpendByPeriod.keys(),
  ])

  const out = [...periods]
    .sort()
    .map((period) => ({
      period,
      waste_cents: wasteByPeriod.get(period) ?? 0,
      nonprod_spend_cents: nonprodSpendByPeriod.get(period) ?? 0,
    }))

  return c.json(out)
})

// ---------------------------------------------------------------------------
// GET /leaderboard — worst-offender environments by waste
//   [{ environment_id, name, wasted_cents, env_kind }]
// ---------------------------------------------------------------------------
router.get('/leaderboard', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const limitRaw = parseInt(c.req.query('limit') ?? '10', 10)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 10

  // Aggregate waste per environment from the ledger.
  const wasteRows = await db
    .select({
      environment_id: waste_ledger_entries.environment_id,
      wasted_cents: sql<number>`coalesce(sum(${waste_ledger_entries.wasted_cents}), 0)`,
    })
    .from(waste_ledger_entries)
    .where(eq(waste_ledger_entries.workspace_id, workspaceId))
    .groupBy(waste_ledger_entries.environment_id)
    .orderBy(desc(sql`coalesce(sum(${waste_ledger_entries.wasted_cents}), 0)`))

  const allEnvironments = await db
    .select({
      id: environments.id,
      name: environments.name,
      env_kind: environments.env_kind,
    })
    .from(environments)
    .where(eq(environments.workspace_id, workspaceId))

  const envById = new Map(allEnvironments.map((e) => [e.id, e]))

  const out = wasteRows
    .filter((row) => row.environment_id !== null)
    .map((row) => {
      const env = row.environment_id ? envById.get(row.environment_id) : undefined
      return {
        environment_id: row.environment_id,
        name: env?.name ?? 'Unknown environment',
        wasted_cents: Number(row.wasted_cents ?? 0),
        env_kind: env?.env_kind ?? 'unknown',
      }
    })
    .slice(0, limit)

  return c.json(out)
})

export default router
