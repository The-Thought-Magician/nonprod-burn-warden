import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { db } from './db/index.js'
import { migrate } from './db/migrate.js'
import {
  plans,
  workspaces,
  workspace_members,
  cloud_accounts,
  teams,
  environments,
  resources,
  schedules,
  holiday_calendars,
} from './db/schema.js'

import workspacesRoutes from './routes/workspaces.js'
import cloudAccountsRoutes from './routes/cloud-accounts.js'
import resourcesRoutes from './routes/resources.js'
import environmentsRoutes from './routes/environments.js'
import environmentRulesRoutes from './routes/environment-rules.js'
import tagRulesRoutes from './routes/tag-rules.js'
import usageRoutes from './routes/usage.js'
import costsRoutes from './routes/costs.js'
import idleRoutes from './routes/idle.js'
import ledgerRoutes from './routes/ledger.js'
import schedulesRoutes from './routes/schedules.js'
import savingsRoutes from './routes/savings.js'
import orphansRoutes from './routes/orphans.js'
import recommendationsRoutes from './routes/recommendations.js'
import teamsRoutes from './routes/teams.js'
import budgetsRoutes from './routes/budgets.js'
import showbackRoutes from './routes/showback.js'
import holidaysRoutes from './routes/holidays.js'
import reportsRoutes from './routes/reports.js'
import importsRoutes from './routes/imports.js'
import alertsRoutes from './routes/alerts.js'
import activityRoutes from './routes/activity.js'
import viewsRoutes from './routes/views.js'
import sampleRoutes from './routes/sample.js'
import statsRoutes from './routes/stats.js'
import billingRoutes from './routes/billing.js'

const app = new Hono()

const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:3000',
  'https://nonprod-burn-warden.vercel.app',
]

app.use('*', cors({
  origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
  credentials: true,
}))

const api = new Hono()
api.route('/workspaces', workspacesRoutes)
api.route('/cloud-accounts', cloudAccountsRoutes)
api.route('/resources', resourcesRoutes)
api.route('/environments', environmentsRoutes)
api.route('/environment-rules', environmentRulesRoutes)
api.route('/tag-rules', tagRulesRoutes)
api.route('/usage', usageRoutes)
api.route('/costs', costsRoutes)
api.route('/idle', idleRoutes)
api.route('/ledger', ledgerRoutes)
api.route('/schedules', schedulesRoutes)
api.route('/savings', savingsRoutes)
api.route('/orphans', orphansRoutes)
api.route('/recommendations', recommendationsRoutes)
api.route('/teams', teamsRoutes)
api.route('/budgets', budgetsRoutes)
api.route('/showback', showbackRoutes)
api.route('/holidays', holidaysRoutes)
api.route('/reports', reportsRoutes)
api.route('/imports', importsRoutes)
api.route('/alerts', alertsRoutes)
api.route('/activity', activityRoutes)
api.route('/views', viewsRoutes)
api.route('/sample', sampleRoutes)
api.route('/stats', statsRoutes)
api.route('/billing', billingRoutes)

app.route('/api/v1', api)
app.get('/health', (c) => c.json({ ok: true }))

// ---------------------------------------------------------------------------
// Seed (idempotent: count-then-insert). Seeds the billing plans and a small
// deterministic demo workspace so a fresh deploy renders non-empty.
// ---------------------------------------------------------------------------

const DEMO_OWNER = 'demo-user'
const DEMO_WORKSPACE_SLUG = 'demo'

