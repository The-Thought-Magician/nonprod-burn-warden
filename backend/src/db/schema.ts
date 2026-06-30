import { pgTable, text, integer, boolean, timestamp, jsonb, unique, real } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Workspaces & membership
// ---------------------------------------------------------------------------

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  owner_id: text('owner_id').notNull(),
  currency: text('currency').default('USD').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const workspace_members = pgTable('workspace_members', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  role: text('role').default('member').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.user_id)])

// ---------------------------------------------------------------------------
// Cloud accounts & resources
// ---------------------------------------------------------------------------

export const cloud_accounts = pgTable('cloud_accounts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  provider: text('provider').notNull(),
  account_ref: text('account_ref').notNull(),
  nickname: text('nickname').notNull(),
  default_region: text('default_region'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.provider, t.account_ref)])

export const resources = pgTable('resources', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  cloud_account_id: text('cloud_account_id').references(() => cloud_accounts.id),
  environment_id: text('environment_id').references(() => environments.id),
  team_id: text('team_id').references(() => teams.id),
  external_id: text('external_id').notNull(),
  name: text('name').notNull(),
  resource_type: text('resource_type').notNull(),
  service: text('service'),
  region: text('region'),
  provider: text('provider'),
  env_kind: text('env_kind').default('unknown').notNull(),
  classification_source: text('classification_source').default('unclassified').notNull(),
  classification_confidence: real('classification_confidence').default(0),
  tags: jsonb('tags').$type<Record<string, string>>().default({}),
  monthly_cost_cents: integer('monthly_cost_cents').default(0).notNull(),
  hourly_rate_cents: real('hourly_rate_cents').default(0).notNull(),
  first_seen_at: timestamp('first_seen_at').defaultNow().notNull(),
  last_active_at: timestamp('last_active_at'),
  is_active: boolean('is_active').default(true).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.external_id)])

// ---------------------------------------------------------------------------
// Environments & classification rules
// ---------------------------------------------------------------------------

export const environments = pgTable('environments', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  team_id: text('team_id').references(() => teams.id),
  name: text('name').notNull(),
  env_kind: text('env_kind').default('dev').notNull(),
  timezone: text('timezone').default('UTC').notNull(),
  holiday_calendar_id: text('holiday_calendar_id').references(() => holiday_calendars.id),
  schedule_id: text('schedule_id').references(() => schedules.id),
  description: text('description').default(''),
  is_production: boolean('is_production').default(false).notNull(),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.name)])

