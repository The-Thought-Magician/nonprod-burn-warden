import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  workspace_members,
  recovery_reports,
  report_line_items,
  cost_records,
  resources,
  environments,
  teams,
  idle_windows,
  recommendations,
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

function randomToken(): string {
  return (
    crypto.randomUUID().replace(/-/g, '') +
    crypto.randomUUID().replace(/-/g, '')
  ).slice(0, 40)
}

// ---------------------------------------------------------------------------
// GET / — public — list recovery reports by workspace_id
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(recovery_reports)
    .where(eq(recovery_reports.workspace_id, workspaceId))
    .orderBy(desc(recovery_reports.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST /generate — auth — generate a recovery report for a period
// ---------------------------------------------------------------------------

const generateSchema = z.object({
  workspace_id: z.string().min(1),
  period: z.string().min(1),
  title: z.string().min(1).optional(),
})

router.post('/generate', authMiddleware, zValidator('json', generateSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, period, title } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  // All resources in the workspace (for env_kind / environment / team mapping).
  const wsResources = await db
    .select()
    .from(resources)
    .where(eq(resources.workspace_id, workspace_id))
  const resourceById = new Map(wsResources.map((r) => [r.id, r]))

  // Cost records for the period.
  const periodCosts = await db
    .select()
    .from(cost_records)
    .where(and(eq(cost_records.workspace_id, workspace_id), eq(cost_records.period, period)))

  // Idle windows (waste) for the workspace.
  const windows = await db
    .select()
    .from(idle_windows)
    .where(eq(idle_windows.workspace_id, workspace_id))

  // Environments + teams for labelling line items.
  const wsEnvironments = await db
    .select()
    .from(environments)
    .where(eq(environments.workspace_id, workspace_id))
  const envById = new Map(wsEnvironments.map((e) => [e.id, e]))
  const wsTeams = await db.select().from(teams).where(eq(teams.workspace_id, workspace_id))
  const teamById = new Map(wsTeams.map((t) => [t.id, t]))

  // Open recommendations contribute to recoverable potential.
  const openRecs = await db
    .select()
    .from(recommendations)
    .where(
      and(
        eq(recommendations.workspace_id, workspace_id),
        eq(recommendations.status, 'open'),
      ),
    )

  let totalSpend = 0
  let nonprodSpend = 0
  // Aggregate per environment.
  const envAgg = new Map<string | null, { spend: number; waste: number; recoverable: number }>()

  for (const cr of periodCosts) {
    totalSpend += cr.amount_cents
    const res = resourceById.get(cr.resource_id)
    const envId = res?.environment_id ?? null
    const isProd = envId ? envById.get(envId)?.is_production : false
    const nonprod = !isProd
    if (nonprod) nonprodSpend += cr.amount_cents
    const a = envAgg.get(envId) ?? { spend: 0, waste: 0, recoverable: 0 }
    a.spend += cr.amount_cents
    envAgg.set(envId, a)
  }

  let idleWaste = 0
  for (const w of windows) {
    idleWaste += w.wasted_cents
    const envId = w.environment_id ?? resourceById.get(w.resource_id)?.environment_id ?? null
    const a = envAgg.get(envId) ?? { spend: 0, waste: 0, recoverable: 0 }
    a.waste += w.wasted_cents
    envAgg.set(envId, a)
  }

  let recoverable = 0
  for (const rec of openRecs) {
    recoverable += rec.recoverable_cents
    const envId = rec.environment_id ?? null
    const a = envAgg.get(envId) ?? { spend: 0, waste: 0, recoverable: 0 }
    a.recoverable += rec.recoverable_cents
    envAgg.set(envId, a)
  }
  // If there are no recommendations, fall back to idle waste as recoverable.
  if (recoverable === 0) recoverable = idleWaste

  const [report] = await db
    .insert(recovery_reports)
    .values({
      workspace_id,
      period,
      title: title ?? `Recovery report — ${period}`,
      total_spend_cents: totalSpend,
      nonprod_spend_cents: nonprodSpend,
      idle_waste_cents: idleWaste,
      recoverable_cents: recoverable,
      recovered_cents: 0,
      share_token: randomToken(),
      summary: {
        environments: wsEnvironments.length,
        resources: wsResources.length,
        cost_records: periodCosts.length,
        idle_windows: windows.length,
        recommendations: openRecs.length,
      },
      created_by: userId,
    })
    .returning()

  // Build line items per environment.
  const lineItemValues = [...envAgg.entries()]
    .filter(([envId, a]) => envId !== null && (a.spend > 0 || a.waste > 0 || a.recoverable > 0))
    .map(([envId, a]) => {
      const env = envId ? envById.get(envId) : undefined
      return {
        workspace_id,
        recovery_report_id: report.id,
        environment_id: envId,
        team_id: env?.team_id ?? null,
        label: env?.name ?? 'Unassigned',
        spend_cents: a.spend,
        waste_cents: a.waste,
        recoverable_cents: a.recoverable,
      }
    })

  // Unassigned bucket (resources with no environment).
  const unassigned = envAgg.get(null)
  if (unassigned && (unassigned.spend > 0 || unassigned.waste > 0 || unassigned.recoverable > 0)) {
    lineItemValues.push({
      workspace_id,
      recovery_report_id: report.id,
      environment_id: null,
      team_id: null,
      label: 'Unassigned',
      spend_cents: unassigned.spend,
      waste_cents: unassigned.waste,
      recoverable_cents: unassigned.recoverable,
    })
  }

  let lineItems: typeof report_line_items.$inferSelect[] = []
  if (lineItemValues.length > 0) {
    lineItems = await db.insert(report_line_items).values(lineItemValues).returning()
  }

  // Decorate line items with team names.
  const decorated = lineItems.map((li) => ({
    ...li,
    team_name: li.team_id ? teamById.get(li.team_id)?.name ?? null : null,
  }))

  return c.json({ ...report, line_items: decorated }, 201)
})

// ---------------------------------------------------------------------------
// GET /:id — public — report detail + line items
// ---------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [report] = await db.select().from(recovery_reports).where(eq(recovery_reports.id, id))
  if (!report) return c.json({ error: 'Not found' }, 404)
  const lineItems = await db
    .select()
    .from(report_line_items)
    .where(eq(report_line_items.recovery_report_id, id))
    .orderBy(desc(report_line_items.spend_cents))
  return c.json({ ...report, line_items: lineItems })
})

// ---------------------------------------------------------------------------
// GET /shared/:token — public — shared read-only report by share_token
// ---------------------------------------------------------------------------

router.get('/shared/:token', async (c) => {
  const token = c.req.param('token')
  const [report] = await db
    .select()
    .from(recovery_reports)
    .where(eq(recovery_reports.share_token, token))
  if (!report) return c.json({ error: 'Not found' }, 404)
  const lineItems = await db
    .select()
    .from(report_line_items)
    .where(eq(report_line_items.recovery_report_id, report.id))
    .orderBy(desc(report_line_items.spend_cents))
  return c.json({ ...report, line_items: lineItems })
})

// ---------------------------------------------------------------------------
// DELETE /:id — auth — delete report (+ line items)
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [report] = await db.select().from(recovery_reports).where(eq(recovery_reports.id, id))
  if (!report) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(report.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(report_line_items).where(eq(report_line_items.recovery_report_id, id))
  await db.delete(recovery_reports).where(eq(recovery_reports.id, id))
  return c.json({ success: true })
})

export default router
