import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  showback_allocations,
  teams,
  resources,
  cost_records,
  waste_ledger_entries,
  workspace_members,
} from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(
      and(
        eq(workspace_members.workspace_id, workspaceId),
        eq(workspace_members.user_id, userId),
      ),
    )
  return !!m
}

// Key used to group an allocation row: team + environment (null-safe).
function allocKey(teamId: string | null, envId: string | null): string {
  return `${teamId ?? '∅'}|${envId ?? '∅'}`
}

// ---------------------------------------------------------------------------
// GET / — list showback_allocations by workspace_id (+ optional period, team_id),
// each annotated with team_name.
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const period = c.req.query('period')
  const teamId = c.req.query('team_id')

  const conds = [eq(showback_allocations.workspace_id, workspaceId)]
  if (period) conds.push(eq(showback_allocations.period, period))
  if (teamId) conds.push(eq(showback_allocations.team_id, teamId))

  const rows = await db
    .select({
      allocation: showback_allocations,
      team_name: teams.name,
    })
    .from(showback_allocations)
    .leftJoin(teams, eq(showback_allocations.team_id, teams.id))
    .where(and(...conds))
    .orderBy(showback_allocations.period)

  return c.json(
    rows.map((r) => ({
      ...r.allocation,
      team_name: r.team_name ?? null,
    })),
  )
})

const rebuildSchema = z.object({
  workspace_id: z.string().min(1),
  period: z.string().min(1),
})

// ---------------------------------------------------------------------------
// POST /rebuild — recompute allocations for a period from cost_records (allocated
// spend) + waste_ledger_entries (wasted), grouped by team+environment. Resources
// with no team land in an "unallocated" bucket (team_id = null).
// ---------------------------------------------------------------------------

router.post('/rebuild', authMiddleware, zValidator('json', rebuildSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, period } = c.req.valid('json')

  if (!(await isMember(workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  // 1. allocated spend: cost_records joined to resources (for team/env).
  const costRows = await db
    .select({
      amount_cents: cost_records.amount_cents,
      team_id: resources.team_id,
      environment_id: resources.environment_id,
    })
    .from(cost_records)
    .innerJoin(resources, eq(cost_records.resource_id, resources.id))
    .where(
      and(eq(cost_records.workspace_id, workspace_id), eq(cost_records.period, period)),
    )

  // 2. wasted: ledger entries already carry team_id + environment_id.
  const wasteRows = await db
    .select({
      wasted_cents: waste_ledger_entries.wasted_cents,
      team_id: waste_ledger_entries.team_id,
      environment_id: waste_ledger_entries.environment_id,
    })
    .from(waste_ledger_entries)
    .where(
      and(
        eq(waste_ledger_entries.workspace_id, workspace_id),
        eq(waste_ledger_entries.period, period),
      ),
    )

  const buckets = new Map<
    string,
    { team_id: string | null; environment_id: string | null; allocated: number; wasted: number }
  >()

  const get = (teamId: string | null, envId: string | null) => {
    const key = allocKey(teamId, envId)
    let b = buckets.get(key)
    if (!b) {
      b = { team_id: teamId, environment_id: envId, allocated: 0, wasted: 0 }
      buckets.set(key, b)
    }
    return b
  }

  for (const r of costRows) {
    get(r.team_id ?? null, r.environment_id ?? null).allocated += r.amount_cents ?? 0
  }
  for (const r of wasteRows) {
    get(r.team_id ?? null, r.environment_id ?? null).wasted += r.wasted_cents ?? 0
  }

  // Replace any prior allocations for this workspace+period.
  await db
    .delete(showback_allocations)
    .where(
      and(
        eq(showback_allocations.workspace_id, workspace_id),
        eq(showback_allocations.period, period),
      ),
    )

  let unallocatedCents = 0
  const toInsert = []
  for (const b of buckets.values()) {
    if (b.team_id === null) unallocatedCents += b.allocated
    toInsert.push({
      workspace_id,
      team_id: b.team_id,
      environment_id: b.environment_id,
      period,
      allocated_cents: b.allocated,
      wasted_cents: b.wasted,
    })
  }

  if (toInsert.length > 0) {
    await db.insert(showback_allocations).values(toInsert)
  }

  return c.json({ allocations_created: toInsert.length, unallocated_cents: unallocatedCents })
})

// ---------------------------------------------------------------------------
// GET /statement — per-team showback statement for a period, with an explicit
// unallocated bucket (allocations whose team_id is null).
// ---------------------------------------------------------------------------

router.get('/statement', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const period = c.req.query('period')
  if (!period) return c.json({ error: 'period is required' }, 400)

  const rows = await db
    .select({
      allocation: showback_allocations,
      team_name: teams.name,
    })
    .from(showback_allocations)
    .leftJoin(teams, eq(showback_allocations.team_id, teams.id))
    .where(
      and(
        eq(showback_allocations.workspace_id, workspaceId),
        eq(showback_allocations.period, period),
      ),
    )

  const byTeam = new Map<
    string,
    { team_id: string; team_name: string | null; allocated_cents: number; wasted_cents: number }
  >()
  let unallocatedCents = 0
  let unallocatedWastedCents = 0

  for (const r of rows) {
    const a = r.allocation
    if (a.team_id === null) {
      unallocatedCents += a.allocated_cents
      unallocatedWastedCents += a.wasted_cents
      continue
    }
    let t = byTeam.get(a.team_id)
    if (!t) {
      t = { team_id: a.team_id, team_name: r.team_name ?? null, allocated_cents: 0, wasted_cents: 0 }
      byTeam.set(a.team_id, t)
    }
    t.allocated_cents += a.allocated_cents
    t.wasted_cents += a.wasted_cents
  }

  const teamsOut = [...byTeam.values()].sort((a, b) => b.allocated_cents - a.allocated_cents)
  const totalAllocated =
    teamsOut.reduce((s, t) => s + t.allocated_cents, 0) + unallocatedCents
  const totalWasted =
    teamsOut.reduce((s, t) => s + t.wasted_cents, 0) + unallocatedWastedCents

  return c.json({
    period,
    teams: teamsOut,
    unallocated_cents: unallocatedCents,
    unallocated_wasted_cents: unallocatedWastedCents,
    total_allocated_cents: totalAllocated,
    total_wasted_cents: totalWasted,
  })
})

export default router
