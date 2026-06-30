import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  workspace_members,
  alerts,
  alert_rules,
  environments,
  teams,
  team_budgets,
  waste_ledger_entries,
  cost_records,
  resources,
  orphan_findings,
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
// GET / — public — alerts by workspace_id (+ optional status filter)
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const status = c.req.query('status')
  const where = status
    ? and(eq(alerts.workspace_id, workspaceId), eq(alerts.status, status))
    : eq(alerts.workspace_id, workspaceId)
  const rows = await db.select().from(alerts).where(where).orderBy(desc(alerts.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /rules — public — alert_rules by workspace_id
// ---------------------------------------------------------------------------

router.get('/rules', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(alert_rules)
    .where(eq(alert_rules.workspace_id, workspaceId))
    .orderBy(desc(alert_rules.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST /rules — auth — create alert rule
// ---------------------------------------------------------------------------

const ruleSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  rule_type: z.enum(['waste_threshold', 'budget_overrun', 'orphan_detected', 'spend_threshold']),
  threshold_cents: z.number().int().nonnegative().optional().default(0),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium'),
  is_active: z.boolean().optional().default(true),
})

router.post('/rules', authMiddleware, zValidator('json', ruleSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const [rule] = await db
    .insert(alert_rules)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      rule_type: body.rule_type,
      threshold_cents: body.threshold_cents,
      severity: body.severity,
      is_active: body.is_active,
      created_by: userId,
    })
    .returning()
  return c.json(rule, 201)
})

// ---------------------------------------------------------------------------
// PUT /rules/:id — auth — update alert rule
// ---------------------------------------------------------------------------

const ruleUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  rule_type: z.enum(['waste_threshold', 'budget_overrun', 'orphan_detected', 'spend_threshold']).optional(),
  threshold_cents: z.number().int().nonnegative().optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  is_active: z.boolean().optional(),
})