export const environment_rules = pgTable('environment_rules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  env_kind: text('env_kind').notNull(),
  match_type: text('match_type').notNull(),
  pattern: text('pattern').notNull(),
  priority: integer('priority').default(100).notNull(),
  is_active: boolean('is_active').default(true).notNull(),
  hit_count: integer('hit_count').default(0).notNull(),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const tag_rules = pgTable('tag_rules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  env_kind: text('env_kind').notNull(),
  tag_key: text('tag_key').notNull(),
  tag_value: text('tag_value').notNull(),
  priority: integer('priority').default(100).notNull(),
  is_active: boolean('is_active').default(true).notNull(),
  hit_count: integer('hit_count').default(0).notNull(),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Usage & cost
// ---------------------------------------------------------------------------

export const usage_samples = pgTable('usage_samples', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  resource_id: text('resource_id').notNull().references(() => resources.id),
  metric: text('metric').notNull(),
  value: real('value').notNull(),
  sampled_at: timestamp('sampled_at').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const cost_records = pgTable('cost_records', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  resource_id: text('resource_id').notNull().references(() => resources.id),
  period: text('period').notNull(),
  amount_cents: integer('amount_cents').notNull(),
  run_hours: real('run_hours').default(0).notNull(),
  currency: text('currency').default('USD').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.resource_id, t.period)])

// ---------------------------------------------------------------------------
// Idle detection & waste ledger
// ---------------------------------------------------------------------------

export const idle_windows = pgTable('idle_windows', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  resource_id: text('resource_id').notNull().references(() => resources.id),
  environment_id: text('environment_id').references(() => environments.id),
  start_at: timestamp('start_at').notNull(),
  end_at: timestamp('end_at').notNull(),
  duration_hours: real('duration_hours').notNull(),
  is_off_hours: boolean('is_off_hours').default(true).notNull(),
  wasted_cents: integer('wasted_cents').default(0).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const waste_ledger_entries = pgTable('waste_ledger_entries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  environment_id: text('environment_id').references(() => environments.id),
  resource_id: text('resource_id').references(() => resources.id),
  team_id: text('team_id').references(() => teams.id),
  period: text('period').notNull(),
  idle_hours: real('idle_hours').default(0).notNull(),
  off_hours_idle_hours: real('off_hours_idle_hours').default(0).notNull(),
  hourly_rate_cents: real('hourly_rate_cents').default(0).notNull(),
  wasted_cents: integer('wasted_cents').default(0).notNull(),
  breakdown: jsonb('breakdown').$type<Record<string, number>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Schedules, assignments, savings
// ---------------------------------------------------------------------------

export const schedules = pgTable('schedules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  description: text('description').default(''),
  windows: jsonb('windows').$type<Array<{ day: number; start_hour: number; end_hour: number }>>().default([]),
  treat_holidays_off: boolean('treat_holidays_off').default(true).notNull(),
  is_preset: boolean('is_preset').default(false).notNull(),
  effective_hours_per_week: real('effective_hours_per_week').default(168).notNull(),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const schedule_assignments = pgTable('schedule_assignments', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  schedule_id: text('schedule_id').notNull().references(() => schedules.id),
  environment_id: text('environment_id').references(() => environments.id),
  resource_id: text('resource_id').references(() => resources.id),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const savings_estimates = pgTable('savings_estimates', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  environment_id: text('environment_id').references(() => environments.id),
  schedule_id: text('schedule_id').references(() => schedules.id),
  hours_saved_per_week: real('hours_saved_per_week').default(0).notNull(),
  monthly_savings_cents: integer('monthly_savings_cents').default(0).notNull(),
  savings_pct: real('savings_pct').default(0).notNull(),
  current_monthly_cents: integer('current_monthly_cents').default(0).notNull(),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Orphans & recommendations
// ---------------------------------------------------------------------------

export const orphan_findings = pgTable('orphan_findings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  resource_id: text('resource_id').references(() => resources.id),
  environment_id: text('environment_id').references(() => environments.id),
  finding_type: text('finding_type').notNull(),
  reason: text('reason').notNull(),
  severity: text('severity').default('medium').notNull(),
  age_days: integer('age_days').default(0).notNull(),
  monthly_cost_cents: integer('monthly_cost_cents').default(0).notNull(),
  status: text('status').default('open').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const recommendations = pgTable('recommendations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  environment_id: text('environment_id').references(() => environments.id),
  schedule_id: text('schedule_id').references(() => schedules.id),
  orphan_finding_id: text('orphan_finding_id').references(() => orphan_findings.id),
  rec_type: text('rec_type').notNull(),
  title: text('title').notNull(),
  detail: text('detail').default(''),
  recoverable_cents: integer('recoverable_cents').default(0).notNull(),
  status: text('status').default('open').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Teams, budgets, showback
// ---------------------------------------------------------------------------

export const teams = pgTable('teams', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  lead_email: text('lead_email'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.name)])

export const team_budgets = pgTable('team_budgets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  team_id: text('team_id').notNull().references(() => teams.id),
  period: text('period').notNull(),
  budget_cents: integer('budget_cents').notNull(),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.team_id, t.period)])

export const showback_allocations = pgTable('showback_allocations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  team_id: text('team_id').references(() => teams.id),
  environment_id: text('environment_id').references(() => environments.id),
  period: text('period').notNull(),
  allocated_cents: integer('allocated_cents').default(0).notNull(),
  wasted_cents: integer('wasted_cents').default(0).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------

export const holiday_calendars = pgTable('holiday_calendars', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  region: text('region').default(''),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const holidays = pgTable('holidays', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  holiday_calendar_id: text('holiday_calendar_id').notNull().references(() => holiday_calendars.id),
  name: text('name').notNull(),
  date: text('date').notNull(),
  is_full_day: boolean('is_full_day').default(true).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const recovery_reports = pgTable('recovery_reports', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  period: text('period').notNull(),
  title: text('title').notNull(),
  total_spend_cents: integer('total_spend_cents').default(0).notNull(),
  nonprod_spend_cents: integer('nonprod_spend_cents').default(0).notNull(),
  idle_waste_cents: integer('idle_waste_cents').default(0).notNull(),
  recoverable_cents: integer('recoverable_cents').default(0).notNull(),
  recovered_cents: integer('recovered_cents').default(0).notNull(),
  share_token: text('share_token').notNull().unique(),
  summary: jsonb('summary').$type<Record<string, unknown>>().default({}),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const report_line_items = pgTable('report_line_items', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  recovery_report_id: text('recovery_report_id').notNull().references(() => recovery_reports.id),
  environment_id: text('environment_id').references(() => environments.id),
  team_id: text('team_id').references(() => teams.id),
  label: text('label').notNull(),
  spend_cents: integer('spend_cents').default(0).notNull(),
  waste_cents: integer('waste_cents').default(0).notNull(),
  recoverable_cents: integer('recoverable_cents').default(0).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

export const import_batches = pgTable('import_batches', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  cloud_account_id: text('cloud_account_id').references(() => cloud_accounts.id),
  kind: text('kind').notNull(),
  source: text('source').default('upload').notNull(),
  period: text('period'),
  row_count: integer('row_count').default(0).notNull(),
  error_count: integer('error_count').default(0).notNull(),
  status: text('status').default('completed').notNull(),
  errors: jsonb('errors').$type<string[]>().default([]),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Alerts & alert rules
// ---------------------------------------------------------------------------

export const alert_rules = pgTable('alert_rules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  rule_type: text('rule_type').notNull(),
  threshold_cents: integer('threshold_cents').default(0).notNull(),
  severity: text('severity').default('medium').notNull(),
  is_active: boolean('is_active').default(true).notNull(),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const alerts = pgTable('alerts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  alert_rule_id: text('alert_rule_id').references(() => alert_rules.id),
  environment_id: text('environment_id').references(() => environments.id),
  team_id: text('team_id').references(() => teams.id),
  severity: text('severity').default('medium').notNull(),
  message: text('message').notNull(),
  link: text('link').default(''),
  status: text('status').default('open').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Activity log & saved views
// ---------------------------------------------------------------------------

export const activity_log = pgTable('activity_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  actor_id: text('actor_id').notNull(),
  action: text('action').notNull(),
  entity_type: text('entity_type').notNull(),
  entity_id: text('entity_id'),
  detail: jsonb('detail').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const saved_views = pgTable('saved_views', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  target: text('target').notNull(),
  filters: jsonb('filters').$type<Record<string, unknown>>().default({}),
  is_default: boolean('is_default').default(false).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  price_cents: integer('price_cents').notNull(),
})

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().unique(),
  plan_id: text('plan_id').notNull().default('free'),
  stripe_customer_id: text('stripe_customer_id'),
  stripe_subscription_id: text('stripe_subscription_id'),
  status: text('status').notNull().default('active'),
  current_period_end: timestamp('current_period_end'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})
