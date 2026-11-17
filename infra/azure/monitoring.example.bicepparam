using './monitoring.bicep'

param appName = 'nova-staging-example'
param applicationEnvironment = 'staging'
param actionGroupName = 'nova-staging-operators-example'
param alertsEnabled = false
param serverErrorThreshold = 5
