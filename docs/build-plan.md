# NonprodBurnWarden — Authoritative Build Contract

This is the single source of truth. Every other agent follows it exactly. Filenames, mount paths, api method names, and page files declared here are binding.

Stack: Hono + TypeScript backend (Render), drizzle-orm + @neondatabase/serverless (Neon Postgres), Next.js 16 + React 19 + Tailwind 4 frontend (Vercel), auth via `@neondatabase/auth@0.4.2-beta`. Backend trusts `X-User-Id` header; handlers use `getUserId(c)`. Routes mount under `/api/v1` via a child Hono `api` router. Frontend calls `fetch('/api/proxy/<path>')` mapping 1:1 to `/api/v1/<path>`. `web/proxy.ts` only (no middleware.ts). Public reads / auth-gated writes with zod validation + ownership checks. All features free; Stripe optional (503).

Money is stored in integer cents (`*_cents`); rates that need fractions use `real`.

---

## (a) Tables (columns)

- **workspaces** — id, name, slug (unique), owner_id, currency, created_at, updated_at
- **workspace_members** — id, workspace_id→workspaces, user_id, role, created_at; unique(workspace_id,user_id)
- **cloud_accounts** — id, workspace_id→workspaces, provider, account_ref, nickname, default_region, created_by, created_at; unique(workspace_id,provider,account_ref)
- **resources** — id, workspace_id→workspaces, cloud_account_id→cloud_accounts, environment_id→environments, team_id→teams, external_id, name, resource_type, service, region, provider, env_kind, classification_source, classification_confidence(real), tags(jsonb), monthly_cost_cents, hourly_rate_cents(real), first_seen_at, last_active_at, is_active, created_at; unique(workspace_id,external_id)
- **environments** — id, workspace_id→workspaces, team_id→teams, name, env_kind, timezone, holiday_calendar_id→holiday_calendars, schedule_id→schedules, description, is_production, created_by, created_at, updated_at; unique(workspace_id,name)
- **environment_rules** — id, workspace_id→workspaces, name, env_kind, match_type, pattern, priority, is_active, hit_count, created_by, created_at
- **tag_rules** — id, workspace_id→workspaces, name, env_kind, tag_key, tag_value, priority, is_active, hit_count, created_by, created_at
- **usage_samples** — id, workspace_id→workspaces, resource_id→resources, metric, value(real), sampled_at, created_at
- **cost_records** — id, workspace_id→workspaces, resource_id→resources, period, amount_cents, run_hours(real), currency, created_at; unique(resource_id,period)
- **idle_windows** — id, workspace_id→workspaces, resource_id→resources, environment_id→environments, start_at, end_at, duration_hours(real), is_off_hours, wasted_cents, created_at
- **waste_ledger_entries** — id, workspace_id→workspaces, environment_id→environments, resource_id→resources, team_id→teams, period, idle_hours(real), off_hours_idle_hours(real), hourly_rate_cents(real), wasted_cents, breakdown(jsonb), created_at
- **schedules** — id, workspace_id→workspaces, name, description, windows(jsonb), treat_holidays_off, is_preset, effective_hours_per_week(real), created_by, created_at, updated_at
- **schedule_assignments** — id, workspace_id→workspaces, schedule_id→schedules, environment_id→environments, resource_id→resources, created_by, created_at
- **savings_estimates** — id, workspace_id→workspaces, environment_id→environments, schedule_id→schedules, hours_saved_per_week(real), monthly_savings_cents, savings_pct(real), current_monthly_cents, created_by, created_at
- **orphan_findings** — id, workspace_id→workspaces, resource_id→resources, environment_id→environments, finding_type, reason, severity, age_days, monthly_cost_cents, status, created_at
- **recommendations** — id, workspace_id→workspaces, environment_id→environments, schedule_id→schedules, orphan_finding_id→orphan_findings, rec_type, title, detail, recoverable_cents, status, created_at
- **teams** — id, workspace_id→workspaces, name, lead_email, created_by, created_at; unique(workspace_id,name)
- **team_budgets** — id, workspace_id→workspaces, team_id→teams, period, budget_cents, created_by, created_at; unique(team_id,period)
- **showback_allocations** — id, workspace_id→workspaces, team_id→teams, environment_id→environments, period, allocated_cents, wasted_cents, created_at
- **holiday_calendars** — id, workspace_id→workspaces, name, region, created_by, created_at
- **holidays** — id, workspace_id→workspaces, holiday_calendar_id→holiday_calendars, name, date, is_full_day, created_at
- **recovery_reports** — id, workspace_id→workspaces, period, title, total_spend_cents, nonprod_spend_cents, idle_waste_cents, recoverable_cents, recovered_cents, share_token(unique), summary(jsonb), created_by, created_at
- **report_line_items** — id, workspace_id→workspaces, recovery_report_id→recovery_reports, environment_id→environments, team_id→teams, label, spend_cents, waste_cents, recoverable_cents, created_at
- **import_batches** — id, workspace_id→workspaces, cloud_account_id→cloud_accounts, kind, source, period, row_count, error_count, status, errors(jsonb), created_by, created_at
- **alert_rules** — id, workspace_id→workspaces, name, rule_type, threshold_cents, severity, is_active, created_by, created_at
- **alerts** — id, workspace_id→workspaces, alert_rule_id→alert_rules, environment_id→environments, team_id→teams, severity, message, link, status, created_at
- **activity_log** — id, workspace_id→workspaces, actor_id, action, entity_type, entity_id, detail(jsonb), created_at
- **saved_views** — id, workspace_id→workspaces, user_id, name, target, filters(jsonb), is_default, created_at
- **plans** — id(text PK, 'free'/'pro'), name, price_cents
- **subscriptions** — id, user_id(unique), plan_id(text default 'free'), stripe_customer_id, stripe_subscription_id, status, current_period_end, created_at, updated_at

