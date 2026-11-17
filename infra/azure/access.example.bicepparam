using './access.bicep'
param webIdentityName = 'nova-staging-web'
param jobIdentityName = 'nova-staging-job'
param keyVaultName = 'nova-staging-vault'
param maintenanceSecretName = 'nova-maintenance-token'
param registryName = 'novastagingexample'
param storage = {
  provider: 'azure'
  accountName: 'novastagingexample'
  reportContainer: 'client-reports'
  imageContainer: 'offer-images'
}
// Optional publisher scope is one existing environment-specific Application Insights resource.
param telemetry = {
  provider: 'azure_monitor'
  applicationInsightsName: 'nova-staging-insights-example'
}
