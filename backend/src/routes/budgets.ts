import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  team_budgets,
  teams,
  resources,
  cost_records,
  workspace_members,
} from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
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
    .where(
      and(
        eq(workspace_members.workspace_id, workspaceId),
        eq(workspace_members.user_id, userId),
      ),
    )
  return !!m
}

// Fraction of the period elapsed so far (0..1). For past/future periods relative
// to "now" this clamps to 1 / a small positive value respectively.
function periodElapsedFraction(period: string): number {
  const m = /^(\d{4})-(\d{2})$/.exec(period)
  if (!m) return 1
  const year = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  const start = new Date(Date.UTC(year, month - 1, 1)).getTime()
  const end = new Date(Date.UTC(year, month, 1)).getTime()
  const now = Date.now()
  if (now <= start) return 0
  if (now >= end) return 1
  return (now - start) / (end - start)
}

// Sum of cost_records for a team's resources in a given period.
async function actualForTeam(
  workspaceId: string,
  teamId: string,
  period: string,
): Promise<number> {
  const rows = await db
    .select({
      amount_cents: cost_records.amount_cents,
    })
    .from(cost_records)
    .innerJoin(resources, eq(cost_records.resource_id, resources.id))
    .where(
      and(
        eq(cost_records.workspace_id, workspaceId),
        eq(cost_records.period, period),
        eq(resources.team_id, teamId),
      ),
    )
  return rows.reduce((sum, r) => sum + (r.amount_cents ?? 0), 0)
}

const budgetSchema = z.object({
  workspace_id: z.string().min(1),
  team_id: z.string().min(1),
  period: z.string().min(1),
  budget_cents: z.number().int().nonnegative(),
})

const budgetUpdateSchema = z.object({
  budget_cents: z.number().int().nonnegative(),
})

// ---------------------------------------------------------------------------
// GET / — list budgets by workspace_id (+ period filter), with actual vs budget,
// projection (full-period extrapolation), and over_budget flag.
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const periodFilter = c.req.query('period')

  const conds = [eq(team_budgets.workspace_id, workspaceId)]
  if (periodFilter) conds.push(eq(team_budgets.period, periodFilter))

  const rows = await db
    .select({
      budget: team_budgets,
      team_name: teams.name,
    })
    .from(team_budgets)
    .leftJoin(teams, eq(team_budgets.team_id, teams.id))
    .where(and(...conds))
    .orderBy(team_budgets.period)

  const out = []
  for (const row of rows) {
    const b = row.budget
    const actual = await actualForTeam(workspaceId, b.team_id, b.period)
    const elapsed = periodElapsedFraction(b.period)
    const projected = elapsed > 0 ? Math.round(actual / elapsed) : actual
    out.push({
      ...b,
      team_name: row.team_name ?? null,
      actual_cents: actual,
      projected_cents: projected,
      over_budget: actual > b.budget_cents,
      projected_over_budget: projected > b.budget_cents,
      utilization_pct: b.budget_cents > 0 ? (actual / b.budget_cents) * 100 : 0,
    })
  }

  return c.json(out)
})

// ---------------------------------------------------------------------------
// POST / — set a team budget (upsert by team+period).
// ---------------------------------------------------------------------------

router.post('/', authMiddleware, zValidator('json', budgetSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  if (!(await isMember(body.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  // team must belong to the workspace
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, body.team_id), eq(teams.workspace_id, body.workspace_id)))
  if (!team) return c.json({ error: 'Team not found in workspace' }, 404)

  const [row] = await db
    .insert(team_budgets)
    .values({
      workspace_id: body.workspace_id,
      team_id: body.team_id,
      period: body.period,
      budget_cents: body.budget_cents,
      created_by: userId,
    })
    .onConflictDoUpdate({
      target: [team_budgets.team_id, team_budgets.period],
      set: { budget_cents: body.budget_cents },
    })
    .returning()

  return c.json(row, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — update budget_cents.
// ---------------------------------------------------------------------------

router.put('/:id', authMiddleware, zValidator('json', budgetUpdateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [existing] = await db.select().from(team_budgets).where(eq(team_budgets.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const [updated] = await db
    .update(team_budgets)
    .set({ budget_cents: body.budget_cents })
    .where(eq(team_budgets.id, id))
    .returning()

  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /:id — delete budget.
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db.select().from(team_budgets).where(eq(team_budgets.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await db.delete(team_budgets).where(eq(team_budgets.id, id))
  return c.json({ success: true })
})

export default router
