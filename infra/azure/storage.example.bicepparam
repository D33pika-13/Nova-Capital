using './storage.bicep'

// Synthetic review example, not authorization to provision or select a paid plan.
param namePrefix = 'novademo'
param applicationEnvironment = 'staging'
param redundancy = 'Standard_ZRS'
param deletionRetentionDays = 14
