targetScope = 'resourceGroup'
param webIdentityName string
param jobIdentityName string
param keyVaultName string
param maintenanceSecretName string
param registryName string
@discriminator('provider')
type StorageAccess =
  | { provider: 'supabase' }
  | {
    provider: 'azure'
    accountName: string
    reportContainer: string
    imageContainer: string
  }
param storage StorageAccess = { provider: 'supabase' }

@discriminator('provider')
type TelemetryAccess =
  | { provider: 'console' }
  | { provider: 'azure_monitor', applicationInsightsName: string }
param telemetry TelemetryAccess = { provider: 'console' }

resource webIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = { name: webIdentityName }
resource jobIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = { name: jobIdentityName }
resource vault 'Microsoft.KeyVault/vaults@2026-02-01' existing = { name: keyVaultName }
resource maintenanceSecret 'Microsoft.KeyVault/vaults/secrets@2026-02-01' existing = {
  parent: vault
  name: maintenanceSecretName
}
resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' existing = { name: registryName }
var vaultReader = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '4633458b-17de-408a-b874-0445c86b69e6'
)
var registryReader = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '7f951dda-4ed3-4680-a7ca-43fe172d538d'
)
resource webSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, webIdentity.id, vaultReader)
  scope: vault
  properties: {
    principalId: webIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: vaultReader
  }
}
resource jobSecret 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(maintenanceSecret.id, jobIdentity.id, vaultReader)
  scope: maintenanceSecret
  properties: {
    principalId: jobIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: vaultReader
  }
}
resource webPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, webIdentity.id, registryReader)
  scope: registry
  properties: {
    principalId: webIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: registryReader
  }
}
resource jobPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, jobIdentity.id, registryReader)
  scope: registry
  properties: {
    principalId: jobIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: registryReader
  }
}
resource account 'Microsoft.Storage/storageAccounts@2026-09-01' existing = if (storage.provider == 'azure') {
  name: storage.provider == 'azure' ? storage.accountName : ''
}
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2026-09-01' existing = if (storage.provider == 'azure') {
  parent: account
  name: 'default'
}
resource reportContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2026-09-01' existing = if (storage.provider == 'azure') {
  parent: blobService
  name: storage.provider == 'azure' ? storage.reportContainer : ''
}
resource imageContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2026-09-01' existing = if (storage.provider == 'azure') {
  parent: blobService
  name: storage.provider == 'azure' ? storage.imageContainer : ''
}
resource objectRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = if (storage.provider == 'azure') {
  name: guid(resourceGroup().id, 'nova-private-blob-objects-v1')
  properties: {
    roleName: 'NOVA private blob objects ${uniqueString(resourceGroup().id)}'
    type: 'CustomRole'
    assignableScopes: [resourceGroup().id]
    permissions: [
      {
        actions: ['Microsoft.Storage/storageAccounts/blobServices/containers/read']
        notActions: []
        dataActions: [
          'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read'
          'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/write'
          'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/delete'
        ]
        notDataActions: []
      }
    ]
  }
}
resource policyRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = if (storage.provider == 'azure') {
  name: guid(resourceGroup().id, 'nova-storage-policy-signing-v1')
  properties: {
    roleName: 'NOVA storage policy and signing ${uniqueString(resourceGroup().id)}'
    type: 'CustomRole'
    assignableScopes: [resourceGroup().id]
    permissions: [
      {
        actions: [
          'Microsoft.Storage/storageAccounts/read'
          'Microsoft.Storage/storageAccounts/blobServices/generateUserDelegationKey/action'
        ]
        notActions: []
        dataActions: []
        notDataActions: []
      }
    ]
  }
}
resource reportAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (storage.provider == 'azure') {
  name: guid(reportContainer!.id, webIdentity.id, objectRole!.id)
  scope: reportContainer!
  properties: {
    principalId: webIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: objectRole!.id
  }
}
resource imageAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (storage.provider == 'azure') {
  name: guid(imageContainer!.id, webIdentity.id, objectRole!.id)
  scope: imageContainer!
  properties: {
    principalId: webIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: objectRole!.id
  }
}
resource policyAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (storage.provider == 'azure') {
  name: guid(account!.id, webIdentity.id, policyRole!.id)
  scope: account!
  properties: {
    principalId: webIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: policyRole!.id
  }
}

// Existing resource only. No workspace, ingestion policy or billable resource creation.
resource insights 'Microsoft.Insights/components@2020-02-02' existing = if (telemetry.provider == 'azure_monitor') {
  name: telemetry.provider == 'azure_monitor' ? telemetry.applicationInsightsName : ''
}
var telemetryPublisher = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '3913510d-42f4-4e42-8a64-420c390055eb')
resource telemetryAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (telemetry.provider == 'azure_monitor') {
  name: guid(insights!.id, webIdentity.id, telemetryPublisher)
  scope: insights
  properties: {
    principalId: webIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: telemetryPublisher
  }
}
