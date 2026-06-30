import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { orphan_findings, resources, environments, workspace_members, activity_log } from '../db/schema.js'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const MS_PER_DAY = 86_400_000

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

// ---------------------------------------------------------------------------
// GET / — public — orphan_findings by workspace_id (+ optional status), with resource
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const status = c.req.query('status')

  const conds = [eq(orphan_findings.workspace_id, workspaceId)]
  if (status) conds.push(eq(orphan_findings.status, status))

  const findings = await db
    .select()
    .from(orphan_findings)
    .where(and(...conds))
    .orderBy(desc(orphan_findings.monthly_cost_cents), desc(orphan_findings.created_at))

  const resourceIds = [...new Set(findings.map((f) => f.resource_id).filter((id): id is string => !!id))]
  const resourceRows = resourceIds.length
    ? await db.select().from(resources).where(inArray(resources.id, resourceIds))
    : []
  const resourceMap = new Map(resourceRows.map((r) => [r.id, r]))

  const out = findings.map((f) => ({
    ...f,
    resource: f.resource_id ? resourceMap.get(f.resource_id) ?? null : null,
  }))
  return c.json(out)
})

// ---------------------------------------------------------------------------
// POST /detect — auth — run orphan detection (sandbox age, forgotten previews, zero-usage)
// ---------------------------------------------------------------------------
const detectSchema = z.object({
  workspace_id: z.string().min(1),
  sandbox_age_days: z.number().int().positive().optional().default(30),
  preview_age_days: z.number().int().positive().optional().default(14),
  zero_usage_days: z.number().int().positive().optional().default(7),
})

router.post('/detect', authMiddleware, zValidator('json', detectSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, sandbox_age_days, preview_age_days, zero_usage_days } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const rows = await db.select().from(resources).where(eq(resources.workspace_id, workspace_id))

  const now = Date.now()
  const byType: Record<string, number> = {}
  let createdCount = 0

  for (const r of rows) {
    if (!r.is_active) continue

    const firstSeen = r.first_seen_at ? new Date(r.first_seen_at).getTime() : now
    const ageDays = Math.max(0, Math.floor((now - firstSeen) / MS_PER_DAY))
    const lastActive = r.last_active_at ? new Date(r.last_active_at).getTime() : firstSeen
    const inactiveDays = Math.max(0, Math.floor((now - lastActive) / MS_PER_DAY))

    const kind = (r.env_kind ?? '').toLowerCase()
    const name = (r.name ?? '').toLowerCase()
    const externalId = (r.external_id ?? '').toLowerCase()

    let findingType: string | null = null
    let reason = ''
    let severity = 'medium'

    const looksSandbox = kind === 'sandbox' || name.includes('sandbox') || name.includes('scratch')
    const looksPreview =
      kind === 'preview' ||
      name.includes('preview') ||
      name.includes('pr-') ||
      externalId.includes('preview') ||
      externalId.includes('pr-')

    if (looksSandbox && ageDays >= sandbox_age_days) {
      findingType = 'stale_sandbox'
      reason = `Sandbox resource has existed for ${ageDays} days (threshold ${sandbox_age_days})`
      severity = ageDays >= sandbox_age_days * 2 ? 'high' : 'medium'
    } else if (looksPreview && ageDays >= preview_age_days) {
      findingType = 'forgotten_preview'
      reason = `Preview environment resource is ${ageDays} days old (threshold ${preview_age_days})`
      severity = ageDays >= preview_age_days * 2 ? 'high' : 'medium'
    } else if (inactiveDays >= zero_usage_days) {
      findingType = 'zero_usage'
      reason = `No activity for ${inactiveDays} days (threshold ${zero_usage_days})`
      severity = (r.monthly_cost_cents ?? 0) >= 5000 ? 'high' : inactiveDays >= zero_usage_days * 2 ? 'medium' : 'low'
    }

    if (!findingType) continue

    // Skip if an open finding of this type already exists for this resource.
    const existing = await db
      .select()
      .from(orphan_findings)
      .where(
        and(
          eq(orphan_findings.workspace_id, workspace_id),
          eq(orphan_findings.resource_id, r.id),
          eq(orphan_findings.finding_type, findingType),
          eq(orphan_findings.status, 'open'),
        ),
      )
    if (existing.length > 0) continue

    await db.insert(orphan_findings).values({
      workspace_id,
      resource_id: r.id,
      environment_id: r.environment_id ?? null,
      finding_type: findingType,
      reason,
      severity,
      age_days: ageDays,
      monthly_cost_cents: r.monthly_cost_cents ?? 0,
      status: 'open',
    })
    createdCount++
    byType[findingType] = (byType[findingType] ?? 0) + 1
  }

  await db.insert(activity_log).values({
    workspace_id,
    actor_id: userId,
    action: 'orphans.detect',
    entity_type: 'orphan_finding',
    entity_id: null,
    detail: { findings_created: createdCount, by_type: byType },
  })

  return c.json({ findings_created: createdCount, by_type: byType })
})

// ---------------------------------------------------------------------------
// PATCH /:id/status — auth — set status (acknowledged/dismissed/recovered/open)
// ---------------------------------------------------------------------------
const statusSchema = z.object({
  status: z.enum(['open', 'acknowledged', 'dismissed', 'recovered']),
})

router.patch('/:id/status', authMiddleware, zValidator('json', statusSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const { status } = c.req.valid('json')

  const [existing] = await db.select().from(orphan_findings).where(eq(orphan_findings.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [updated] = await db
    .update(orphan_findings)
    .set({ status })
    .where(eq(orphan_findings.id, id))
    .returning()

  await db.insert(activity_log).values({
    workspace_id: existing.workspace_id,
    actor_id: userId,
    action: 'orphans.status',
    entity_type: 'orphan_finding',
    entity_id: id,
    detail: { status },
  })

  return c.json(updated)
})

export default router
