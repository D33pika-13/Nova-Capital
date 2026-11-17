using './availability.bicep'

param appName = 'nova-staging-example'
param applicationEnvironment = 'staging'
param applicationInsightsName = 'nova-staging-insights-example'
param actionGroupName = 'nova-staging-operators-example'
param probeEnabled = false
param alertsEnabled = false
param failedLocationCount = 3