async function seedIfEmpty() {
  // Plans
  const existingPlans = await db.select().from(plans).limit(1)
  if (existingPlans.length === 0) {
    await db.insert(plans).values([
      { id: 'free', name: 'Free', price_cents: 0 },
      { id: 'pro', name: 'Pro', price_cents: 4900 },
    ])
    console.log('Seeded plans')
  }

  // Demo workspace (only if no workspace with the demo slug exists)
  const existingWorkspaces = await db.select().from(workspaces).limit(1)
  if (existingWorkspaces.length === 0) {
    const [ws] = await db.insert(workspaces).values({
      name: 'Demo Org',
      slug: DEMO_WORKSPACE_SLUG,
      owner_id: DEMO_OWNER,
      currency: 'USD',
    }).returning()

    await db.insert(workspace_members).values({
      workspace_id: ws.id,
      user_id: DEMO_OWNER,
      role: 'owner',
    })

    const [team] = await db.insert(teams).values({
      workspace_id: ws.id,
      name: 'Platform',
      lead_email: 'platform@example.com',
      created_by: DEMO_OWNER,
    }).returning()

    const [account] = await db.insert(cloud_accounts).values({
      workspace_id: ws.id,
      provider: 'aws',
      account_ref: '000000000000',
      nickname: 'Demo AWS',
      default_region: 'us-east-1',
      created_by: DEMO_OWNER,
    }).returning()

    const [schedule] = await db.insert(schedules).values({
      workspace_id: ws.id,
      name: 'Business Hours (Mon-Fri 8-18)',
      description: 'Weekday daytime only',
      windows: [1, 2, 3, 4, 5].map((day) => ({ day, start_hour: 8, end_hour: 18 })),
      treat_holidays_off: true,
      is_preset: true,
      effective_hours_per_week: 50,
      created_by: DEMO_OWNER,
    }).returning()

    const [calendar] = await db.insert(holiday_calendars).values({
      workspace_id: ws.id,
      name: 'US Holidays',
      region: 'US',
      created_by: DEMO_OWNER,
    }).returning()

    const [devEnv] = await db.insert(environments).values({
      workspace_id: ws.id,
      team_id: team.id,
      name: 'dev',
      env_kind: 'dev',
      timezone: 'America/New_York',
      holiday_calendar_id: calendar.id,
      schedule_id: schedule.id,
      description: 'Shared development environment',
      is_production: false,
      created_by: DEMO_OWNER,
    }).returning()

    await db.insert(environments).values({
      workspace_id: ws.id,
      team_id: team.id,
      name: 'staging',
      env_kind: 'staging',
      timezone: 'America/New_York',
      holiday_calendar_id: calendar.id,
      schedule_id: schedule.id,
      description: 'Pre-production staging',
      is_production: false,
      created_by: DEMO_OWNER,
    })

    await db.insert(resources).values([
      {
        workspace_id: ws.id,
        cloud_account_id: account.id,
        environment_id: devEnv.id,
        team_id: team.id,
        external_id: 'i-demo-dev-001',
        name: 'dev-api-server',
        resource_type: 'ec2',
        service: 'compute',
        region: 'us-east-1',
        provider: 'aws',
        env_kind: 'dev',
        classification_source: 'seed',
        classification_confidence: 1,
        tags: { env: 'dev', team: 'platform' },
        monthly_cost_cents: 24000,
        hourly_rate_cents: 33,
      },
      {
        workspace_id: ws.id,
        cloud_account_id: account.id,
        environment_id: devEnv.id,
        team_id: team.id,
        external_id: 'db-demo-dev-001',
        name: 'dev-postgres',
        resource_type: 'rds',
        service: 'database',
        region: 'us-east-1',
        provider: 'aws',
        env_kind: 'dev',
        classification_source: 'seed',
        classification_confidence: 1,
        tags: { env: 'dev', team: 'platform' },
        monthly_cost_cents: 36000,
        hourly_rate_cents: 50,
      },
    ])

    console.log('Seeded demo workspace')
  }
}

// ---------------------------------------------------------------------------
// Boot order is load-bearing: bind the port FIRST so the platform health
// check sees a live service immediately, THEN run migrate + seed (both
// idempotent) wrapped in their own try/catch so a cold DB never blocks boot.
// ---------------------------------------------------------------------------

const port = parseInt(process.env.PORT ?? '3001')

serve({ fetch: app.fetch, port }, () => console.log(`Server running on port ${port}`))

;(async () => {
  try {
    await migrate()
  } catch (e) {
    console.error('Migrate error:', e)
  }
  try {
    await seedIfEmpty()
  } catch (e) {
    console.error('Seed error:', e)
  }
})()

export default app