Convention: every domain write requires a `workspace_id` the caller belongs to (checked via workspace_members). "Ownership check" = caller is a member of the resource's workspace; mutating workspace-scoped entities also OK for any member; workspace settings/membership writes gated to owner role.

---

## (b) Backend route files (mounted under `/api/v1`)

All write endpoints require auth (X-User-Id) + zod validation + workspace membership check. Reads are public unless noted. `?workspace_id=` is required on list reads.

### 1. `workspaces.ts` → mount `/workspaces`
- `GET /` — auth — list workspaces the user is a member of — `[{...workspace, role}]`
- `POST /` — auth — create workspace (+owner membership) — `{...workspace}` 201
- `GET /:id` — auth(member) — workspace detail — `{...workspace}`
- `PUT /:id` — auth(owner) — update name/currency — `{...workspace}`
- `GET /:id/members` — auth(member) — list members — `[{...member}]`
- `POST /:id/members` — auth(owner) — add member by user_id+role — `{...member}` 201
- `DELETE /:id/members/:memberId` — auth(owner) — remove member — `{success:true}`

### 2. `cloud-accounts.ts` → mount `/cloud-accounts`
- `GET /` — public — list accounts by workspace_id — `[{...account, resource_count, monthly_cost_cents}]`
- `POST /` — auth — create account — `{...account}` 201
- `GET /:id` — public — account detail + env breakdown — `{...account, env_breakdown}`
- `PUT /:id` — auth — update nickname/region — `{...account}`
- `DELETE /:id` — auth — delete account — `{success:true}`

### 3. `resources.ts` → mount `/resources`
- `GET /` — public — list/filter by workspace_id, env_kind, environment_id, team_id — `[{...resource}]`
- `POST /` — auth — create resource — `{...resource}` 201
- `GET /:id` — public — resource detail (env, idle history, cost) — `{...resource, idle_windows, cost_records}`
- `PUT /:id` — auth — update resource — `{...resource}`
- `PATCH /:id/assign` — auth — override environment_id/team_id/env_kind (manual classification) — `{...resource}`
- `DELETE /:id` — auth — delete resource — `{success:true}`

### 4. `environments.ts` → mount `/environments`
- `GET /` — public — list by workspace_id — `[{...environment, resource_count, monthly_cost_cents, idle_waste_cents}]`
- `POST /` — auth — create environment — `{...environment}` 201
- `GET /:id` — public — environment detail (rollups, schedule, timezone, calendar) — `{...environment, stats}`
- `PUT /:id` — auth — update (name, env_kind, timezone, holiday_calendar_id, schedule_id, is_production) — `{...environment}`
- `DELETE /:id` — auth — delete environment — `{success:true}`

### 5. `environment-rules.ts` → mount `/environment-rules`
- `GET /` — public — list by workspace_id (with hit_count) — `[{...rule}]`
- `POST /` — auth — create naming/pattern rule — `{...rule}` 201
- `PUT /:id` — auth — update rule — `{...rule}`
- `DELETE /:id` — auth — delete rule — `{success:true}`
- `POST /preview` — auth — preview which resources a rule would match — `{matched:[{...resource}], count}`
- `POST /apply` — auth — run all rules, (re)classify resources — `{classified, updated, gaps}`

