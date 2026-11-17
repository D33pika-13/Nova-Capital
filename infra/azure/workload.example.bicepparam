using './workload.bicep'
param appName = 'nova-staging-example'
param managedEnvironmentName = 'nova-staging-environment'
param managedIdentityName = 'nova-staging-web'
param registryName = 'novastagingexample'
// Synthetic digest must be replaced with the actual reviewed image's digest.
param applicationImage = {
  repository: 'nova-capital'
  sha256: '0000000000000000000000000000000000000000000000000000000000000000'
}
param scannerImage = {
  repository: 'clamav/clamav'
  sha256: '45fe5149fbee5a46509c9848ef20d0c354b7b2323c9369f285939a37cf33422a'
}
param releaseId = 'stage-example-001'
param keyVaultName = 'nova-staging-vault'
param secretReferences = {
  DATABASE_URL: 'nova-database-url/00000000000000000000000000000000'
  SUPABASE_SERVICE_ROLE_KEY: 'nova-service-role/00000000000000000000000000000000'
  CRON_SECRET: 'nova-maintenance-token/00000000000000000000000000000000'
  SMTP_PASSWORD: 'nova-smtp-password/00000000000000000000000000000000'
}
param connections = {
  SUPABASE_URL: 'https://synthetic.supabase.co'
  SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key-not-real'
  SMTP_HOST: 'smtp.example.test'
  SMTP_USER: 'synthetic-sender'
  EMAIL_FROM: 'sender@example.test'
  SUPPORT_EMAIL: 'support@example.test'
  AI_PROVIDER: 'disabled'
  MAINTENANCE_STALE_AFTER_SECONDS: 2700
  STORAGE_PROVIDER: 'supabase'
}