router.put('/rules/:id', authMiddleware, zValidator('json', ruleUpdateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(alert_rules).where(eq(alert_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db.update(alert_rules).set(body).where(eq(alert_rules.id, id)).returning()
  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /rules/:id — auth — delete alert rule
// ---------------------------------------------------------------------------

router.delete('/rules/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(alert_rules).where(eq(alert_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  // Detach alerts referencing this rule, then delete the rule.
  await db.update(alerts).set({ alert_rule_id: null }).where(eq(alerts.alert_rule_id, id))
  await db.delete(alert_rules).where(eq(alert_rules.id, id))
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// POST /evaluate — auth — evaluate active rules, create alerts
// ---------------------------------------------------------------------------

const evaluateSchema = z.object({
  workspace_id: z.string().min(1),
  period: z.string().min(1).optional(),
})

router.post('/evaluate', authMiddleware, zValidator('json', evaluateSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const period = c.req.valid('json').period

  const activeRules = await db
    .select()
    .from(alert_rules)
    .where(and(eq(alert_rules.workspace_id, workspace_id), eq(alert_rules.is_active, true)))

  if (activeRules.length === 0) return c.json({ alerts_created: 0 })

  // Pre-load data sets used across rule types.
  const wsEnvironments = await db
    .select()
    .from(environments)
    .where(eq(environments.workspace_id, workspace_id))
  const envById = new Map(wsEnvironments.map((e) => [e.id, e]))

  const ledgerEntries = await db
    .select()
    .from(waste_ledger_entries)
    .where(eq(waste_ledger_entries.workspace_id, workspace_id))

  const wsTeams = await db.select().from(teams).where(eq(teams.workspace_id, workspace_id))
  const budgets = await db
    .select()
    .from(team_budgets)
    .where(eq(team_budgets.workspace_id, workspace_id))

  const wsResources = await db
    .select()
    .from(resources)
    .where(eq(resources.workspace_id, workspace_id))
  const resourceById = new Map(wsResources.map((r) => [r.id, r]))
  const wsCosts = await db
    .select()
    .from(cost_records)
    .where(eq(cost_records.workspace_id, workspace_id))

  const openOrphans = await db
    .select()
    .from(orphan_findings)
    .where(and(eq(orphan_findings.workspace_id, workspace_id), eq(orphan_findings.status, 'open')))

  // Existing open alerts to avoid duplicates (keyed by rule + message).
  const existingOpen = await db
    .select()
    .from(alerts)
    .where(and(eq(alerts.workspace_id, workspace_id), eq(alerts.status, 'open')))
  const existingKeys = new Set(existingOpen.map((a) => `${a.alert_rule_id ?? ''}::${a.message}`))

  const toInsert: typeof alerts.$inferInsert[] = []

  const pushAlert = (a: typeof alerts.$inferInsert) => {
    const key = `${a.alert_rule_id ?? ''}::${a.message}`
    if (existingKeys.has(key)) return
    existingKeys.add(key)
    toInsert.push(a)
  }

  for (const rule of activeRules) {
    if (rule.rule_type === 'waste_threshold') {
      // Per-environment waste vs threshold.
      const wasteByEnv = new Map<string, number>()
      for (const e of ledgerEntries) {
        if (!e.environment_id) continue
        wasteByEnv.set(e.environment_id, (wasteByEnv.get(e.environment_id) ?? 0) + e.wasted_cents)
      }
      for (const [envId, waste] of wasteByEnv.entries()) {
        if (waste > rule.threshold_cents) {
          const env = envById.get(envId)
          pushAlert({
            workspace_id,
            alert_rule_id: rule.id,
            environment_id: envId,
            severity: rule.severity,
            message: `${env?.name ?? 'Environment'} idle waste ${(waste / 100).toFixed(2)} exceeds threshold ${(rule.threshold_cents / 100).toFixed(2)}`,
            link: `/dashboard/environments/${envId}`,
          })
        }
      }
    } else if (rule.rule_type === 'budget_overrun') {
      // Per-team actual spend vs budget.
      const spendByTeam = new Map<string, number>()
      for (const cr of wsCosts) {
        const res = resourceById.get(cr.resource_id)
        const teamId = res?.team_id
        if (!teamId) continue
        if (period && cr.period !== period) continue
        spendByTeam.set(teamId, (spendByTeam.get(teamId) ?? 0) + cr.amount_cents)
      }
      for (const b of budgets) {
        if (period && b.period !== period) continue
        const actual = spendByTeam.get(b.team_id) ?? 0
        if (actual > b.budget_cents) {
          const team = wsTeams.find((t) => t.id === b.team_id)
          pushAlert({
            workspace_id,
            alert_rule_id: rule.id,
            team_id: b.team_id,
            severity: rule.severity,
            message: `${team?.name ?? 'Team'} spend ${(actual / 100).toFixed(2)} over budget ${(b.budget_cents / 100).toFixed(2)} for ${b.period}`,
            link: `/dashboard/budgets`,
          })
        }
      }
    } else if (rule.rule_type === 'orphan_detected') {
      for (const o of openOrphans) {
        if (o.monthly_cost_cents < rule.threshold_cents) continue
        pushAlert({
          workspace_id,
          alert_rule_id: rule.id,
          environment_id: o.environment_id,
          severity: rule.severity,
          message: `Orphan resource (${o.finding_type}): ${o.reason} — ${(o.monthly_cost_cents / 100).toFixed(2)}/mo`,
          link: `/dashboard/orphans`,
        })
      }
    } else if (rule.rule_type === 'spend_threshold') {
      // Per-environment total spend vs threshold.
      const spendByEnv = new Map<string, number>()
      for (const cr of wsCosts) {
        if (period && cr.period !== period) continue
        const res = resourceById.get(cr.resource_id)
        const envId = res?.environment_id
        if (!envId) continue
        spendByEnv.set(envId, (spendByEnv.get(envId) ?? 0) + cr.amount_cents)
      }
      for (const [envId, spend] of spendByEnv.entries()) {
        if (spend > rule.threshold_cents) {
          const env = envById.get(envId)
          pushAlert({
            workspace_id,
            alert_rule_id: rule.id,
            environment_id: envId,
            severity: rule.severity,
            message: `${env?.name ?? 'Environment'} spend ${(spend / 100).toFixed(2)} exceeds threshold ${(rule.threshold_cents / 100).toFixed(2)}`,
            link: `/dashboard/environments/${envId}`,
          })
        }
      }
    }
  }

  if (toInsert.length > 0) {
    await db.insert(alerts).values(toInsert)
  }

  return c.json({ alerts_created: toInsert.length })
})

// ---------------------------------------------------------------------------
// PATCH /:id/status — auth — acknowledge / resolve an alert
// ---------------------------------------------------------------------------

const statusSchema = z.object({
  status: z.enum(['open', 'acknowledged', 'resolved']),
})

router.patch('/:id/status', authMiddleware, zValidator('json', statusSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(alerts).where(eq(alerts.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const { status } = c.req.valid('json')
  const [updated] = await db.update(alerts).set({ status }).where(eq(alerts.id, id)).returning()
  return c.json(updated)
})

export default router
