using './scheduler-monitoring.bicep'

param appName = 'nova-staging-example'
param applicationEnvironment = 'staging'
param applicationInsightsName = 'nova-staging-insights-example'
param workspaceName = 'nova-staging-logs-example'
param queryIdentityName = 'nova-staging-alert-query-example'
param actionGroupName = 'nova-staging-operators-example'
param alertsEnabled = false
param staleAfterMinutes = 45
