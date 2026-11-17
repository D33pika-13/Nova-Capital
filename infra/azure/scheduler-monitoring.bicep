targetScope = 'resourceGroup'

@minLength(2)
@maxLength(32)
param appName string
@allowed(['staging', 'production'])
param applicationEnvironment string = 'staging'
@minLength(1)
param applicationInsightsName string
@minLength(4)
param workspaceName string
@description('Region of the selected workspace; verify its association with the existing Application Insights resource.')
@minLength(1)
param location string = resourceGroup().location
@description('Existing dedicated user-assigned alert identity with approved query access to AppDependencies in this workspace. Do not reuse the web or scheduler identity.')
@minLength(1)
param queryIdentityName string
@description('Existing reviewed action group; no recipients or permissions are created here.')
@minLength(1)
param actionGroupName string
@description('Enable only after actual query/identity verification, cost review and notification authorization.')
param alertsEnabled bool = false
@description('Successful scheduled-batch lookback, including cadence/startup/ingestion margin. Align with MAINTENANCE_STALE_AFTER_SECONDS; hourly jobs require a larger value.')
@minValue(5)
@maxValue(1440)
param staleAfterMinutes int = 45

resource insights 'Microsoft.Insights/components@2020-02-02' existing = { name: applicationInsightsName }
resource workspace 'Microsoft.OperationalInsights/workspaces@2025-07-01' existing = { name: workspaceName }
resource queryIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = { name: queryIdentityName }
resource operators 'Microsoft.Insights/actionGroups@2023-01-01' existing = { name: actionGroupName }

// Base64 protects the embedded resource ID from KQL quoting ambiguity; the
// component filter excludes other apps sharing this workspace. No grouped
// summarize: an empty (existing) table produces one row with Evidence=0.
var source = format('''
AppDependencies
| where _ResourceId =~ base64_decode_tostring('{0}')
| where AppRoleName == 'nova-capital'
| where tostring(Properties['nova.provider']) == 'postgres'
| where tostring(Properties['nova.maintenance_origin']) == 'scheduler'
''', base64(insights.id))
var rules = [
  {
    suffix: 'scheduler-no-success'
    description: 'No observed committed successful scheduled batch within the selected interval; stopped jobs, failed work or lost/delayed telemetry can cause this signal. Check the private database ledger.'
    query: format('''
{0}
| where TimeGenerated > ago({1}m) and TimeGenerated <= now()
| where Name == 'maintenance.batch_completed' and Success == true
| where tostring(Properties['nova.status']) == 'ok'
| summarize Evidence=count()
| extend TimeGenerated=now()
''', source, staleAfterMinutes)
    lookback: 'PT${staleAfterMinutes}M'
    operator: 'LessThan'
    threshold: 1
  }
  {
    suffix: 'scheduler-failed'
    description: 'Observed confirmed failure or unconfirmed outcome from a scheduled batch within five minutes. Do not blindly retry uncertain external or database effects.'
    query: format('''
{0}
| where TimeGenerated > ago(5m) and TimeGenerated <= now()
| where Name in ('maintenance.batch_failed', 'maintenance.batch_unconfirmed') and Success == false
| where tostring(Properties['nova.status']) in ('failed', 'unavailable')
| summarize Evidence=count()
| extend TimeGenerated=now()
''', source)
    lookback: 'PT5M'
    operator: 'GreaterThan'
    threshold: 0
  }
]

resource alerts 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = [for rule in rules: {
  name: '${appName}-${rule.suffix}'
  location: location
  kind: 'LogAlert'
  tags: { application: 'nova-capital', environment: applicationEnvironment }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${queryIdentity.id}': {} }
  }
  properties: {
    description: rule.description
    enabled: alertsEnabled
    severity: 1
    scopes: [workspace.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    overrideQueryTimeRange: rule.lookback
    autoMitigate: true
    skipQueryValidation: false
    checkWorkspaceAlertsStorageConfigured: false
    criteria: {
      allOf: [{
        query: rule.query
        metricMeasureColumn: 'Evidence'
        timeAggregation: 'Maximum'
        operator: rule.operator
        threshold: rule.threshold
        failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
      }]
    }
    actions: { actionGroups: [operators.id] }
  }
}]

output schedulerAlertIds array = [for i in range(0, length(rules)): alerts[i].id]
