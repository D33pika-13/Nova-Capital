targetScope = 'resourceGroup'
import { ImmutableImage } from './types.bicep'

@minLength(2)
@maxLength(32)
param jobName string
@allowed(['staging', 'production'])
param applicationEnvironment string = 'staging'
param location string = resourceGroup().location
param managedEnvironmentName string
@description('Separate identity: image pull plus read access to the maintenance secret only.')
param managedIdentityName string
param registryName string
param applicationImage ImmutableImage
param applicationOrigin string
param keyVaultName string
@description('Pinned maintenance secret name/version, matching web CRON_SECRET reference.')
@minLength(34)
@maxLength(160)
param maintenanceReference string
@allowed(['*/15 * * * *', '0 * * * *'])
param utcSchedule string = '*/15 * * * *'

resource environment 'Microsoft.App/managedEnvironments@2026-07-01' existing = { name: managedEnvironmentName }
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = { name: managedIdentityName }
resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' existing = { name: registryName }
resource vault 'Microsoft.KeyVault/vaults@2026-02-01' existing = { name: keyVaultName }
resource job 'Microsoft.App/jobs@2026-07-01' = {
  name: jobName
  location: location
  tags: { application: 'nova-capital', environment: applicationEnvironment }
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    environmentId: environment.id
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 180
      replicaRetryLimit: 0
      scheduleTriggerConfig: { cronExpression: utcSchedule, parallelism: 1, replicaCompletionCount: 1 }
      registries: [{ server: registry.properties.loginServer, identity: identity.id }]
      secrets: [
        {
          name: 'maintenance-token'
          keyVaultUrl: '${vault.properties.vaultUri}secrets/${maintenanceReference}'
          identity: identity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'maintenance'
          image: '${registry.properties.loginServer}/${applicationImage.repository}@sha256:${applicationImage.sha256}'
          command: ['node', 'scripts/run-maintenance.mjs']
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: [
            { name: 'APP_ENV', value: applicationEnvironment }
            { name: 'APP_URL', value: applicationOrigin }
            { name: 'SCHEDULER_PROVIDER', value: 'external' }
            { name: 'CRON_SECRET', secretRef: 'maintenance-token' }
          ]
        }
      ]
    }
  }
}
output maintenanceJobId string = job.id