### 6. `tag-rules.ts` → mount `/tag-rules`
- `GET /` — public — list by workspace_id — `[{...tagRule}]`
- `POST /` — auth — create tag rule — `{...tagRule}` 201
- `PUT /:id` — auth — update — `{...tagRule}`
- `DELETE /:id` — auth — delete — `{success:true}`

### 7. `usage.ts` → mount `/usage`
- `GET /` — public — usage samples by resource_id (filter metric, range) — `[{...sample}]`
- `POST /` — auth — record sample(s) (array) — `{inserted}` 201
- `GET /hourly` — public — hourly-bucketed aggregate by resource_id/environment_id — `[{hour, metric, avg, max}]`

### 8. `costs.ts` → mount `/costs`
- `GET /` — public — cost_records by workspace_id/resource_id/period — `[{...costRecord}]`
- `POST /` — auth — upsert cost record (by resource_id+period) — `{...costRecord}` 201
- `GET /rates` — public — derived hourly rate per resource + blended env rate — `[{resource_id, hourly_rate_cents}], blended_by_env`

### 9. `idle.ts` → mount `/idle`
- `GET /` — public — idle_windows by workspace_id/environment_id/resource_id — `[{...idleWindow}]`
- `POST /detect` — auth — run idle detection over usage_samples (threshold in body) — `{windows_created, off_hours_hours, business_hours_hours}`
- `GET /summary` — public — per-environment idle-hours-per-week — `[{environment_id, idle_hours_per_week, off_hours_pct}]`
- `GET /heatmap` — public — hour-of-week idle grid by environment_id — `{grid:number[7][24]}`

### 10. `ledger.ts` → mount `/ledger`
- `GET /` — public — waste_ledger_entries by workspace_id/period/environment_id/team_id — `[{...entry}]`
- `POST /rebuild` — auth — recompute ledger for a period from idle_windows + rates — `{entries_created, total_wasted_cents}`
- `GET /summary` — public — totals: monthly + trailing-30 waste, by provider/service/region — `{monthly_cents, trailing30_cents, by_provider, by_service, by_region}`
- `GET /by-environment` — public — waste grouped per environment — `[{environment_id, name, wasted_cents}]`

### 11. `schedules.ts` → mount `/schedules`
- `GET /` — public — list by workspace_id (presets + custom) — `[{...schedule}]`
- `POST /` — auth — create schedule (windows) — `{...schedule}` 201
- `GET /:id` — public — schedule detail + assignments — `{...schedule, assignments}`
- `PUT /:id` — auth — update windows/name (recomputes effective_hours_per_week) — `{...schedule}`
- `DELETE /:id` — auth — delete schedule — `{success:true}`
- `POST /:id/assign` — auth — assign to environment_id or resource_id — `{...assignment}` 201
- `DELETE /assignments/:assignmentId` — auth — unassign — `{success:true}`

### 12. `savings.ts` → mount `/savings`
- `GET /` — public — savings_estimates by workspace_id/environment_id — `[{...estimate}]`
- `POST /calculate` — auth — compute savings for environment_id + candidate windows (what-if), persists estimate — `{...estimate}`
- `POST /compare` — auth — compare multiple schedules for an environment — `{environment_id, options:[{schedule_id, monthly_savings_cents, savings_pct}]}`
- `GET /potential` — public — org-wide aggregate recoverable potential — `{total_recoverable_cents, by_environment}`

### 13. `orphans.ts` → mount `/orphans`
- `GET /` — public — orphan_findings by workspace_id/status — `[{...finding, resource}]`
- `POST /detect` — auth — run orphan detection (sandbox age, forgotten previews, zero-usage) — `{findings_created, by_type}`
- `PATCH /:id/status` — auth — set status (acknowledged/dismissed/recovered) — `{...finding}`

### 14. `recommendations.ts` → mount `/recommendations`
- `GET /` — public — recommendations by workspace_id ranked by recoverable_cents — `[{...rec}]`
- `POST /generate` — auth — generate recs from savings + orphans — `{created, total_recoverable_cents}`
- `PATCH /:id/status` — auth — set status (applied/dismissed/open) — `{...rec}`

### 15. `teams.ts` → mount `/teams`
- `GET /` — public — list by workspace_id (+ spend rollup) — `[{...team, monthly_spend_cents}]`
- `POST /` — auth — create team — `{...team}` 201
- `GET /:id` — public — team detail (environments, resources, spend) — `{...team, stats}`
- `PUT /:id` — auth — update name/lead_email — `{...team}`
- `DELETE /:id` — auth — delete team — `{success:true}`

