targetScope = 'resourceGroup'
import { ImmutableImage } from './types.bicep'

@sealed()
type SecretReferences = {
  DATABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string?
  CRON_SECRET: string
  SMTP_PASSWORD: string?
  OPENAI_API_KEY: string?
  CONTACT_HASH_SECRET: string?
}

@sealed()
type Connections = {
  SUPABASE_URL: string?
  SUPABASE_PUBLISHABLE_KEY: string?
  DATABASE_CA_CERT: string?
  SMTP_HOST: string
  SMTP_PORT: int?
  SMTP_USER: string?
  EMAIL_FROM: string
  SUPPORT_EMAIL: string
  REPORT_BUCKET: string?
  OFFER_IMAGE_BUCKET: string?
  REPORT_TIME_ZONE: string?
  MAINTENANCE_STALE_AFTER_SECONDS: int?
  STORAGE_PROVIDER: ('supabase' | 'azure')?
  AZURE_STORAGE_ACCOUNT_NAME: string?
  AZURE_STORAGE_ACCOUNT_RESOURCE_ID: string?
  AI_PROVIDER: ('disabled' | 'openai' | 'azure')?
  OPENAI_MODEL: string?
  AZURE_OPENAI_ENDPOINT: string?
  AZURE_OPENAI_DEPLOYMENT: string?
  AZURE_OPENAI_TOKEN_SCOPE: ('https://cognitiveservices.azure.com/.default' | 'https://ai.azure.com/.default')?
  SUPPORT_AI_DAILY_REQUEST_LIMIT: int?
}

@sealed()
type SupabaseAuthentication = { provider: 'supabase' }
@sealed()
type EntraAuthentication = {
  provider: 'entra'
  tenantId: string
  clientId: string
  tenantSubdomain: string
  loginSecretReference: string
  directoryClientId: string
  directorySecretReference: string
  mfaIssuer: string
  mfaActiveKeyId: string
  mfaKeysSecretReference: string
  recoveryMode: 'hosted_sspr'
}
@discriminator('provider')
type Authentication = SupabaseAuthentication | EntraAuthentication

@sealed()
type ConsoleTelemetry = { provider: 'console' }
@sealed()
type AzureTelemetry = {
  provider: 'azure_monitor'
  connectionSecretReference: string
}
@discriminator('provider')
type Telemetry = ConsoleTelemetry | AzureTelemetry

@discriminator('mode')
type Ingress =
  | {
    mode: 'direct'
  }
  | {
    // Requires a separately verified proxy replacing X-Real-IP and restricted origin access.
    mode: 'trusted_proxy'
    @minLength(1)
    allowedProxyCidrs: string[]
    publicOrigin: string
  }

@minLength(2)
@maxLength(32)
param appName string
@allowed(['staging', 'production'])
param applicationEnvironment string = 'staging'
param location string = resourceGroup().location
param managedEnvironmentName string
param managedIdentityName string
param registryName string
@description('Immutable application image in the selected registry. Build linux/amd64.')
param applicationImage ImmutableImage
@description('Reviewed ClamAV repository and digest. No mutable tag-only image.')
param scannerImage ImmutableImage
@minLength(1)
@maxLength(64)
param releaseId string
param keyVaultName string
// References contain names/versions, never secret values.
#disable-next-line secure-secrets-in-params
param secretReferences SecretReferences
param connections Connections
// These fields contain pinned names/versions, never credential values.
#disable-next-line secure-secrets-in-params
param authentication Authentication = { provider: 'supabase' }
#disable-next-line secure-secrets-in-params
param telemetry Telemetry = { provider: 'console' }
param ingress Ingress = { mode: 'direct' }
@minValue(1)
@maxValue(3)
param maximumReplicas int = 1

resource environment 'Microsoft.App/managedEnvironments@2026-07-01' existing = { name: managedEnvironmentName }
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = { name: managedIdentityName }
resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' existing = { name: registryName }
resource vault 'Microsoft.KeyVault/vaults@2026-02-01' existing = { name: keyVaultName }

var publicOrigin = ingress.mode == 'trusted_proxy'
  ? ingress.publicOrigin
  : 'https://${appName}.${environment.properties.defaultDomain}'
var authenticationEnvironment = authentication.provider == 'entra' ? [
  { name: 'ENTRA_TENANT_ID', value: authentication.tenantId }
  { name: 'ENTRA_CLIENT_ID', value: authentication.clientId }
  { name: 'ENTRA_TENANT_SUBDOMAIN', value: authentication.tenantSubdomain }
  { name: 'ENTRA_DIRECTORY_CLIENT_ID', value: authentication.directoryClientId }
  { name: 'ENTRA_MFA_ISSUER', value: authentication.mfaIssuer }
  { name: 'ENTRA_MFA_ACTIVE_KEY_ID', value: authentication.mfaActiveKeyId }
  { name: 'ENTRA_RECOVERY_MODE', value: authentication.recoveryMode }
] : []
var selectedSecretReferences = union(secretReferences,
  authentication.provider == 'entra' ? {
    ENTRA_CLIENT_SECRET: authentication.loginSecretReference
    ENTRA_DIRECTORY_CLIENT_SECRET: authentication.directorySecretReference
    ENTRA_MFA_ENCRYPTION_KEYS: authentication.mfaKeysSecretReference
  } : {},
  telemetry.provider == 'azure_monitor' ? {
    AZURE_MONITOR_CONNECTION_STRING: telemetry.connectionSecretReference
  } : {})
