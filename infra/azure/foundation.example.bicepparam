using './foundation.bicep'

// Synthetic review example; provision only after region, network and cost review.
param namePrefix = 'novademo'
param applicationEnvironment = 'staging'
param networkAddressPrefix = '10.42.0.0/16'
param applicationSubnetPrefix = '10.42.0.0/23'
param privateEndpointSubnetPrefix = '10.42.2.0/27'
param logDailyQuotaGb = 1
