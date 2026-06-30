# NonprodBurnWarden — Idea & Feature Spec

## Overview

NonprodBurnWarden is a FinOps platform that quantifies and helps recover the money that non-production cloud environments waste by running 24/7 for no reason. It builds a per-environment idle-spend ledger: it tags every cloud resource into an environment (dev / staging / QA / sandbox / preview), detects when those environments run out of hours with no usage, computes the dollars burned while always-on, and models the savings of timezone- and holiday-aware off-hours schedules. The output is a monthly recovery report a platform or FinOps lead can take to finance to prove five-to-six-figure monthly savings.

The product is deterministic and report-and-model only. It never mutates cloud infrastructure. It works over uploaded CSV billing/usage exports, connected read-only cost feeds, or a built-in sample-data seeder for instant demoability. Every feature is free for signed-in users; Stripe billing is wired but optional (returns 503 when unconfigured).

## Problem

Non-production environments are the single most-repeated FinOps finding. Dev, staging, QA, sandbox, and PR/preview stacks routinely run nights, weekends, and holidays while nobody is using them — commonly 20-40% of an org's compute spend. Enforcing off-hours schedules often halves that category, recovering tens of thousands of dollars per month. But teams lack two things: (1) a per-environment idle-spend ledger that attributes wasted dollars to a specific environment and team, and (2) a credible schedule-ROI model that says "if you stopped this environment 7pm-7am on weekdays and all weekend, you would save $X/month." Without those, the off-hours conversation never gets budget authority behind it and the waste recurs every cost-cutting cycle.

## Target Users

- **Engineering managers** at 50-500 person cloud-using orgs who own a slice of the cloud budget and face finance/board cost-cutting pressure.
- **Platform / FinOps leads** who own the org's overall cloud spend and need defensible numbers per environment and per team.
- **Staff/principal engineers** running many ephemeral dev/preview/staging stacks who want to know which ones are forgotten.

### Buyer

The buyer is the engineering manager or platform/FinOps lead who owns the cloud budget and is under finance/board cost-cutting pressure. The demand recurs every cost-cutting cycle, the budget authority is clear, and nearly every cloud engineering org qualifies.

## Why this is NOT an existing project

Near-neighbors and the precise distinction:

- **env-managers / provisioning tools (e.g. environment provisioning platforms):** Those *create and mutate* infrastructure. NonprodBurnWarden never provisions or mutates anything — it is purely a model-and-report ledger over existing spend and usage.
- **savings-plan-optimizer / RI & SP commitment tools:** Those optimize *purchase commitments* (reserved instances, savings plans) against steady-state usage. NonprodBurnWarden is the opposite axis: it targets *eliminating* run hours on non-production compute via scheduling, not committing to more hours.
- **storage-tier-recovery-desk (nearest sibling):** That isolates *storage* tiering, lifecycle, and snapshot waste. NonprodBurnWarden isolates *non-production compute scheduling* waste. Neither mutates infra; both are model-and-report; the resource class and the recovery lever (schedule vs tier) are disjoint.
- **Generic cloud cost dashboards (CUR explorers):** Those show total spend by tag/service. They do not classify environments by non-prod intent, do not infer idle out-of-hours windows from usage, and do not produce a schedule-savings model per environment with timezone/holiday awareness. NonprodBurnWarden's entire value is that environment-scoped, schedule-centric lens.

The wedge is narrow and defensible: per-environment idle-spend ledger + schedule-ROI model for non-production compute only.

## Data Model (tables)

- workspaces, workspace_members
- cloud_accounts
- resources
- environments
- environment_rules
- tag_rules
- usage_samples
- cost_records
- idle_windows
- waste_ledger_entries
- schedules
- schedule_assignments
- savings_estimates
- orphan_findings
- teams
- team_budgets
- showback_allocations
- holidays
- holiday_calendars
- recovery_reports
- report_line_items
- import_batches
- alerts
- alert_rules
- recommendations
- activity_log
- saved_views
- plans, subscriptions

## API surface (high level)

REST under `/api/v1`, every domain a child Hono router. Public reads, auth-gated writes with zod validation and ownership checks. Domains: workspaces, cloud-accounts, environments, environment-rules, tag-rules, resources, usage, costs, idle, ledger, schedules, savings, orphans, teams, budgets, showback, holidays, reports, imports, alerts, recommendations, activity, views, sample data seeder, billing, stats.

---

## Major Features

### 1. Environment Inventory & Classification
- Catalog every cloud resource (instance, db, cluster, container service) with provider, region, account, type, and tags.
- Classify each resource into an environment kind: dev, staging, QA, sandbox, preview, prod, unknown.
- Manual override of a resource's environment assignment.
- Confidence score per classification (rule-matched vs heuristic).
- Bulk re-classify after rule changes.
- Resource detail view: lifecycle, owner, monthly cost, environment, idle history.

### 2. Tag & Naming Rule Engine
- Define rules that map resource names/tags to environment kinds (e.g. name matches `*-staging-*` → staging).
- Rule priority ordering and first-match-wins evaluation.
- Tag-key/value rules (e.g. `env=qa`) and naming-pattern rules (glob/regex).
- Rule test/preview: see which resources a rule would match before saving.
- Per-rule hit counts and coverage stats.
- Detect resources matched by no rule (classification gaps).

### 3. Idle-Window Detection
- Infer out-of-hours running with no usage from usage samples (CPU, network, request count).
- Configurable idle threshold (e.g. CPU < 5% and requests = 0).
- Roll contiguous idle samples into idle windows with start/end and duration.
- Distinguish business-hours idle vs off-hours idle.
- Per-environment idle-hours-per-week summary.
- Idle heatmap data (hour-of-week grid).

