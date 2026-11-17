targetScope = 'resourceGroup'

@description('Lowercase alphanumeric prefix, beginning with a letter; review Azure naming validation before applying.')
@minLength(2)
@maxLength(10)
param namePrefix string = 'nova'
@allowed(['staging', 'production'])
param applicationEnvironment string = 'staging'
param location string = resourceGroup().location
@description('Review nonoverlapping address ranges against the target network before deployment.')
param networkAddressPrefix string = '10.42.0.0/16'
param applicationSubnetPrefix string = '10.42.0.0/23'
param privateEndpointSubnetPrefix string = '10.42.2.0/27'
@minValue(1)
@maxValue(10)
param logDailyQuotaGb int = 1

var suffix = uniqueString(subscription().subscriptionId, resourceGroup().id, namePrefix, applicationEnvironment)
var stem = '${namePrefix}-${applicationEnvironment}'
var tags = { application: 'nova-capital', environment: applicationEnvironment }

resource network 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${stem}-network'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: [networkAddressPrefix] }
    subnets: [
      {
        name: 'applications'
        properties: {
          addressPrefix: applicationSubnetPrefix
          delegations: [
            { name: 'container-apps', properties: { serviceName: 'Microsoft.App/environments' } }
          ]
        }
      }
      {
        name: 'private-endpoints'
        properties: {
          addressPrefix: privateEndpointSubnetPrefix
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${stem}-logs'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: logDailyQuotaGb }
    features: { disableLocalAuth: true, enableLogAccessUsingOnlyResourcePermissions: true }
  }
}

resource environment 'Microsoft.App/managedEnvironments@2026-07-01' = {
  name: '${stem}-environment'
  location: location
  tags: tags
  properties: {
    environmentMode: 'WorkloadProfiles'
    vnetConfiguration: {
      infrastructureSubnetId: '${network.id}/subnets/applications'
      internal: false
    }
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
    appLogsConfiguration: { destination: 'azure-monitor' }
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'application-logs'
  scope: environment
  properties: {
    workspaceId: workspace.id
    logs: [{ categoryGroup: 'allLogs', enabled: true }]
  }
}

resource webIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: '${stem}-web'
  location: location
  tags: tags
}
resource jobIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: '${stem}-maintenance'
  location: location
  tags: tags
}
resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' = {
  name: '${namePrefix}${suffix}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
    anonymousPullEnabled: false
    roleAssignmentMode: 'LegacyRegistryPermissions'
    publicNetworkAccess: 'Enabled'
  }
}

resource vault 'Microsoft.KeyVault/vaults@2026-02-01' = {
  name: '${namePrefix}${suffix}'
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    enablePurgeProtection: true
    softDeleteRetentionInDays: 90
    publicNetworkAccess: 'Disabled'
    networkAcls: { bypass: 'None', defaultAction: 'Deny' }
  }
}
resource vaultDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.vaultcore.azure.net'
  location: 'global'
  tags: tags
}
resource vaultDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: vaultDns
  name: '${stem}-link'
  location: 'global'
  properties: { virtualNetwork: { id: network.id }, registrationEnabled: false }
}
resource vaultEndpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: '${stem}-vault-endpoint'
  location: location
  tags: tags
  properties: {
    subnet: { id: '${network.id}/subnets/private-endpoints' }
    privateLinkServiceConnections: [
      {
        name: 'vault'
        properties: { privateLinkServiceId: vault.id, groupIds: ['vault'] }
      }
    ]
  }
}
resource vaultDnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = {
  parent: vaultEndpoint
  name: 'vault'
  properties: { privateDnsZoneConfigs: [{ name: 'vault', properties: { privateDnsZoneId: vaultDns.id } }] }
}

// Names and resource identifiers only; no keys, credentials or listKeys calls.
output managedEnvironmentName string = environment.name
output managedIdentityName string = webIdentity.name
output maintenanceIdentityName string = jobIdentity.name
output registryName string = registry.name
output keyVaultName string = vault.name
output workspaceResourceId string = workspace.id
output networkResourceId string = network.id