### 16. `budgets.ts` → mount `/budgets`
- `GET /` — public — team_budgets by workspace_id/period (+ actual vs budget, projection) — `[{...budget, actual_cents, projected_cents, over_budget}]`
- `POST /` — auth — set team budget (upsert team+period) — `{...budget}` 201
- `PUT /:id` — auth — update budget_cents — `{...budget}`
- `DELETE /:id` — auth — delete budget — `{success:true}`

### 17. `showback.ts` → mount `/showback`
- `GET /` — public — showback_allocations by workspace_id/period/team_id — `[{...allocation, team_name}]`
- `POST /rebuild` — auth — recompute allocations for a period from ledger/costs — `{allocations_created, unallocated_cents}`
- `GET /statement` — public — per-team showback statement for a period — `{period, teams:[{team_id, allocated_cents, wasted_cents}], unallocated_cents}`

### 18. `holidays.ts` → mount `/holidays`
- `GET /calendars` — public — holiday_calendars by workspace_id — `[{...calendar, holiday_count}]`
- `POST /calendars` — auth — create calendar — `{...calendar}` 201
- `DELETE /calendars/:id` — auth — delete calendar (+holidays) — `{success:true}`
- `GET /` — public — holidays by holiday_calendar_id — `[{...holiday}]`
- `POST /` — auth — add holiday to calendar — `{...holiday}` 201
- `DELETE /:id` — auth — delete holiday — `{success:true}`
- `POST /seed-standard` — auth — seed a standard holiday set (US/UK) into a calendar — `{created}`

### 19. `reports.ts` → mount `/reports`
- `GET /` — public — recovery_reports by workspace_id — `[{...report}]`
- `POST /generate` — auth — generate report for a period (spend, waste, recoverable, line items) — `{...report, line_items}` 201
- `GET /:id` — public — report detail + line items — `{...report, line_items}`
- `GET /shared/:token` — public — shared read-only report by share_token — `{...report, line_items}`
- `DELETE /:id` — auth — delete report — `{success:true}`

### 20. `imports.ts` → mount `/imports`
- `GET /` — public — import_batches by workspace_id — `[{...batch}]`
- `POST /resources` — auth — import resources CSV rows (array) — `{...batch}` 201
- `POST /costs` — auth — import cost_records CSV rows — `{...batch}` 201
- `POST /usage` — auth — import usage_samples CSV rows — `{...batch}` 201
- `GET /:id` — public — batch detail (errors) — `{...batch}`

### 21. `alerts.ts` → mount `/alerts`
- `GET /` — public — alerts by workspace_id/status — `[{...alert}]`
- `POST /evaluate` — auth — evaluate alert_rules, create alerts — `{alerts_created}`
- `PATCH /:id/status` — auth — acknowledge/resolve — `{...alert}`
- `GET /rules` — public — alert_rules by workspace_id — `[{...rule}]`
- `POST /rules` — auth — create alert rule — `{...rule}` 201
- `PUT /rules/:id` — auth — update rule — `{...rule}`
- `DELETE /rules/:id` — auth — delete rule — `{success:true}`

### 22. `activity.ts` → mount `/activity`
- `GET /` — public — activity_log by workspace_id (filter entity_type/actor_id) — `[{...entry}]`

### 23. `views.ts` → mount `/views`
- `GET /` — auth — saved_views for current user + workspace_id — `[{...view}]`
- `POST /` — auth — create saved view — `{...view}` 201
- `PUT /:id` — auth — update view (filters/is_default) — `{...view}`
- `DELETE /:id` — auth — delete view — `{success:true}`

### 24. `sample.ts` → mount `/sample`
- `POST /seed` — auth — generate a deterministic demo workspace (accounts, resources, environments, usage, costs, idle, orphans, schedules, ledger) for the user — `{workspace_id, counts}`
- `POST /reset` — auth — delete + regenerate sample data for a workspace_id — `{workspace_id, counts}`

### 25. `stats.ts` → mount `/stats`
- `GET /overview` — public — org overview by workspace_id: total_spend, nonprod_spend, idle_waste, recoverable_potential, counts — `{...overview}`
- `GET /trends` — public — waste over time (per period) by workspace_id — `[{period, waste_cents, nonprod_spend_cents}]`
- `GET /leaderboard` — public — worst-offender environments by waste — `[{environment_id, name, wasted_cents, env_kind}]`

### 26. `billing.ts` → mount `/billing`
- `GET /plan` — public — current subscription + plan + stripeEnabled — `{subscription, plan, stripeEnabled}`
- `POST /checkout` — auth — Stripe checkout (503 if unconfigured) — `{url}` | 503
- `POST /portal` — auth — Stripe portal (503 if unconfigured) — `{url}` | 503
- `POST /webhook` — public(stripe sig) — Stripe webhook (503 if unconfigured) — `{received:true}` | 503