var telemetryEnvironment = telemetry.provider == 'azure_monitor' ? [
  { name: 'APPLICATION_INSIGHTS_NO_STATSBEAT', value: 'true' }
] : []
var connectionEnvironment = [for entry in items(connections): { name: entry.key, value: string(entry.value) }]
var proxyRestrictions = ingress.mode == 'trusted_proxy'
  ? map(ingress.allowedProxyCidrs, (cidr, index) => {
      name: 'proxy-${index}'
      action: 'Allow'
      ipAddressRange: cidr
      description: 'Approved header-replacing proxy only'
    })
  : []
var commonEnvironment = [
  { name: 'APP_ENV', value: applicationEnvironment }
  { name: 'APP_URL', value: publicOrigin }
  { name: 'SERVICES_ENABLED', value: 'true' }
  { name: 'AUTH_PROVIDER', value: authentication.provider }
  { name: 'OBSERVABILITY_PROVIDER', value: telemetry.provider }
  { name: 'DATABASE_PROVIDER', value: 'postgres' }
  { name: 'DATABASE_TLS_MODE', value: 'verify_full' }
  { name: 'EMAIL_PROVIDER', value: 'smtp' }
  { name: 'SECRETS_PROVIDER', value: 'azure_key_vault' }
  { name: 'AZURE_KEY_VAULT_URL', value: vault.properties.vaultUri }
  { name: 'AZURE_KEY_VAULT_SECRET_MAP', value: string(selectedSecretReferences) }
  { name: 'AZURE_CREDENTIAL_MODE', value: 'managed_identity' }
  { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
  { name: 'SCHEDULER_PROVIDER', value: 'external' }
  { name: 'CONTACT_ENABLED', value: ingress.mode == 'trusted_proxy' ? 'true' : 'false' }
  { name: 'CONTACT_CLIENT_IP_HEADER', value: ingress.mode == 'trusted_proxy' ? 'x-real-ip' : 'none' }
  { name: 'MALWARE_SCANNER_PROVIDER', value: 'clamav' }
  { name: 'CLAMAV_HOST', value: '127.0.0.1' }
  { name: 'CLAMAV_PORT', value: '3310' }
]

var scannerPolicy = loadJsonContent('../scanner/policy.json')
var scannerClamdEnvironment = [for setting in items(scannerPolicy.clamd): { name: 'CLAMD_CONF_${setting.key}', value: setting.value }]
var scannerFreshclamEnvironment = [for setting in items(scannerPolicy.freshclam): { name: 'FRESHCLAM_CONF_${setting.key}', value: setting.value }]
var scannerEnvironment = concat(scannerClamdEnvironment, scannerFreshclamEnvironment, [{ name: 'FRESHCLAM_CHECKS', value: scannerPolicy.updateChecks }])

resource app 'Microsoft.App/containerApps@2026-07-01' = {
  name: appName
  location: location
  tags: { application: 'nova-capital', environment: applicationEnvironment }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    environmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      maxInactiveRevisions: 10
      registries: [{ server: registry.properties.loginServer, identity: identity.id }]
      ingress: {
        external: true
        targetPort: 3000
        transport: 'http'
        allowInsecure: false
        ipSecurityRestrictions: proxyRestrictions
      }
    }
    template: {
      revisionSuffix: releaseId
      terminationGracePeriodSeconds: 30
      scale: { minReplicas: 1, maxReplicas: maximumReplicas }
      containers: [
        {
          name: 'web'
          image: '${registry.properties.loginServer}/${applicationImage.repository}@sha256:${applicationImage.sha256}'
          command: ['node', 'scripts/standalone-entry.mjs']
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(commonEnvironment, connectionEnvironment, authenticationEnvironment, telemetryEnvironment)
          probes: [
            {
              type: 'Startup'
              httpGet: { path: '/api/health', port: 3000 }
              periodSeconds: 5
              timeoutSeconds: 3
              failureThreshold: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: '/api/health', port: 3000 }
              periodSeconds: 10
              timeoutSeconds: 3
              failureThreshold: 3
            }
            {
              type: 'Liveness'
              httpGet: { path: '/api/health', port: 3000 }
              periodSeconds: 30
              timeoutSeconds: 3
              failureThreshold: 3
            }
          ]
        }
        {
          name: 'scanner'
          image: '${scannerImage.repository}@sha256:${scannerImage.sha256}'
          env: concat(scannerEnvironment, [{ name: 'CLAMD_CONF_TCPAddr', value: '127.0.0.1' }])
          resources: { cpu: json('1.5'), memory: '3Gi' }
          probes: [
            { type: 'Startup', tcpSocket: { port: 3310 }, periodSeconds: 10, timeoutSeconds: 3, failureThreshold: 60 }
            { type: 'Readiness', tcpSocket: { port: 3310 }, periodSeconds: 10, timeoutSeconds: 3, failureThreshold: 3 }
          ]
        }
      ]
    }
  }
}

output containerAppId string = app.id
output configuredApplicationOrigin string = publicOrigin
output containerAppOrigin string = 'https://${app.properties.configuration.ingress.fqdn}'
