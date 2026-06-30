// Same-origin relative calls to /api/proxy/... — the proxy injects X-User-Id.
// Each path after /api/proxy/ maps 1:1 to the backend path after /api/v1/.

type Query = Record<string, string | number | boolean | undefined | null>

function qs(query?: Query): string {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

async function req<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/proxy/${path}`, init)
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const message = (data && (data.error || data.message)) || `Request failed (${res.status})`
    throw new Error(message)
  }
  return data as T
}

function get<T = any>(path: string): Promise<T> {
  return req<T>(path)
}

function send<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  return req<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const api = {
  // workspaces
  getWorkspaces: () => get('workspaces'),
  createWorkspace: (body: any) => send('POST', 'workspaces', body),
  getWorkspace: (id: string) => get(`workspaces/${id}`),
  updateWorkspace: (id: string, body: any) => send('PUT', `workspaces/${id}`, body),
  getWorkspaceMembers: (id: string) => get(`workspaces/${id}/members`),
  addWorkspaceMember: (id: string, body: any) => send('POST', `workspaces/${id}/members`, body),
  removeWorkspaceMember: (id: string, memberId: string) => send('DELETE', `workspaces/${id}/members/${memberId}`),

  // cloud accounts
  getCloudAccounts: (workspaceId: string) => get(`cloud-accounts${qs({ workspace_id: workspaceId })}`),
  createCloudAccount: (body: any) => send('POST', 'cloud-accounts', body),
  getCloudAccount: (id: string) => get(`cloud-accounts/${id}`),
  updateCloudAccount: (id: string, body: any) => send('PUT', `cloud-accounts/${id}`, body),
  deleteCloudAccount: (id: string) => send('DELETE', `cloud-accounts/${id}`),

  // resources
  getResources: (query: Query) => get(`resources${qs(query)}`),
  createResource: (body: any) => send('POST', 'resources', body),
  getResource: (id: string) => get(`resources/${id}`),
  updateResource: (id: string, body: any) => send('PUT', `resources/${id}`, body),
  assignResource: (id: string, body: any) => send('PATCH', `resources/${id}/assign`, body),
  deleteResource: (id: string) => send('DELETE', `resources/${id}`),

  // environments
  getEnvironments: (workspaceId: string) => get(`environments${qs({ workspace_id: workspaceId })}`),
  createEnvironment: (body: any) => send('POST', 'environments', body),
  getEnvironment: (id: string) => get(`environments/${id}`),
  updateEnvironment: (id: string, body: any) => send('PUT', `environments/${id}`, body),
  deleteEnvironment: (id: string) => send('DELETE', `environments/${id}`),

  // environment rules
  getEnvironmentRules: (workspaceId: string) => get(`environment-rules${qs({ workspace_id: workspaceId })}`),
  createEnvironmentRule: (body: any) => send('POST', 'environment-rules', body),
  updateEnvironmentRule: (id: string, body: any) => send('PUT', `environment-rules/${id}`, body),
  deleteEnvironmentRule: (id: string) => send('DELETE', `environment-rules/${id}`),
  previewEnvironmentRule: (body: any) => send('POST', 'environment-rules/preview', body),
  applyEnvironmentRules: (body: any) => send('POST', 'environment-rules/apply', body),

  // tag rules
  getTagRules: (workspaceId: string) => get(`tag-rules${qs({ workspace_id: workspaceId })}`),
  createTagRule: (body: any) => send('POST', 'tag-rules', body),
  updateTagRule: (id: string, body: any) => send('PUT', `tag-rules/${id}`, body),
  deleteTagRule: (id: string) => send('DELETE', `tag-rules/${id}`),

  // usage
  getUsage: (query: Query) => get(`usage${qs(query)}`),
  recordUsage: (body: any) => send('POST', 'usage', body),
  getUsageHourly: (query: Query) => get(`usage/hourly${qs(query)}`),

  // costs
  getCosts: (query: Query) => get(`costs${qs(query)}`),
  upsertCost: (body: any) => send('POST', 'costs', body),
  getRates: (workspaceId: string) => get(`costs/rates${qs({ workspace_id: workspaceId })}`),

  // idle
  getIdleWindows: (query: Query) => get(`idle${qs(query)}`),
  detectIdle: (body: any) => send('POST', 'idle/detect', body),
  getIdleSummary: (workspaceId: string) => get(`idle/summary${qs({ workspace_id: workspaceId })}`),
  getIdleHeatmap: (environmentId: string) => get(`idle/heatmap${qs({ environment_id: environmentId })}`),

  // ledger
  getLedger: (query: Query) => get(`ledger${qs(query)}`),
  rebuildLedger: (body: any) => send('POST', 'ledger/rebuild', body),
  getLedgerSummary: (workspaceId: string) => get(`ledger/summary${qs({ workspace_id: workspaceId })}`),
  getLedgerByEnvironment: (workspaceId: string) => get(`ledger/by-environment${qs({ workspace_id: workspaceId })}`),

  // schedules
  getSchedules: (workspaceId: string) => get(`schedules${qs({ workspace_id: workspaceId })}`),
  createSchedule: (body: any) => send('POST', 'schedules', body),
  getSchedule: (id: string) => get(`schedules/${id}`),
  updateSchedule: (id: string, body: any) => send('PUT', `schedules/${id}`, body),
  deleteSchedule: (id: string) => send('DELETE', `schedules/${id}`),
  assignSchedule: (id: string, body: any) => send('POST', `schedules/${id}/assign`, body),
  unassignSchedule: (assignmentId: string) => send('DELETE', `schedules/assignments/${assignmentId}`),

  // savings
  getSavings: (query: Query) => get(`savings${qs(query)}`),
  calculateSavings: (body: any) => send('POST', 'savings/calculate', body),
  compareSavings: (body: any) => send('POST', 'savings/compare', body),
  getSavingsPotential: (workspaceId: string) => get(`savings/potential${qs({ workspace_id: workspaceId })}`),

  // orphans
  getOrphans: (query: Query) => get(`orphans${qs(query)}`),
  detectOrphans: (body: any) => send('POST', 'orphans/detect', body),
  setOrphanStatus: (id: string, body: any) => send('PATCH', `orphans/${id}/status`, body),

  // recommendations
  getRecommendations: (workspaceId: string) => get(`recommendations${qs({ workspace_id: workspaceId })}`),
  generateRecommendations: (body: any) => send('POST', 'recommendations/generate', body),
  setRecommendationStatus: (id: string, body: any) => send('PATCH', `recommendations/${id}/status`, body),

  // teams
  getTeams: (workspaceId: string) => get(`teams${qs({ workspace_id: workspaceId })}`),
  createTeam: (body: any) => send('POST', 'teams', body),
  getTeam: (id: string) => get(`teams/${id}`),
  updateTeam: (id: string, body: any) => send('PUT', `teams/${id}`, body),
  deleteTeam: (id: string) => send('DELETE', `teams/${id}`),

  // budgets
  getBudgets: (query: Query) => get(`budgets${qs(query)}`),
  setBudget: (body: any) => send('POST', 'budgets', body),
  updateBudget: (id: string, body: any) => send('PUT', `budgets/${id}`, body),
  deleteBudget: (id: string) => send('DELETE', `budgets/${id}`),

  // showback
  getShowback: (query: Query) => get(`showback${qs(query)}`),
  rebuildShowback: (body: any) => send('POST', 'showback/rebuild', body),
  getShowbackStatement: (query: Query) => get(`showback/statement${qs(query)}`),

  // holidays
  getHolidayCalendars: (workspaceId: string) => get(`holidays/calendars${qs({ workspace_id: workspaceId })}`),
  createHolidayCalendar: (body: any) => send('POST', 'holidays/calendars', body),
  deleteHolidayCalendar: (id: string) => send('DELETE', `holidays/calendars/${id}`),
  getHolidays: (calendarId: string) => get(`holidays${qs({ holiday_calendar_id: calendarId })}`),
  createHoliday: (body: any) => send('POST', 'holidays', body),
  deleteHoliday: (id: string) => send('DELETE', `holidays/${id}`),
  seedStandardHolidays: (body: any) => send('POST', 'holidays/seed-standard', body),

  // reports
  getReports: (workspaceId: string) => get(`reports${qs({ workspace_id: workspaceId })}`),
  generateReport: (body: any) => send('POST', 'reports/generate', body),
  getReport: (id: string) => get(`reports/${id}`),
  getSharedReport: (token: string) => get(`reports/shared/${token}`),
  deleteReport: (id: string) => send('DELETE', `reports/${id}`),

  // imports
  getImports: (workspaceId: string) => get(`imports${qs({ workspace_id: workspaceId })}`),
  importResources: (body: any) => send('POST', 'imports/resources', body),
  importCosts: (body: any) => send('POST', 'imports/costs', body),
  importUsage: (body: any) => send('POST', 'imports/usage', body),
  getImport: (id: string) => get(`imports/${id}`),

  // alerts
  getAlerts: (query: Query) => get(`alerts${qs(query)}`),
  evaluateAlerts: (body: any) => send('POST', 'alerts/evaluate', body),
  setAlertStatus: (id: string, body: any) => send('PATCH', `alerts/${id}/status`, body),
  getAlertRules: (workspaceId: string) => get(`alerts/rules${qs({ workspace_id: workspaceId })}`),
  createAlertRule: (body: any) => send('POST', 'alerts/rules', body),
  updateAlertRule: (id: string, body: any) => send('PUT', `alerts/rules/${id}`, body),
  deleteAlertRule: (id: string) => send('DELETE', `alerts/rules/${id}`),

  // activity
  getActivity: (query: Query) => get(`activity${qs(query)}`),

  // saved views
  getViews: (workspaceId: string) => get(`views${qs({ workspace_id: workspaceId })}`),
  createView: (body: any) => send('POST', 'views', body),
  updateView: (id: string, body: any) => send('PUT', `views/${id}`, body),
  deleteView: (id: string) => send('DELETE', `views/${id}`),

  // sample data
  seedSample: () => send('POST', 'sample/seed'),
  resetSample: (body: any) => send('POST', 'sample/reset', body),

  // stats
  getOverview: (workspaceId: string) => get(`stats/overview${qs({ workspace_id: workspaceId })}`),
  getTrends: (workspaceId: string) => get(`stats/trends${qs({ workspace_id: workspaceId })}`),
  getLeaderboard: (workspaceId: string) => get(`stats/leaderboard${qs({ workspace_id: workspaceId })}`),

  // billing
  getBillingPlan: () => get('billing/plan'),
  createCheckout: () => send('POST', 'billing/checkout'),
  createPortal: () => send('POST', 'billing/portal'),
}

export default api