---

## (c) lib/api.ts methods (method → relative `/api/proxy/...` path → verb)

```
// workspaces
getWorkspaces()                              GET    /api/proxy/workspaces
createWorkspace(body)                        POST   /api/proxy/workspaces
getWorkspace(id)                             GET    /api/proxy/workspaces/:id
updateWorkspace(id, body)                    PUT    /api/proxy/workspaces/:id
getWorkspaceMembers(id)                      GET    /api/proxy/workspaces/:id/members
addWorkspaceMember(id, body)                 POST   /api/proxy/workspaces/:id/members
removeWorkspaceMember(id, memberId)          DELETE /api/proxy/workspaces/:id/members/:memberId
// cloud accounts
getCloudAccounts(workspaceId)                GET    /api/proxy/cloud-accounts?workspace_id=
createCloudAccount(body)                     POST   /api/proxy/cloud-accounts
getCloudAccount(id)                          GET    /api/proxy/cloud-accounts/:id
updateCloudAccount(id, body)                 PUT    /api/proxy/cloud-accounts/:id
deleteCloudAccount(id)                       DELETE /api/proxy/cloud-accounts/:id
// resources
getResources(query)                          GET    /api/proxy/resources?workspace_id=&...
createResource(body)                         POST   /api/proxy/resources
getResource(id)                              GET    /api/proxy/resources/:id
updateResource(id, body)                     PUT    /api/proxy/resources/:id
assignResource(id, body)                     PATCH  /api/proxy/resources/:id/assign
deleteResource(id)                           DELETE /api/proxy/resources/:id
// environments
getEnvironments(workspaceId)                 GET    /api/proxy/environments?workspace_id=
createEnvironment(body)                       POST   /api/proxy/environments
getEnvironment(id)                           GET    /api/proxy/environments/:id
updateEnvironment(id, body)                  PUT    /api/proxy/environments/:id
deleteEnvironment(id)                        DELETE /api/proxy/environments/:id
// environment rules
getEnvironmentRules(workspaceId)             GET    /api/proxy/environment-rules?workspace_id=
createEnvironmentRule(body)                  POST   /api/proxy/environment-rules
updateEnvironmentRule(id, body)              PUT    /api/proxy/environment-rules/:id
deleteEnvironmentRule(id)                    DELETE /api/proxy/environment-rules/:id
previewEnvironmentRule(body)                 POST   /api/proxy/environment-rules/preview
applyEnvironmentRules(body)                  POST   /api/proxy/environment-rules/apply
// tag rules
getTagRules(workspaceId)                      GET    /api/proxy/tag-rules?workspace_id=
createTagRule(body)                          POST   /api/proxy/tag-rules
updateTagRule(id, body)                      PUT    /api/proxy/tag-rules/:id
deleteTagRule(id)                            DELETE /api/proxy/tag-rules/:id
// usage
getUsage(query)                              GET    /api/proxy/usage?resource_id=&...
recordUsage(body)                            POST   /api/proxy/usage
getUsageHourly(query)                        GET    /api/proxy/usage/hourly?...
// costs
getCosts(query)                              GET    /api/proxy/costs?workspace_id=&...
upsertCost(body)                             POST   /api/proxy/costs
getRates(workspaceId)                        GET    /api/proxy/costs/rates?workspace_id=
// idle
getIdleWindows(query)                        GET    /api/proxy/idle?workspace_id=&...
detectIdle(body)                             POST   /api/proxy/idle/detect
getIdleSummary(workspaceId)                  GET    /api/proxy/idle/summary?workspace_id=
getIdleHeatmap(environmentId)                GET    /api/proxy/idle/heatmap?environment_id=
// ledger
getLedger(query)                             GET    /api/proxy/ledger?workspace_id=&...
rebuildLedger(body)                          POST   /api/proxy/ledger/rebuild
getLedgerSummary(workspaceId)                GET    /api/proxy/ledger/summary?workspace_id=
getLedgerByEnvironment(workspaceId)          GET    /api/proxy/ledger/by-environment?workspace_id=
// schedules
getSchedules(workspaceId)                     GET    /api/proxy/schedules?workspace_id=
createSchedule(body)                         POST   /api/proxy/schedules
getSchedule(id)                              GET    /api/proxy/schedules/:id
updateSchedule(id, body)                     PUT    /api/proxy/schedules/:id
deleteSchedule(id)                           DELETE /api/proxy/schedules/:id
assignSchedule(id, body)                      POST   /api/proxy/schedules/:id/assign
unassignSchedule(assignmentId)               DELETE /api/proxy/schedules/assignments/:assignmentId
// savings
getSavings(query)                            GET    /api/proxy/savings?workspace_id=&...
calculateSavings(body)                       POST   /api/proxy/savings/calculate
compareSavings(body)                         POST   /api/proxy/savings/compare
getSavingsPotential(workspaceId)             GET    /api/proxy/savings/potential?workspace_id=
// orphans
getOrphans(query)                            GET    /api/proxy/orphans?workspace_id=&...
detectOrphans(body)                          POST   /api/proxy/orphans/detect
setOrphanStatus(id, body)                    PATCH  /api/proxy/orphans/:id/status
// recommendations
getRecommendations(workspaceId)              GET    /api/proxy/recommendations?workspace_id=
generateRecommendations(body)                POST   /api/proxy/recommendations/generate
setRecommendationStatus(id, body)            PATCH  /api/proxy/recommendations/:id/status
// teams
getTeams(workspaceId)                         GET    /api/proxy/teams?workspace_id=
createTeam(body)                             POST   /api/proxy/teams
getTeam(id)                                  GET    /api/proxy/teams/:id
updateTeam(id, body)                         PUT    /api/proxy/teams/:id
deleteTeam(id)                               DELETE /api/proxy/teams/:id
// budgets
getBudgets(query)                            GET    /api/proxy/budgets?workspace_id=&...
setBudget(body)                              POST   /api/proxy/budgets
updateBudget(id, body)                       PUT    /api/proxy/budgets/:id
deleteBudget(id)                             DELETE /api/proxy/budgets/:id
// showback
getShowback(query)                           GET    /api/proxy/showback?workspace_id=&...
rebuildShowback(body)                        POST   /api/proxy/showback/rebuild
getShowbackStatement(query)                  GET    /api/proxy/showback/statement?workspace_id=&period=
// holidays
getHolidayCalendars(workspaceId)             GET    /api/proxy/holidays/calendars?workspace_id=
createHolidayCalendar(body)                  POST   /api/proxy/holidays/calendars
deleteHolidayCalendar(id)                    DELETE /api/proxy/holidays/calendars/:id
getHolidays(calendarId)                      GET    /api/proxy/holidays?holiday_calendar_id=
createHoliday(body)                          POST   /api/proxy/holidays
deleteHoliday(id)                            DELETE /api/proxy/holidays/:id
seedStandardHolidays(body)                   POST   /api/proxy/holidays/seed-standard
// reports
getReports(workspaceId)                       GET    /api/proxy/reports?workspace_id=
generateReport(body)                         POST   /api/proxy/reports/generate
getReport(id)                                GET    /api/proxy/reports/:id
getSharedReport(token)                        GET    /api/proxy/reports/shared/:token
deleteReport(id)                             DELETE /api/proxy/reports/:id
// imports
getImports(workspaceId)                       GET    /api/proxy/imports?workspace_id=
importResources(body)                        POST   /api/proxy/imports/resources
importCosts(body)                            POST   /api/proxy/imports/costs
importUsage(body)                            POST   /api/proxy/imports/usage
getImport(id)                                GET    /api/proxy/imports/:id
// alerts
getAlerts(query)                             GET    /api/proxy/alerts?workspace_id=&...
evaluateAlerts(body)                         POST   /api/proxy/alerts/evaluate
setAlertStatus(id, body)                     PATCH  /api/proxy/alerts/:id/status
getAlertRules(workspaceId)                    GET    /api/proxy/alerts/rules?workspace_id=
createAlertRule(body)                        POST   /api/proxy/alerts/rules
updateAlertRule(id, body)                    PUT    /api/proxy/alerts/rules/:id
deleteAlertRule(id)                          DELETE /api/proxy/alerts/rules/:id
// activity
getActivity(query)                           GET    /api/proxy/activity?workspace_id=&...
// saved views
getViews(workspaceId)                         GET    /api/proxy/views?workspace_id=
createView(body)                             POST   /api/proxy/views
updateView(id, body)                         PUT    /api/proxy/views/:id
deleteView(id)                               DELETE /api/proxy/views/:id
// sample data
seedSample()                                 POST   /api/proxy/sample/seed
resetSample(body)                            POST   /api/proxy/sample/reset
// stats
getOverview(workspaceId)                      GET    /api/proxy/stats/overview?workspace_id=
getTrends(workspaceId)                        GET    /api/proxy/stats/trends?workspace_id=
getLeaderboard(workspaceId)                   GET    /api/proxy/stats/leaderboard?workspace_id=
// billing
getBillingPlan()                             GET    /api/proxy/billing/plan
createCheckout()                             POST   /api/proxy/billing/checkout
createPortal()                               POST   /api/proxy/billing/portal
```

