targetScope = 'resourceGroup'

@minLength(2)
@maxLength(32)
param appName string
@allowed(['staging', 'production'])
param applicationEnvironment string = 'staging'
@description('Existing, operator-owned action group in this resource group. Review recipients and test separately before enabling alerts.')
@minLength(1)
param actionGroupName string
@description('Keep disabled during initial rollout; enable only after receiver/metric validation and notification authorization.')
param alertsEnabled bool = false
@description('Five-minute 5xx count threshold. This is an absolute count, not an error-rate percentage.')
@minValue(1)
@maxValue(1000)
param serverErrorThreshold int = 5

resource app 'Microsoft.App/containerApps@2026-07-01' existing = { name: appName }
resource operators 'Microsoft.Insights/actionGroups@2023-01-01' existing = { name: actionGroupName }
var tags = { application: 'nova-capital', environment: applicationEnvironment }

resource noReplicas 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${appName}-no-replicas'
  location: 'global'
  tags: tags
  properties: {
    description: 'No observed web replicas throughout a five-minute window. Missing telemetry is not zero replicas; pair with an independent availability check.'
    enabled: alertsEnabled
    severity: 1
    scopes: [app.id]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    autoMitigate: true
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'NoWebReplicas'
          criterionType: 'StaticThresholdCriterion'
          metricNamespace: 'Microsoft.App/containerapps'
          metricName: 'Replicas'
          timeAggregation: 'Maximum'
          operator: 'LessThan'
          threshold: 1
          skipMetricValidation: false
        }
      ]
    }
    actions: [{ actionGroupId: operators.id }]
  }
}

resource serverErrors 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${appName}-server-errors'
  location: 'global'
  tags: tags
  properties: {
    description: 'Ingress 5xx response count reaches the configured threshold in five minutes; includes ingress errors and does not imply successful dependency checks.'
    enabled: alertsEnabled
    severity: 2
    scopes: [app.id]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    autoMitigate: true
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'IngressServerErrors'
          criterionType: 'StaticThresholdCriterion'
          metricNamespace: 'Microsoft.App/containerapps'
          metricName: 'Requests'
          dimensions: [{ name: 'statusCodeCategory', operator: 'Include', values: ['5xx'] }]
          timeAggregation: 'Total'
          operator: 'GreaterThanOrEqual'
          threshold: serverErrorThreshold
          skipMetricValidation: false
        }
      ]
    }
    actions: [{ actionGroupId: operators.id }]
  }
}

output replicaAlertId string = noReplicas.id
output serverErrorAlertId string = serverErrors.id
