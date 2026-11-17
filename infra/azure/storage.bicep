targetScope = 'resourceGroup'

@description('Lowercase alphanumeric prefix beginning with a letter; validate actual Azure naming before applying.')
@minLength(2)
@maxLength(10)
param namePrefix string = 'nova'
@allowed(['staging', 'production'])
param applicationEnvironment string = 'staging'
param location string = resourceGroup().location
@description('Review regional availability and recovery requirements; no automatic redundancy fallback.')
@allowed(['Standard_LRS', 'Standard_ZRS'])
param redundancy string = 'Standard_ZRS'
@description('Deleted blobs and containers remain recoverable and billable during this interval. Not a backup.')
@minValue(7)
@maxValue(90)
param deletionRetentionDays int = 14

var suffix = uniqueString(
  subscription().subscriptionId,
  resourceGroup().id,
  namePrefix,
  applicationEnvironment,
  'storage'
)
var reportContainerName = 'client-reports'
var imageContainerName = 'offer-images'

resource account 'Microsoft.Storage/storageAccounts@2026-09-01' = {
  name: '${namePrefix}${suffix}'
  location: location
  tags: { application: 'nova-capital', environment: applicationEnvironment }
  kind: 'StorageV2'
  sku: { name: redundancy }
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    allowCrossTenantReplication: false
    defaultToOAuthAuthentication: true
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    isHnsEnabled: false
    isNfsV3Enabled: false
    isSftpEnabled: false
    isLocalUserEnabled: false
    // Authorized clients download direct, short-lived user-delegation SAS URLs.
    // A private endpoint alone would make those URLs unreachable to recipients.
    publicNetworkAccess: 'Enabled'
    networkAcls: { bypass: 'None', defaultAction: 'Allow', ipRules: [], virtualNetworkRules: [] }
    encryption: {
      keySource: 'Microsoft.Storage'
      services: { blob: { enabled: true, keyType: 'Account' } }
    }
  }
}

resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2026-09-01' = {
  parent: account
  name: 'default'
  properties: {
    // App objects are immutable, and cleanup has no version/snapshot-delete authority.
    isVersioningEnabled: false
    deleteRetentionPolicy: { enabled: true, days: deletionRetentionDays }
    containerDeleteRetentionPolicy: { enabled: true, days: deletionRetentionDays }
    cors: { corsRules: [] }
  }
}

resource reports 'Microsoft.Storage/storageAccounts/blobServices/containers@2026-09-01' = {
  parent: blobs
  name: reportContainerName
  properties: { publicAccess: 'None' }
}
resource images 'Microsoft.Storage/storageAccounts/blobServices/containers@2026-09-01' = {
  parent: blobs
  name: imageContainerName
  properties: { publicAccess: 'None' }
}

// No storage keys or SAS tokens in deployment outputs.
output accountName string = account.name
output accountResourceId string = account.id
output reportContainer string = reports.name
output imageContainer string = images.name