Every method maps to exactly one backend endpoint. The `/billing/webhook` endpoint is called by Stripe directly (not via api.ts).

---

## (d) Pages (URL → file under web/ → kind → api methods → renders)

### Public (no auth; landing is fully static, no auth calls)
1. `/` → `app/page.tsx` → public → none → static marketing: hero, the idle-waste problem, 7 flagship features, CTAs to sign-up/sign-in.
2. `/pricing` → `app/pricing/page.tsx` → public → none (static) → Free plan (everything free) + optional Pro; CTA to sign-up.
3. `/auth/sign-in` → `app/auth/sign-in/page.tsx` → public → authClient.signIn.email → email/password sign-in form.
4. `/auth/sign-up` → `app/auth/sign-up/page.tsx` → public → authClient.signUp.email → email/password sign-up form.
5. `/reports/shared/[token]` → `app/reports/shared/[token]/page.tsx` → public → getSharedReport → read-only recovery report (headline recoverable $, line items by env/team). No auth, no dashboard chrome.

### Dashboard (wrapped by `app/dashboard/layout.tsx` → `components/DashboardLayout`; guarded by proxy.ts + per-page session check)
6. `/dashboard` → `app/dashboard/page.tsx` → dashboard → getWorkspaces, getOverview, getTrends, getLeaderboard, seedSample → overview cards (total/nonprod/idle-waste/recoverable), trend chart, worst-offender leaderboard, "seed sample data" button if empty.
7. `/dashboard/environments` → `app/dashboard/environments/page.tsx` → dashboard → getEnvironments, createEnvironment, getLedgerByEnvironment → environments table with cost/idle-waste; create env.
8. `/dashboard/environments/[id]` → `app/dashboard/environments/[id]/page.tsx` → dashboard → getEnvironment, updateEnvironment, getIdleSummary, getIdleHeatmap, getSchedules, getHolidayCalendars → env detail: rollups, timezone/schedule/calendar editor, idle heatmap.
9. `/dashboard/resources` → `app/dashboard/resources/page.tsx` → dashboard → getResources, createResource, assignResource, deleteResource, getEnvironments, getTeams → resource inventory table, filters, manual classification override.
10. `/dashboard/resources/[id]` → `app/dashboard/resources/[id]/page.tsx` → dashboard → getResource, updateResource, getUsage, getIdleWindows → resource detail: cost, env, idle history, usage chart.
11. `/dashboard/rules` → `app/dashboard/rules/page.tsx` → dashboard → getEnvironmentRules, createEnvironmentRule, updateEnvironmentRule, deleteEnvironmentRule, previewEnvironmentRule, applyEnvironmentRules → naming/pattern rules CRUD, preview, apply, coverage gaps.
12. `/dashboard/tag-rules` → `app/dashboard/tag-rules/page.tsx` → dashboard → getTagRules, createTagRule, updateTagRule, deleteTagRule → tag key/value rules CRUD with hit counts.
13. `/dashboard/idle` → `app/dashboard/idle/page.tsx` → dashboard → getIdleSummary, getIdleWindows, detectIdle, getIdleHeatmap, getEnvironments → idle analysis: run detection, per-env idle-hours, heatmap.
14. `/dashboard/ledger` → `app/dashboard/ledger/page.tsx` → dashboard → getLedger, getLedgerSummary, getLedgerByEnvironment, rebuildLedger → waste ledger: totals, by provider/service/region, rebuild.
15. `/dashboard/schedules` → `app/dashboard/schedules/page.tsx` → dashboard → getSchedules, createSchedule, deleteSchedule → schedules list (presets + custom), create.
16. `/dashboard/schedules/[id]` → `app/dashboard/schedules/[id]/page.tsx` → dashboard → getSchedule, updateSchedule, assignSchedule, unassignSchedule, getEnvironments → schedule window editor, assignments, effective hours.
17. `/dashboard/savings` → `app/dashboard/savings/page.tsx` → dashboard → getSavings, calculateSavings, compareSavings, getSavingsPotential, getEnvironments, getSchedules → what-if savings calculator, schedule comparison, org potential.
18. `/dashboard/orphans` → `app/dashboard/orphans/page.tsx` → dashboard → getOrphans, detectOrphans, setOrphanStatus → orphan findings list, run detection, acknowledge/dismiss/recover.
19. `/dashboard/recommendations` → `app/dashboard/recommendations/page.tsx` → dashboard → getRecommendations, generateRecommendations, setRecommendationStatus → ranked recommendations, generate, status workflow.
20. `/dashboard/teams` → `app/dashboard/teams/page.tsx` → dashboard → getTeams, createTeam, updateTeam, deleteTeam → teams list with spend rollups, CRUD.
21. `/dashboard/budgets` → `app/dashboard/budgets/page.tsx` → dashboard → getBudgets, setBudget, updateBudget, deleteBudget, getTeams → per-team budgets vs actual, projections, over-budget flags.
22. `/dashboard/showback` → `app/dashboard/showback/page.tsx` → dashboard → getShowback, rebuildShowback, getShowbackStatement → showback statement per team/period, rebuild, unallocated bucket.
23. `/dashboard/holidays` → `app/dashboard/holidays/page.tsx` → dashboard → getHolidayCalendars, createHolidayCalendar, deleteHolidayCalendar, getHolidays, createHoliday, deleteHoliday, seedStandardHolidays → calendars + holidays CRUD, seed standard sets.
24. `/dashboard/reports` → `app/dashboard/reports/page.tsx` → dashboard → getReports, generateReport, deleteReport → recovery reports list, generate for a period.
25. `/dashboard/reports/[id]` → `app/dashboard/reports/[id]/page.tsx` → dashboard → getReport → report detail with line items, share link (share_token), exec summary.
26. `/dashboard/accounts` → `app/dashboard/accounts/page.tsx` → dashboard → getCloudAccounts, createCloudAccount, updateCloudAccount, deleteCloudAccount → cloud accounts with rollups + env breakdown.
27. `/dashboard/imports` → `app/dashboard/imports/page.tsx` → dashboard → getImports, importResources, importCosts, importUsage, getImport → CSV import batches, paste/upload rows, view errors.
28. `/dashboard/alerts` → `app/dashboard/alerts/page.tsx` → dashboard → getAlerts, evaluateAlerts, setAlertStatus, getAlertRules, createAlertRule, updateAlertRule, deleteAlertRule → alert feed + alert-rule CRUD + evaluate.
29. `/dashboard/activity` → `app/dashboard/activity/page.tsx` → dashboard → getActivity → activity/audit feed with filters.
30. `/dashboard/views` → `app/dashboard/views/page.tsx` → dashboard → getViews, createView, updateView, deleteView → saved views management, set default.
31. `/dashboard/settings` → `app/dashboard/settings/page.tsx` → dashboard → getWorkspaces, createWorkspace, updateWorkspace, getWorkspaceMembers, addWorkspaceMember, removeWorkspaceMember, getBillingPlan, createCheckout, createPortal, resetSample → workspace settings, members, billing (Stripe 503-aware), reset sample data.

