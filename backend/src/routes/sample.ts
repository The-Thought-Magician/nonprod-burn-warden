import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  workspaces,
  workspace_members,
  teams,
  team_budgets,
  holiday_calendars,
  holidays,
  schedules,
  schedule_assignments,
  environments,
  cloud_accounts,
  resources,
  usage_samples,
  cost_records,
  idle_windows,
  waste_ledger_entries,
  orphan_findings,
  savings_estimates,
  recommendations,
  showback_allocations,
  alert_rules,
  activity_log,
} from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()
router.use('*', authMiddleware)

// ---------------------------------------------------------------------------
// Deterministic helpers — a seeded PRNG so repeated seeds for the same caller
// produce stable, reproducible demo data.
// ---------------------------------------------------------------------------

function makeRng(seed: number) {
  // mulberry32
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}

function isoDaysAgo(days: number, hourUtc = 0): Date {
  const d = new Date()
  d.setUTCHours(hourUtc, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - days)
  return d
}

function currentPeriod(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function prevPeriod(): string {
  const d = new Date()
  d.setUTCMonth(d.getUTCMonth() - 1)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// A standard "business hours Mon-Fri 08:00-20:00" schedule windows payload.
const BUSINESS_WINDOWS = [1, 2, 3, 4, 5].map((day) => ({ day, start_hour: 8, end_hour: 20 }))
// Effective hours/week for the above: 5 days * 12h = 60h.
const BUSINESS_HOURS_PER_WEEK = 60

interface SeedCounts {
  workspace: number
  teams: number
  cloud_accounts: number
  environments: number
  resources: number
  usage_samples: number
  cost_records: number
  idle_windows: number
  schedules: number
  orphan_findings: number
  savings_estimates: number
  recommendations: number
  waste_ledger_entries: number
  showback_allocations: number
  team_budgets: number
  alert_rules: number
  holidays: number
  activity_log: number
}

// ---------------------------------------------------------------------------
// Core generator — builds an entire deterministic demo workspace for a user.
// ---------------------------------------------------------------------------

async function generate(userId: string, workspaceId: string, slug: string): Promise<SeedCounts> {
  const rng = makeRng(hashString(workspaceId + userId))
  const counts: SeedCounts = {
    workspace: 1,
    teams: 0,
    cloud_accounts: 0,
    environments: 0,
    resources: 0,
    usage_samples: 0,
    cost_records: 0,
    idle_windows: 0,
    schedules: 0,
    orphan_findings: 0,
    savings_estimates: 0,
    recommendations: 0,
    waste_ledger_entries: 0,
    showback_allocations: 0,
    team_budgets: 0,
    alert_rules: 0,
    holidays: 0,
    activity_log: 0,
  }

  const period = currentPeriod()
  const lastPeriod = prevPeriod()

  // ---- Teams -------------------------------------------------------------
  const teamDefs = [
    { name: 'Platform', lead_email: 'platform-lead@demo.test' },
    { name: 'Payments', lead_email: 'payments-lead@demo.test' },
    { name: 'Growth', lead_email: 'growth-lead@demo.test' },
  ]
  const teamRows = await db
    .insert(teams)
    .values(teamDefs.map((t) => ({ workspace_id: workspaceId, name: t.name, lead_email: t.lead_email, created_by: userId })))
    .returning()
  counts.teams = teamRows.length

  // ---- Team budgets ------------------------------------------------------
  await db.insert(team_budgets).values(
    teamRows.map((t, i) => ({
      workspace_id: workspaceId,
      team_id: t.id,
      period,
      budget_cents: (40000 + i * 15000) * 100,
      created_by: userId,
    })),
  )
  counts.team_budgets = teamRows.length

  // ---- Holiday calendar + holidays --------------------------------------
  const [calendar] = await db
    .insert(holiday_calendars)
    .values({ workspace_id: workspaceId, name: 'US Holidays', region: 'US', created_by: userId })
    .returning()
  const year = new Date().getUTCFullYear()
  const holidayDefs = [
    { name: "New Year's Day", date: `${year}-01-01` },
    { name: 'Independence Day', date: `${year}-07-04` },
    { name: 'Thanksgiving', date: `${year}-11-27` },
    { name: 'Christmas Day', date: `${year}-12-25` },
  ]
  await db.insert(holidays).values(
    holidayDefs.map((h) => ({
      workspace_id: workspaceId,
      holiday_calendar_id: calendar.id,
      name: h.name,
      date: h.date,
      is_full_day: true,
    })),
  )
  counts.holidays = holidayDefs.length

  // ---- Schedules (one preset always-on, one business-hours) -------------
  const scheduleRows = await db
    .insert(schedules)
    .values([
      {
        workspace_id: workspaceId,
        name: 'Always On',
        description: '24x7 — no shutdown windows',
        windows: [],
        treat_holidays_off: false,
        is_preset: true,
        effective_hours_per_week: 168,
        created_by: userId,
      },
      {
        workspace_id: workspaceId,
        name: 'Business Hours (Mon-Fri 8-8)',
        description: 'Running only during weekday business hours',
        windows: BUSINESS_WINDOWS,
        treat_holidays_off: true,
        is_preset: true,
        effective_hours_per_week: BUSINESS_HOURS_PER_WEEK,
        created_by: userId,
      },
    ])
    .returning()
  counts.schedules = scheduleRows.length
  const businessSchedule = scheduleRows[1]

  // ---- Environments ------------------------------------------------------
  const envDefs = [
    { name: 'dev', env_kind: 'dev', is_production: false, team: 0 },
    { name: 'staging', env_kind: 'staging', is_production: false, team: 0 },
    { name: 'qa', env_kind: 'qa', is_production: false, team: 1 },
    { name: 'preview', env_kind: 'preview', is_production: false, team: 2 },
    { name: 'production', env_kind: 'prod', is_production: true, team: 1 },
  ]
  const envRows = await db
    .insert(environments)
    .values(
      envDefs.map((e) => ({
        workspace_id: workspaceId,
        team_id: teamRows[e.team].id,
        name: e.name,
        env_kind: e.env_kind,
        timezone: 'America/New_York',
        holiday_calendar_id: calendar.id,
        schedule_id: e.is_production ? null : businessSchedule.id,
        description: `${e.name} environment`,
        is_production: e.is_production,
        created_by: userId,
      })),
    )
    .returning()
  counts.environments = envRows.length

  // ---- Cloud accounts ----------------------------------------------------
  const accountRows = await db
    .insert(cloud_accounts)
    .values([
      {
        workspace_id: workspaceId,
        provider: 'aws',
        account_ref: '111122223333',
        nickname: 'AWS — Engineering',
        default_region: 'us-east-1',
        created_by: userId,
      },
      {
        workspace_id: workspaceId,
        provider: 'gcp',
        account_ref: 'demo-gcp-project',
        nickname: 'GCP — Sandbox',
        default_region: 'us-central1',
        created_by: userId,
      },
    ])
    .returning()
  counts.cloud_accounts = accountRows.length

  // ---- Resources ---------------------------------------------------------
  const services = ['ec2', 'rds', 'eks', 'redshift', 'gke', 'cloudsql']
  const resourceTypes = ['compute', 'database', 'cluster', 'cache']
  const regions = ['us-east-1', 'us-west-2', 'eu-west-1', 'us-central1']
  const providers = ['aws', 'aws', 'aws', 'gcp']

  const resourceValues: (typeof resources.$inferInsert)[] = []
  // 6 resources per non-prod env, 4 in prod => deterministic count.
  envRows.forEach((env, envIdx) => {
    const n = env.is_production ? 4 : 6
    for (let i = 0; i < n; i++) {
      const provider = pick(rng, providers)
      const account = accountRows.find((a) => a.provider === provider) ?? accountRows[0]
      // Non-prod resources are pricier-by-waste: higher hourly rate => more idle waste.
      const hourly = env.is_production
        ? 20 + Math.floor(rng() * 60) // 20-80 cents/hr
        : 8 + Math.floor(rng() * 40) // 8-48 cents/hr
      // monthly cost = hourly * 730h baseline
      const monthly = Math.round(hourly * 730)
      const ageDays = 5 + Math.floor(rng() * 120)
      resourceValues.push({
        workspace_id: workspaceId,
        cloud_account_id: account.id,
        environment_id: env.id,
        team_id: env.team_id,
        external_id: `${env.name}-res-${envIdx}-${i}`,
        name: `${env.name}-${pick(rng, resourceTypes)}-${i}`,
        resource_type: pick(rng, resourceTypes),
        service: pick(rng, services),
        region: pick(rng, regions),
        provider,
        env_kind: env.env_kind,
        classification_source: 'environment_rule',
        classification_confidence: 0.7 + rng() * 0.3,
        tags: { env: env.env_kind, team: teamRows[envIdx % teamRows.length].name.toLowerCase() },
        monthly_cost_cents: monthly,
        hourly_rate_cents: hourly,
        first_seen_at: isoDaysAgo(ageDays),
        last_active_at: env.is_production ? isoDaysAgo(0, 12) : isoDaysAgo(Math.floor(rng() * 10)),
        is_active: true,
      })
    }
  })
  const resourceRows = await db.insert(resources).values(resourceValues).returning()
  counts.resources = resourceRows.length

  // ---- Usage samples -----------------------------------------------------
  // Per resource: 7 days * 4 samples/day of cpu utilization. Non-prod dips to
  // ~0 outside business hours; prod stays busy.
  const usageValues: (typeof usage_samples.$inferInsert)[] = []
  const sampleHours = [3, 10, 14, 22] // off, business, business, off
  for (const res of resourceRows) {
    const env = envRows.find((e) => e.id === res.environment_id)!
    for (let day = 6; day >= 0; day--) {
      const dow = new Date(isoDaysAgo(day).getTime()).getUTCDay()
      const weekend = dow === 0 || dow === 6
      for (const hr of sampleHours) {
        const business = hr >= 8 && hr < 20 && !weekend
        let value: number
        if (env.is_production) {
          value = 35 + rng() * 50 // always busy
        } else if (business) {
          value = 25 + rng() * 45 // active during the day
        } else {
          value = rng() * 3 // idle off-hours
        }
        usageValues.push({
          workspace_id: workspaceId,
          resource_id: res.id,
          metric: 'cpu_utilization',
          value,
          sampled_at: isoDaysAgo(day, hr),
        })
      }
    }
  }
  // Batch insert in chunks to keep statements reasonable.
  for (let i = 0; i < usageValues.length; i += 500) {
    await db.insert(usage_samples).values(usageValues.slice(i, i + 500))
  }
  counts.usage_samples = usageValues.length

  // ---- Cost records (current + previous period) -------------------------
  const costValues: (typeof cost_records.$inferInsert)[] = []
  for (const res of resourceRows) {
    for (const p of [lastPeriod, period]) {
      const runHours = 700 + rng() * 60
      costValues.push({
        workspace_id: workspaceId,
        resource_id: res.id,
        period: p,
        amount_cents: Math.round(res.hourly_rate_cents * runHours),
        run_hours: runHours,
        currency: 'USD',
      })
    }
  }
  for (let i = 0; i < costValues.length; i += 500) {
    await db.insert(cost_records).values(costValues.slice(i, i + 500))
  }
  counts.cost_records = costValues.length

  // ---- Idle windows ------------------------------------------------------
  // For non-prod resources, derive off-hours idle windows over the last 7 days.
  const idleValues: (typeof idle_windows.$inferInsert)[] = []
  for (const res of resourceRows) {
    const env = envRows.find((e) => e.id === res.environment_id)!
    if (env.is_production) continue
    for (let day = 6; day >= 0; day--) {
      const dow = new Date(isoDaysAgo(day).getTime()).getUTCDay()
      const weekend = dow === 0 || dow === 6
      // Off-hours idle: 20:00 -> 08:00 next day (12h). Weekends fully idle (24h).
      const durationHours = weekend ? 24 : 12
      const start = isoDaysAgo(day, weekend ? 0 : 20)
      const end = new Date(start.getTime() + durationHours * 3_600_000)
      const wasted = Math.round(res.hourly_rate_cents * durationHours)
      idleValues.push({
        workspace_id: workspaceId,
        resource_id: res.id,
        environment_id: env.id,
        start_at: start,
        end_at: end,
        duration_hours: durationHours,
        is_off_hours: true,
        wasted_cents: wasted,
      })
    }
  }
  for (let i = 0; i < idleValues.length; i += 500) {
    await db.insert(idle_windows).values(idleValues.slice(i, i + 500))
  }
  counts.idle_windows = idleValues.length

  // ---- Waste ledger entries (per non-prod env, current period) ----------
  const ledgerValues: (typeof waste_ledger_entries.$inferInsert)[] = []
  for (const env of envRows) {
    if (env.is_production) continue
    const envResources = resourceRows.filter((r) => r.environment_id === env.id)
    const envIdle = idleValues.filter((w) => w.environment_id === env.id)
    const idleHours = envIdle.reduce((s, w) => s + w.duration_hours, 0)
    const offHoursIdle = idleHours // all demo idle is off-hours
    const wasted = envIdle.reduce((s, w) => s + (w.wasted_cents ?? 0), 0)
    const blendedRate =
      envResources.length > 0
        ? envResources.reduce((s, r) => s + r.hourly_rate_cents, 0) / envResources.length
        : 0
    ledgerValues.push({
      workspace_id: workspaceId,
      environment_id: env.id,
      resource_id: null,
      team_id: env.team_id,
      period,
      idle_hours: idleHours,
      off_hours_idle_hours: offHoursIdle,
      hourly_rate_cents: blendedRate,
      wasted_cents: wasted,
      breakdown: { resources: envResources.length, off_hours_pct: 100 },
    })
  }
  if (ledgerValues.length > 0) await db.insert(waste_ledger_entries).values(ledgerValues)
  counts.waste_ledger_entries = ledgerValues.length

  // ---- Savings estimates (apply business schedule to non-prod envs) -----
  const savingsValues: (typeof savings_estimates.$inferInsert)[] = []
  for (const env of envRows) {
    if (env.is_production) continue
    const envResources = resourceRows.filter((r) => r.environment_id === env.id)
    const currentMonthly = envResources.reduce((s, r) => s + r.monthly_cost_cents, 0)
    // Business hours keep 60/168 of the week running.
    const savingsPct = 1 - BUSINESS_HOURS_PER_WEEK / 168
    const monthlySavings = Math.round(currentMonthly * savingsPct)
    const hoursSaved = 168 - BUSINESS_HOURS_PER_WEEK
    savingsValues.push({
      workspace_id: workspaceId,
      environment_id: env.id,
      schedule_id: businessSchedule.id,
      hours_saved_per_week: hoursSaved,
      monthly_savings_cents: monthlySavings,
      savings_pct: savingsPct * 100,
      current_monthly_cents: currentMonthly,
      created_by: userId,
    })
  }
  if (savingsValues.length > 0) await db.insert(savings_estimates).values(savingsValues)
  counts.savings_estimates = savingsValues.length

  // ---- Schedule assignments (assign business schedule to non-prod envs) -
  const assignmentValues: (typeof schedule_assignments.$inferInsert)[] = []
  for (const env of envRows) {
    if (env.is_production) continue
    assignmentValues.push({
      workspace_id: workspaceId,
      schedule_id: businessSchedule.id,
      environment_id: env.id,
      resource_id: null,
      created_by: userId,
    })
  }
  if (assignmentValues.length > 0) await db.insert(schedule_assignments).values(assignmentValues)

  // ---- Orphan findings ---------------------------------------------------
  // Flag a deterministic subset: oldest non-prod resources => orphan candidates.
  const orphanValues: (typeof orphan_findings.$inferInsert)[] = []
  const orphanCandidates = resourceRows
    .filter((r) => {
      const env = envRows.find((e) => e.id === r.environment_id)!
      return !env.is_production
    })
    .slice(0, 5)
  const findingTypes = ['forgotten_preview', 'sandbox_age', 'zero_usage', 'unattached_volume', 'idle_database']
  orphanCandidates.forEach((res, i) => {
    const ageDays = 30 + Math.floor(rng() * 90)
    orphanValues.push({
      workspace_id: workspaceId,
      resource_id: res.id,
      environment_id: res.environment_id,
      finding_type: findingTypes[i % findingTypes.length],
      reason: `No activity detected for ${ageDays} days in a non-production environment`,
      severity: i === 0 ? 'high' : i < 3 ? 'medium' : 'low',
      age_days: ageDays,
      monthly_cost_cents: res.monthly_cost_cents,
      status: 'open',
    })
  })
  let orphanRows: (typeof orphan_findings.$inferSelect)[] = []
  if (orphanValues.length > 0) orphanRows = await db.insert(orphan_findings).values(orphanValues).returning()
  counts.orphan_findings = orphanRows.length

  // ---- Recommendations (from savings + orphans) -------------------------
  const recValues: (typeof recommendations.$inferInsert)[] = []
  for (const s of savingsValues) {
    const env = envRows.find((e) => e.id === s.environment_id)
    recValues.push({
      workspace_id: workspaceId,
      environment_id: s.environment_id,
      schedule_id: businessSchedule.id,
      orphan_finding_id: null,
      rec_type: 'schedule',
      title: `Apply business-hours schedule to ${env?.name ?? 'environment'}`,
      detail: `Shutting down outside Mon-Fri 8-8 recovers an estimated ${(s.monthly_savings_cents! / 100).toFixed(0)} USD/month.`,
      recoverable_cents: s.monthly_savings_cents!,
      status: 'open',
    })
  }
  for (const o of orphanRows) {
    recValues.push({
      workspace_id: workspaceId,
      environment_id: o.environment_id,
      schedule_id: null,
      orphan_finding_id: o.id,
      rec_type: 'decommission',
      title: `Decommission orphaned resource (${o.finding_type})`,
      detail: o.reason,
      recoverable_cents: o.monthly_cost_cents,
      status: 'open',
    })
  }
  if (recValues.length > 0) await db.insert(recommendations).values(recValues)
  counts.recommendations = recValues.length

  // ---- Showback allocations (per team/env, current period) --------------
  const showbackValues: (typeof showback_allocations.$inferInsert)[] = []
  for (const env of envRows) {
    const envResources = resourceRows.filter((r) => r.environment_id === env.id)
    const allocated = envResources.reduce((s, r) => s + r.monthly_cost_cents, 0)
    const ledger = ledgerValues.find((l) => l.environment_id === env.id)
    showbackValues.push({
      workspace_id: workspaceId,
      team_id: env.team_id,
      environment_id: env.id,
      period,
      allocated_cents: allocated,
      wasted_cents: ledger?.wasted_cents ?? 0,
    })
  }
  if (showbackValues.length > 0) await db.insert(showback_allocations).values(showbackValues)
  counts.showback_allocations = showbackValues.length

  // ---- Alert rules -------------------------------------------------------
  await db.insert(alert_rules).values([
    {
      workspace_id: workspaceId,
      name: 'High monthly waste',
      rule_type: 'waste_threshold',
      threshold_cents: 50000,
      severity: 'high',
      is_active: true,
      created_by: userId,
    },
    {
      workspace_id: workspaceId,
      name: 'Budget overrun',
      rule_type: 'budget_overrun',
      threshold_cents: 0,
      severity: 'medium',
      is_active: true,
      created_by: userId,
    },
  ])
  counts.alert_rules = 2

  // ---- Activity log entry ------------------------------------------------
  await db.insert(activity_log).values({
    workspace_id: workspaceId,
    actor_id: userId,
    action: 'seed',
    entity_type: 'workspace',
    entity_id: workspaceId,
    detail: { source: 'sample_seeder', slug },
  })
  counts.activity_log = 1

  return counts
}

// ---------------------------------------------------------------------------
// Delete every child row of a workspace in FK-safe order, but keep the
// workspace + membership rows so the same workspace_id can be regenerated.
// ---------------------------------------------------------------------------

async function purgeWorkspaceData(workspaceId: string) {
  // Children first, parents last. Environments / resources are referenced by
  // many tables, so they go near the end.
  await db.delete(activity_log).where(eq(activity_log.workspace_id, workspaceId))
  await db.delete(alert_rules).where(eq(alert_rules.workspace_id, workspaceId))
  await db.delete(showback_allocations).where(eq(showback_allocations.workspace_id, workspaceId))
  await db.delete(recommendations).where(eq(recommendations.workspace_id, workspaceId))
  await db.delete(orphan_findings).where(eq(orphan_findings.workspace_id, workspaceId))
  await db.delete(savings_estimates).where(eq(savings_estimates.workspace_id, workspaceId))
  await db.delete(waste_ledger_entries).where(eq(waste_ledger_entries.workspace_id, workspaceId))
  await db.delete(idle_windows).where(eq(idle_windows.workspace_id, workspaceId))
  await db.delete(cost_records).where(eq(cost_records.workspace_id, workspaceId))
  await db.delete(usage_samples).where(eq(usage_samples.workspace_id, workspaceId))
  await db.delete(schedule_assignments).where(eq(schedule_assignments.workspace_id, workspaceId))
  await db.delete(team_budgets).where(eq(team_budgets.workspace_id, workspaceId))
  await db.delete(resources).where(eq(resources.workspace_id, workspaceId))
  await db.delete(cloud_accounts).where(eq(cloud_accounts.workspace_id, workspaceId))
  await db.delete(environments).where(eq(environments.workspace_id, workspaceId))
  await db.delete(schedules).where(eq(schedules.workspace_id, workspaceId))
  await db.delete(holidays).where(eq(holidays.workspace_id, workspaceId))
  await db.delete(holiday_calendars).where(eq(holiday_calendars.workspace_id, workspaceId))
  await db.delete(teams).where(eq(teams.workspace_id, workspaceId))
}

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

// ---------------------------------------------------------------------------
// POST /seed — create a fresh deterministic demo workspace for the caller.
// ---------------------------------------------------------------------------

router.post('/seed', async (c) => {
  const userId = getUserId(c)

  // Build a unique slug per caller + timestamp so repeated seeds don't collide.
  const suffix = Date.now().toString(36)
  const slug = `demo-${hashString(userId).toString(36)}-${suffix}`

  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'Burn Warden Demo', slug, owner_id: userId, currency: 'USD' })
    .returning()

  await db.insert(workspace_members).values({ workspace_id: workspace.id, user_id: userId, role: 'owner' })

  const counts = await generate(userId, workspace.id, slug)

  return c.json({ workspace_id: workspace.id, counts }, 201)
})

// ---------------------------------------------------------------------------
// POST /reset — delete + regenerate sample data for an existing workspace.
// ---------------------------------------------------------------------------

const resetSchema = z.object({ workspace_id: z.string().min(1) })

router.post('/reset', zValidator('json', resetSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id } = c.req.valid('json')

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspace_id))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  if (ws.owner_id !== userId && !(await isMember(workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await purgeWorkspaceData(workspace_id)
  const counts = await generate(userId, workspace_id, ws.slug)

  return c.json({ workspace_id, counts })
})

export default router
