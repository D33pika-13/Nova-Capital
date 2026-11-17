targetScope = 'resourceGroup'

@minLength(2)
@maxLength(32)
param appName string
@allowed(['staging', 'production'])
param applicationEnvironment string = 'staging'
@minLength(1)
param applicationInsightsName string
@description('Region of the existing Application Insights resource; verify the match before deployment.')
@minLength(1)
param location string = resourceGroup().location
@description('Existing reviewed operator action group in the same resource group; no recipients are created.')
@minLength(1)
param actionGroupName string
@description('Requires authorized monitoring spend and permission to probe this app. Validate results before enabling notifications.')
param probeEnabled bool = false
@description('Enable only after receiver review and notification authorization. Cannot enable a rule while its probe is disabled.')
param alertsEnabled bool = false
@minValue(1)
@maxValue(5)
param failedLocationCount int = 3

resource app 'Microsoft.App/containerApps@2026-07-01' existing = { name: appName }
resource insights 'Microsoft.Insights/components@2020-02-02' existing = { name: applicationInsightsName }
resource operators 'Microsoft.Insights/actionGroups@2023-01-01' existing = { name: actionGroupName }
var tags = { application: 'nova-capital', environment: applicationEnvironment }
var probeName = '${appName}-https-availability'

// The managed FQDN derives from the selected existing app, never caller URLs,
// credentials, query strings or arbitrary private paths. Proxy-only origins
// need a separate approved public-proxy probe; do not bypass ingress controls.
resource probe 'Microsoft.Insights/webtests@2022-06-15' = {
  name: probeName
  location: location
  kind: 'standard'
  tags: union(tags, { 'hidden-link:${insights.id}': 'Resource' })
  properties: {
    Name: probeName
    SyntheticMonitorId: probeName
    Description: 'HTTPS/configuration liveness at the managed direct-ingress app origin. Does not verify dependencies, private journeys or a separate public proxy.'
    Kind: 'standard'
    Enabled: probeEnabled
    Frequency: 300
    Timeout: 30
    RetryEnabled: true
    Locations: [
      { Id: 'us-va-ash-azr' }
      { Id: 'us-ca-sjc-azr' }
      { Id: 'emea-nl-ams-azr' }
      { Id: 'apac-sg-sin-azr' }
      { Id: 'apac-jp-kaw-edge' }
    ]
    Request: {
      RequestUrl: 'https://${app.properties.configuration.ingress.fqdn}/api/health'
      HttpVerb: 'GET'
      FollowRedirects: false
      ParseDependentRequests: false
    }
    ValidationRules: {
      ExpectedHttpStatusCode: 200
      IgnoreHttpStatusCode: false
      SSLCheck: true
      SSLCertRemainingLifetimeCheck: 7
      ContentValidation: {
        ContentMatch: '"mode":"configured"'
        IgnoreCase: false
        PassIfTextFound: true
      }
    }
  }
}

resource unavailable 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${appName}-https-unavailable'
  location: 'global'
  tags: tags
  properties: {
    description: 'Configured HTTPS probe fails from the selected number of locations. Missing test data, dependency health and separate proxy availability are not established.'
    enabled: probeEnabled && alertsEnabled
    severity: 1
    scopes: [probe.id, insights.id]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    autoMitigate: true
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.WebtestLocationAvailabilityCriteria'
      componentId: insights.id
      webTestId: probe.id
      failedLocationCount: failedLocationCount
    }
    actions: [{ actionGroupId: operators.id }]
  }
}

output probeId string = probe.id
output availabilityAlertId string = unavailable.id