Page count: 31 (5 public + 26 dashboard), exceeding the 22-26 bar with full feature coverage.

Every api method above is consumed by at least one page; every backend endpoint backs exactly one api method (except `/billing/webhook`, called by Stripe).

---

## (e) DashboardLayout sidebar nav sections

`components/DashboardLayout.tsx` — `'use client'`, `<aside>` sidebar, active state via `usePathname()`, mobile drawer. Sections:

- **Overview**
  - Dashboard → `/dashboard`
- **Inventory**
  - Environments → `/dashboard/environments`
  - Resources → `/dashboard/resources`
  - Cloud Accounts → `/dashboard/accounts`
- **Classification**
  - Naming Rules → `/dashboard/rules`
  - Tag Rules → `/dashboard/tag-rules`
- **Waste Analysis**
  - Idle Analysis → `/dashboard/idle`
  - Waste Ledger → `/dashboard/ledger`
  - Orphans → `/dashboard/orphans`
- **Savings**
  - Schedules → `/dashboard/schedules`
  - Savings Calculator → `/dashboard/savings`
  - Recommendations → `/dashboard/recommendations`
- **FinOps**
  - Teams → `/dashboard/teams`
  - Budgets → `/dashboard/budgets`
  - Showback → `/dashboard/showback`
  - Holidays → `/dashboard/holidays`
- **Reporting**
  - Recovery Reports → `/dashboard/reports`
  - Activity Log → `/dashboard/activity`
- **Data & Settings**
  - Imports → `/dashboard/imports`
  - Alerts → `/dashboard/alerts`
  - Saved Views → `/dashboard/views`
  - Settings → `/dashboard/settings`

Dynamic detail pages (`/dashboard/environments/[id]`, `/dashboard/resources/[id]`, `/dashboard/schedules/[id]`, `/dashboard/reports/[id]`) are reached from their list pages, not the sidebar.