### 4. Always-On Waste Ledger
- Compute dollars burned per environment while idle/off-hours.
- Ledger entry per environment per period with idle hours, hourly rate, and dollars wasted.
- Attribute waste to resource, environment, team.
- Running monthly and trailing-30-day waste totals.
- Drill from ledger entry to the underlying idle windows and cost records.
- Waste breakdown by provider / service / region.

### 5. Schedule-Savings Calculator
- Model nights/weekends/holidays off-hours schedules per environment.
- Compute projected monthly savings if a schedule is applied (run hours saved x rate).
- Compare multiple candidate schedules side by side.
- "What-if" slider: choose start/stop hours and days, see live savings estimate.
- Savings as absolute dollars and as % of environment spend.
- Aggregate savings across all environments (org recovery potential).

### 6. Off-Hours Schedule Modeling
- Define named schedules (e.g. "Weekday 7pm-7am + weekends off").
- Per-day on/off windows; multiple windows per day.
- Assign schedules to environments or individual resources.
- Timezone-aware schedule evaluation per environment.
- Schedule library with reusable presets.
- Effective-hours calculation (running hours per week under a schedule).

### 7. Timezone & Holiday Awareness
- Per-environment timezone setting.
- Holiday calendars (per-region, per-team) with named holidays.
- Schedules treat holidays as full off-days for savings modeling.
- Import standard holiday sets (US, UK, etc. as seed data).
- Custom org holidays / company-wide shutdown weeks.
- Holiday impact line in the recovery report.

### 8. Orphaned Non-Prod Finder
- Detect long-lived sandboxes (age > threshold, low usage).
- Detect forgotten PR/preview stacks (no recent activity, name pattern).
- Detect environments with zero usage over a lookback window.
- Severity scoring per orphan finding.
- Mark finding as acknowledged / dismissed / recovered.
- Estimated monthly cost of each orphan.

### 9. Per-Team Non-Prod Budget Tracker
- Define teams and a monthly non-prod budget per team.
- Track actual non-prod spend vs budget per team.
- Over-budget alerts and projected end-of-month spend.
- Budget burn-down view.
- Reassign environments/resources to teams.

### 10. Showback & Allocation
- Allocate non-prod spend to teams (showback, not chargeback).
- Allocation rules by environment ownership / tag.
- Per-team showback statement for a period.
- Unallocated spend bucket.
- Showback CSV export data.

### 11. Monthly Recovery Report
- Generate a monthly report: total non-prod spend, idle waste, recoverable via schedules, by team and environment.
- Report line items (per environment / per recommendation).
- Period-over-period delta (did we recover what we modeled?).
- Shareable read-only report view.
- Executive summary numbers (headline recoverable dollars).

### 12. Cost Ingestion & Imports
- Upload CSV billing/usage exports (cost records, usage samples).
- Connected read-only cost feed registration (stubbed connector metadata).
- Import batches with row counts, status, errors.
- Idempotent re-import / replace by period.
- Validation of required columns and types.

### 13. Usage Sample Pipeline
- Store time-series usage samples per resource (metric, value, timestamp).
- Aggregate samples into hourly buckets.
- Define what counts as "in use" per resource type.
- Backfill from imported usage.

### 14. Cost Records & Rate Modeling
- Store per-resource cost records per period.
- Derive hourly rate per resource (cost / run hours).
- Blended environment hourly rate.
- Currency handling (single currency v1).

### 15. Recommendations Engine
- Generate actionable recommendations: "Apply schedule X to env Y to save $Z", "Delete orphan sandbox Q".
- Rank recommendations by recoverable dollars.
- Recommendation status workflow (open / applied / dismissed).
- Link recommendation to schedule/orphan/environment.

### 16. Alerts & Alert Rules
- Define alert rules (e.g. environment exceeds idle waste threshold, team over budget, new orphan found).
- Generated alerts with severity, message, and link.
- Acknowledge / resolve alerts.
- Alert feed.

### 17. Cloud Account Management
- Register cloud accounts (provider, account id, nickname).
- Per-account resource and cost rollups.
- Account-level environment breakdown.

### 18. Dashboards & Analytics
- Org overview: total spend, non-prod spend, idle waste, recoverable potential.
- Trend charts (waste over time).
- Environment leaderboard (worst offenders).
- Idle heatmap.

### 19. Saved Views & Filters
- Save filtered views of resources/environments/ledger.
- Named, shareable-within-workspace views.
- Default landing view per user.

### 20. Workspace & Membership
- Multi-tenant workspaces.
- Invite members, roles (owner/member).
- Workspace switching.
- Per-workspace data isolation.

### 21. Activity Log & Audit
- Record key actions (rule changes, schedule assignments, dismissals).
- Per-entity activity feed.
- Filter by actor / entity type.

### 22. Sample Data Seeder
- One-click generate a realistic demo workspace (accounts, resources, environments, usage, costs, idle windows, orphans).
- Deterministic so the demo is reproducible.
- Reset / regenerate sample data.

### 23. Billing (optional)
- Free plan for all signed-in users; all features free.
- Stripe checkout/portal/webhook wired but returns 503 when unconfigured.
- Plan view.

---

## Frontend Pages (target ~22-26 pages)

Public: landing, pricing, sign-in, sign-up, shared report view.
Dashboard: overview, environments list, environment detail, resources, tag rules, environment rules, idle analysis, waste ledger, schedules, schedule detail, savings calculator, orphans, teams, budgets, showback, holidays, recovery reports, report detail, cloud accounts, imports, recommendations, alerts, activity, saved views, settings/billing.
