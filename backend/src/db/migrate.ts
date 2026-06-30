import { db } from './index.js'
import { sql } from 'drizzle-orm'

const statements: string[] = [
  `CREATE TABLE IF NOT EXISTS workspaces (
    id text PRIMARY KEY,
    name text NOT NULL,
    slug text NOT NULL UNIQUE,
    owner_id text NOT NULL,
    currency text NOT NULL DEFAULT 'USD',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS workspace_members (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    role text NOT NULL DEFAULT 'member',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
  )`,

  `CREATE TABLE IF NOT EXISTS cloud_accounts (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    provider text NOT NULL,
    account_ref text NOT NULL,
    nickname text NOT NULL,
    default_region text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, provider, account_ref)
  )`,

  `CREATE TABLE IF NOT EXISTS teams (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    lead_email text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, name)
  )`,

  `CREATE TABLE IF NOT EXISTS holiday_calendars (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    region text DEFAULT '',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS schedules (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    description text DEFAULT '',
    windows jsonb DEFAULT '[]'::jsonb,
    treat_holidays_off boolean NOT NULL DEFAULT true,
    is_preset boolean NOT NULL DEFAULT false,
    effective_hours_per_week real NOT NULL DEFAULT 168,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS environments (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    team_id text REFERENCES teams(id),
    name text NOT NULL,
    env_kind text NOT NULL DEFAULT 'dev',
    timezone text NOT NULL DEFAULT 'UTC',
    holiday_calendar_id text REFERENCES holiday_calendars(id),
    schedule_id text REFERENCES schedules(id),
    description text DEFAULT '',
    is_production boolean NOT NULL DEFAULT false,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, name)
  )`,

  `CREATE TABLE IF NOT EXISTS resources (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    cloud_account_id text REFERENCES cloud_accounts(id),
    environment_id text REFERENCES environments(id),
    team_id text REFERENCES teams(id),
    external_id text NOT NULL,
    name text NOT NULL,
    resource_type text NOT NULL,
    service text,
    region text,
    provider text,
    env_kind text NOT NULL DEFAULT 'unknown',
    classification_source text NOT NULL DEFAULT 'unclassified',
    classification_confidence real DEFAULT 0,
    tags jsonb DEFAULT '{}'::jsonb,
    monthly_cost_cents integer NOT NULL DEFAULT 0,
    hourly_rate_cents real NOT NULL DEFAULT 0,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_active_at timestamptz,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, external_id)
  )`,

  `CREATE TABLE IF NOT EXISTS environment_rules (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    env_kind text NOT NULL,
    match_type text NOT NULL,
    pattern text NOT NULL,
    priority integer NOT NULL DEFAULT 100,
    is_active boolean NOT NULL DEFAULT true,
    hit_count integer NOT NULL DEFAULT 0,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS tag_rules (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    env_kind text NOT NULL,
    tag_key text NOT NULL,
    tag_value text NOT NULL,
    priority integer NOT NULL DEFAULT 100,
    is_active boolean NOT NULL DEFAULT true,
    hit_count integer NOT NULL DEFAULT 0,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS usage_samples (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    resource_id text NOT NULL REFERENCES resources(id),
    metric text NOT NULL,
    value real NOT NULL,
    sampled_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS cost_records (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    resource_id text NOT NULL REFERENCES resources(id),
    period text NOT NULL,
    amount_cents integer NOT NULL,
    run_hours real NOT NULL DEFAULT 0,
    currency text NOT NULL DEFAULT 'USD',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (resource_id, period)
  )`,

  `CREATE TABLE IF NOT EXISTS idle_windows (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    resource_id text NOT NULL REFERENCES resources(id),
    environment_id text REFERENCES environments(id),
    start_at timestamptz NOT NULL,
    end_at timestamptz NOT NULL,
    duration_hours real NOT NULL,
    is_off_hours boolean NOT NULL DEFAULT true,
    wasted_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS waste_ledger_entries (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    environment_id text REFERENCES environments(id),
    resource_id text REFERENCES resources(id),
    team_id text REFERENCES teams(id),
    period text NOT NULL,
    idle_hours real NOT NULL DEFAULT 0,
    off_hours_idle_hours real NOT NULL DEFAULT 0,
    hourly_rate_cents real NOT NULL DEFAULT 0,
    wasted_cents integer NOT NULL DEFAULT 0,
    breakdown jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS schedule_assignments (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    schedule_id text NOT NULL REFERENCES schedules(id),
    environment_id text REFERENCES environments(id),
    resource_id text REFERENCES resources(id),
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS savings_estimates (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    environment_id text REFERENCES environments(id),
    schedule_id text REFERENCES schedules(id),
    hours_saved_per_week real NOT NULL DEFAULT 0,
    monthly_savings_cents integer NOT NULL DEFAULT 0,
    savings_pct real NOT NULL DEFAULT 0,
    current_monthly_cents integer NOT NULL DEFAULT 0,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS orphan_findings (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    resource_id text REFERENCES resources(id),
    environment_id text REFERENCES environments(id),
    finding_type text NOT NULL,
    reason text NOT NULL,
    severity text NOT NULL DEFAULT 'medium',
    age_days integer NOT NULL DEFAULT 0,
    monthly_cost_cents integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'open',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS recommendations (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    environment_id text REFERENCES environments(id),
    schedule_id text REFERENCES schedules(id),
    orphan_finding_id text REFERENCES orphan_findings(id),
    rec_type text NOT NULL,
    title text NOT NULL,
    detail text DEFAULT '',
    recoverable_cents integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'open',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS team_budgets (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    team_id text NOT NULL REFERENCES teams(id),
    period text NOT NULL,
    budget_cents integer NOT NULL,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (team_id, period)
  )`,

  `CREATE TABLE IF NOT EXISTS showback_allocations (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    team_id text REFERENCES teams(id),
    environment_id text REFERENCES environments(id),
    period text NOT NULL,
    allocated_cents integer NOT NULL DEFAULT 0,
    wasted_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS holidays (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    holiday_calendar_id text NOT NULL REFERENCES holiday_calendars(id),
    name text NOT NULL,
    date text NOT NULL,
    is_full_day boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS recovery_reports (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    period text NOT NULL,
    title text NOT NULL,
    total_spend_cents integer NOT NULL DEFAULT 0,
    nonprod_spend_cents integer NOT NULL DEFAULT 0,
    idle_waste_cents integer NOT NULL DEFAULT 0,
    recoverable_cents integer NOT NULL DEFAULT 0,
    recovered_cents integer NOT NULL DEFAULT 0,
    share_token text NOT NULL UNIQUE,
    summary jsonb DEFAULT '{}'::jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS report_line_items (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    recovery_report_id text NOT NULL REFERENCES recovery_reports(id),
    environment_id text REFERENCES environments(id),
    team_id text REFERENCES teams(id),
    label text NOT NULL,
    spend_cents integer NOT NULL DEFAULT 0,
    waste_cents integer NOT NULL DEFAULT 0,
    recoverable_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS import_batches (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    cloud_account_id text REFERENCES cloud_accounts(id),
    kind text NOT NULL,
    source text NOT NULL DEFAULT 'upload',
    period text,
    row_count integer NOT NULL DEFAULT 0,
    error_count integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'completed',
    errors jsonb DEFAULT '[]'::jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS alert_rules (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    rule_type text NOT NULL,
    threshold_cents integer NOT NULL DEFAULT 0,
    severity text NOT NULL DEFAULT 'medium',
    is_active boolean NOT NULL DEFAULT true,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS alerts (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    alert_rule_id text REFERENCES alert_rules(id),
    environment_id text REFERENCES environments(id),
    team_id text REFERENCES teams(id),
    severity text NOT NULL DEFAULT 'medium',
    message text NOT NULL,
    link text DEFAULT '',
    status text NOT NULL DEFAULT 'open',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS activity_log (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    actor_id text NOT NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    detail jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS saved_views (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    name text NOT NULL,
    target text NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb,
    is_default boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS plans (
    id text PRIMARY KEY,
    name text NOT NULL,
    price_cents integer NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS subscriptions (
    id text PRIMARY KEY,
    user_id text NOT NULL UNIQUE,
    plan_id text NOT NULL DEFAULT 'free',
    stripe_customer_id text,
    stripe_subscription_id text,
    status text NOT NULL DEFAULT 'active',
    current_period_end timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
]

const indexes: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cloud_accounts_workspace ON cloud_accounts(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_resources_workspace ON resources(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_resources_environment ON resources(environment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_resources_team ON resources(team_id)`,
  `CREATE INDEX IF NOT EXISTS idx_resources_account ON resources(cloud_account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_environments_workspace ON environments(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_environments_team ON environments(team_id)`,
  `CREATE INDEX IF NOT EXISTS idx_environment_rules_workspace ON environment_rules(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tag_rules_workspace ON tag_rules(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_usage_samples_workspace ON usage_samples(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_usage_samples_resource ON usage_samples(resource_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cost_records_workspace ON cost_records(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cost_records_resource ON cost_records(resource_id)`,
  `CREATE INDEX IF NOT EXISTS idx_idle_windows_workspace ON idle_windows(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_idle_windows_resource ON idle_windows(resource_id)`,
  `CREATE INDEX IF NOT EXISTS idx_idle_windows_environment ON idle_windows(environment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_waste_ledger_workspace ON waste_ledger_entries(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_waste_ledger_environment ON waste_ledger_entries(environment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_waste_ledger_team ON waste_ledger_entries(team_id)`,
  `CREATE INDEX IF NOT EXISTS idx_schedules_workspace ON schedules(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_schedule_assignments_workspace ON schedule_assignments(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_schedule_assignments_schedule ON schedule_assignments(schedule_id)`,
  `CREATE INDEX IF NOT EXISTS idx_schedule_assignments_environment ON schedule_assignments(environment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_savings_estimates_workspace ON savings_estimates(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_savings_estimates_environment ON savings_estimates(environment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orphan_findings_workspace ON orphan_findings(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_recommendations_workspace ON recommendations(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_teams_workspace ON teams(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_team_budgets_workspace ON team_budgets(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_team_budgets_team ON team_budgets(team_id)`,
  `CREATE INDEX IF NOT EXISTS idx_showback_workspace ON showback_allocations(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_showback_team ON showback_allocations(team_id)`,
  `CREATE INDEX IF NOT EXISTS idx_holiday_calendars_workspace ON holiday_calendars(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_holidays_workspace ON holidays(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_holidays_calendar ON holidays(holiday_calendar_id)`,
  `CREATE INDEX IF NOT EXISTS idx_recovery_reports_workspace ON recovery_reports(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_report_line_items_workspace ON report_line_items(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_report_line_items_report ON report_line_items(recovery_report_id)`,
  `CREATE INDEX IF NOT EXISTS idx_import_batches_workspace ON import_batches(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_alert_rules_workspace ON alert_rules(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_workspace ON alerts(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_log_workspace ON activity_log(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_saved_views_workspace ON saved_views(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_saved_views_user ON saved_views(user_id)`,
]

export async function migrate() {
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt))
  }
  for (const idx of indexes) {
    await db.execute(sql.raw(idx))
  }
  console.log('Migration complete')
}
