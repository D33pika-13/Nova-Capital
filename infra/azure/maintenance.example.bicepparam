using './maintenance.bicep'
param jobName = 'nova-staging-maintenance'
param managedEnvironmentName = 'nova-staging-environment'
param managedIdentityName = 'nova-staging-job'
param registryName = 'novastagingexample'
param applicationImage = {
  repository: 'nova-capital'
  sha256: '0000000000000000000000000000000000000000000000000000000000000000'
}
param applicationOrigin = 'https://nova-staging-example.example.test'
param keyVaultName = 'nova-staging-vault'
param maintenanceReference = 'nova-maintenance-token/00000000000000000000000000000000'
