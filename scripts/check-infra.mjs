import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const execute = promisify(execFile);
const compiler = process.env.BICEP_BIN ?? "bicep";
const temporary = await mkdtemp(path.join(tmpdir(), "nova-infra-check-"));
try {
  const version = await execute(compiler, ["--version"]);
  assert.match(
    version.stdout,
    /Bicep CLI version 0\.49\.2\b/,
    "Use the verified Bicep 0.49.2 toolchain",
  );
  const templates = {};
  for (const name of [
    "foundation",
    "storage",
    "monitoring",
    "availability",
    "scheduler-monitoring",
    "workload",
    "maintenance",
    "access",
  ]) {
    const target = path.join(temporary, `${name}.json`);
    const result = await execute(compiler, [
      "build",
      `infra/azure/${name}.bicep`,
      "--outfile",
      target,
    ]);
    assert.equal(result.stderr.trim(), "", "Bicep emitted diagnostics");
    templates[name] = JSON.parse(await readFile(target, "utf8"));
    const parameters = await execute(compiler, [
      "build-params",
      `infra/azure/${name}.example.bicepparam`,
      "--outfile",
      path.join(temporary, `${name}.parameters.json`),
    ]);
    assert.equal(parameters.stderr.trim(), "", "Example parameter diagnostics");
  }
  const example = (
    await readFile("infra/azure/workload.example.bicepparam", "utf8")
  ).replace(
    "using './workload.bicep'",
    `using '${path.relative(temporary, path.resolve("infra/azure/workload.bicep")).split(path.sep).join("/")}'`,
  );
  const compileFixture = async (text, label, rejected) => {
    const source = path.join(temporary, `${label}.bicepparam`);
    await writeFile(source, text);
    let failure;
    try {
      await execute(compiler, [
        "build-params",
        source,
        "--outfile",
        path.join(temporary, `${label}.json`),
      ]);
    } catch (error) {
      failure = error;
    }
    assert.equal(
      Boolean(failure),
      rejected,
      `Unexpected parameter result for ${label}`,
    );
    if (failure)
      assert.match(
        failure.stderr,
        /BCP037|BCP036|BCP035|BCP033|BCP327|BCP328|BCP333|BCP335/,
      );
  };
  await compileFixture(example, "positive-control", false);
  await compileFixture(
    example.replace(
      "  SUPABASE_URL:",
      "  DATABASE_URL: 'synthetic-plaintext-secret'\n  SUPABASE_URL:",
    ),
    "plaintext-credential",
    true,
  );
  await compileFixture(
    example.replace(
      "sha256: '0000000000000000000000000000000000000000000000000000000000000000'",
      "sha256: 'mutable-tag'",
    ),
    "mutable-image",
    true,
  );
  await compileFixture(
    `${example}\nparam ingress = {mode: 'trusted_proxy', publicOrigin: 'https://proxy.example.test', allowedProxyCidrs: []}\n`,
    "unrestricted-contact-origin",
    true,
  );
  const entraExample = (
    await readFile("infra/azure/workload.entra.example.bicepparam", "utf8")
  ).replace(
    "using './workload.bicep'",
    `using '${path.relative(temporary, path.resolve("infra/azure/workload.bicep")).split(path.sep).join("/")}'`,
  );
  await compileFixture(entraExample, "entra-azure-monitor-positive", false);
  await compileFixture(
    entraExample.replace(
      "  directoryClientId: '60000000-0000-4000-8000-000000000006'\n",
      "",
    ),
    "entra-missing-directory",
    true,
  );
  await compileFixture(
    entraExample.replace(
      "recoveryMode: 'hosted_sspr'",
      "recoveryMode: 'email_bypass'",
    ),
    "entra-unreviewed-recovery",
    true,
  );
  await compileFixture(
    entraExample.replace(
      "  connectionSecretReference: 'nova-monitor-connection/00000000000000000000000000000000'\n",
      "",
    ),
    "monitor-missing-reference",
    true,
  );
  await compileFixture(
    entraExample.replace(
      "provider: 'azure_monitor'",
      "provider: 'arbitrary_exporter'",
    ),
    "unsupported-telemetry",
    true,
  );
  await compileFixture(
    entraExample.replace(
      "  SMTP_HOST:",
      "  ENTRA_CLIENT_SECRET: 'synthetic-plaintext-secret'\n  SMTP_HOST:",
    ),
    "plaintext-entra-connection",
    true,
  );
  await compileFixture(
    entraExample.replace(
      "  mfaIssuer:",
      "  clientSecret: 'synthetic-plaintext-secret'\n  mfaIssuer:",
    ),
    "plaintext-entra-authentication",
    true,
  );
  const selectedParameters = JSON.parse(
    await readFile(
      path.join(temporary, "entra-azure-monitor-positive.json"),
      "utf8",
    ),
  ).parameters;
  assert.equal(selectedParameters.authentication.value.provider, "entra");
  assert.equal(selectedParameters.telemetry.value.provider, "azure_monitor");
  assert.ok(
    !Object.keys(selectedParameters.connections.value).some((key) =>
      key.startsWith("SUPABASE"),
    ),
  );
  assert.ok(
    !Object.hasOwn(
      selectedParameters.secretReferences.value,
      "SUPABASE_SERVICE_ROLE_KEY",
    ),
  );
  const storageExample = (
    await readFile("infra/azure/storage.example.bicepparam", "utf8")
  ).replace(
    "using './storage.bicep'",
    `using '${path.relative(temporary, path.resolve("infra/azure/storage.bicep")).split(path.sep).join("/")}'`,
  );
  await compileFixture(storageExample, "storage-positive", false);
  await compileFixture(
    storageExample.replace("'Standard_ZRS'", "'Premium_LRS'"),
    "unsupported-storage-sku",
    true,
  );
  await compileFixture(
    storageExample.replace(
      "deletionRetentionDays = 14",
      "deletionRetentionDays = 0",
    ),
    "storage-retention-disabled",
    true,
  );
  const storageResources = templates.storage.resources;
  const monitoringExample = (
    await readFile("infra/azure/monitoring.example.bicepparam", "utf8")
  ).replace(
    "using './monitoring.bicep'",
    `using '${path.relative(temporary, path.resolve("infra/azure/monitoring.bicep")).split(path.sep).join("/")}'`,
  );
  await compileFixture(monitoringExample, "monitoring-positive", false);
  await compileFixture(
    monitoringExample.replace(
      "serverErrorThreshold = 5",
      "serverErrorThreshold = 0",
    ),
    "monitoring-zero-error-threshold",
    true,
  );
  await compileFixture(
    monitoringExample.replace("'nova-staging-operators-example'", "''"),
    "monitoring-no-action-group",
    true,
  );
  const alerts = templates.monitoring.resources;
  assert.equal(
    alerts.length,
    2,
    "Monitoring must not create notification recipients",
  );
  assert.equal(
    templates.monitoring.parameters.alertsEnabled.defaultValue,
    false,
  );
  for (const alert of alerts) {
    assert.equal(alert.type, "Microsoft.Insights/metricAlerts");
    assert.equal(alert.location, "global");
    assert.equal(alert.properties.enabled, "[parameters('alertsEnabled')]");
    assert.equal(alert.properties.scopes.length, 1);
    assert.ok(
      alert.properties.scopes[0].includes("Microsoft.App/containerApps"),
    );
    assert.equal(alert.properties.evaluationFrequency, "PT1M");
    assert.equal(alert.properties.windowSize, "PT5M");
    assert.equal(alert.properties.autoMitigate, true);
    assert.equal(alert.properties.actions.length, 1);
    assert.ok(
      alert.properties.actions[0].actionGroupId.includes(
        "Microsoft.Insights/actionGroups",
      ),
    );
    assert.equal(alert.properties.criteria.allOf.length, 1);
    assert.equal(
      alert.properties.criteria["odata.type"],
      "Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria",
    );
    assert.equal(
      alert.properties.criteria.allOf[0].metricNamespace,
      "Microsoft.App/containerapps",
    );
    assert.equal(
      alert.properties.criteria.allOf[0].skipMetricValidation,
      false,
    );
    assert.equal(
      alert.properties.criteria.allOf[0].criterionType,
      "StaticThresholdCriterion",
    );
  }
  const replicas = alerts.find(
    (alert) => alert.properties.criteria.allOf[0].metricName === "Replicas",
  );
  assert.equal(replicas.properties.severity, 1);
  assert.equal(
    replicas.properties.criteria.allOf[0].timeAggregation,
    "Maximum",
  );
  assert.equal(replicas.properties.criteria.allOf[0].operator, "LessThan");
  assert.equal(replicas.properties.criteria.allOf[0].threshold, 1);
  const errors = alerts.find(
    (alert) => alert.properties.criteria.allOf[0].metricName === "Requests",
  );
  assert.equal(errors.properties.severity, 2);
  assert.equal(
    errors.properties.criteria.allOf[0].threshold,
    "[parameters('serverErrorThreshold')]",
  );
  assert.equal(
    templates.monitoring.parameters.serverErrorThreshold.minValue,
    1,
  );
  assert.equal(
    templates.monitoring.parameters.serverErrorThreshold.maxValue,
    1000,
  );
  assert.equal(errors.properties.criteria.allOf[0].timeAggregation, "Total");
  assert.equal(
    errors.properties.criteria.allOf[0].operator,
    "GreaterThanOrEqual",
  );
  assert.deepEqual(errors.properties.criteria.allOf[0].dimensions, [
    { name: "statusCodeCategory", operator: "Include", values: ["5xx"] },
  ]);
  const availabilityExample = (
    await readFile("infra/azure/availability.example.bicepparam", "utf8")
  ).replace(
    "using './availability.bicep'",
    `using '${path.relative(temporary, path.resolve("infra/azure/availability.bicep")).split(path.sep).join("/")}'`,
  );
  await compileFixture(availabilityExample, "availability-positive", false);
  for (const threshold of [0, 6])
    await compileFixture(
      availabilityExample.replace(
        "failedLocationCount = 3",
        `failedLocationCount = ${threshold}`,
      ),
      `availability-threshold-${threshold}`,
      true,
    );
  for (const [name, replacement] of [
    ["insights", ["'nova-staging-insights-example'", "''"]],
    ["receivers", ["'nova-staging-operators-example'", "''"]],
    ["environment", ["'staging'", "'development'"]],
    ["enabled-type", ["probeEnabled = false", "probeEnabled = 'true'"]],
  ])
    await compileFixture(
      availabilityExample.replace(...replacement),
      `availability-${name}`,
      true,
    );
  await compileFixture(
    availabilityExample.replace("probeEnabled = false", "probeEnabled = true"),
    "availability-probe-only",
    false,
  );
  await compileFixture(
    availabilityExample
      .replace("probeEnabled = false", "probeEnabled = true")
      .replace("alertsEnabled = false", "alertsEnabled = true"),
    "availability-enabled",
    false,
  );
  const availability = templates.availability;
  assert.equal(
    availability.resources.length,
    2,
    "Availability cannot create recipients, identities or role grants",
  );
  assert.equal(availability.parameters.probeEnabled.defaultValue, false);
  assert.equal(availability.parameters.alertsEnabled.defaultValue, false);
  assert.equal(availability.parameters.failedLocationCount.minValue, 1);
  assert.equal(availability.parameters.failedLocationCount.maxValue, 5);
  const probe = availability.resources.find(
    (resource) => resource.type === "Microsoft.Insights/webtests",
  );
  assert.equal(probe.kind, "standard");
  assert.equal(probe.properties.Kind, "standard");
  assert.equal(probe.properties.Enabled, "[parameters('probeEnabled')]");
  assert.equal(probe.properties.Frequency, 300);
  assert.equal(probe.properties.Timeout, 30);
  assert.equal(probe.properties.RetryEnabled, true);
  const request = probe.properties.Request;
  assert.equal(request.HttpVerb, "GET");
  assert.equal(request.FollowRedirects, false);
  assert.equal(request.ParseDependentRequests, false);
  assert.deepEqual(Object.keys(request).sort(), [
    "FollowRedirects",
    "HttpVerb",
    "ParseDependentRequests",
    "RequestUrl",
  ]);
  assert.match(
    request.RequestUrl,
    /^\[format\('https:\/\/\{0\}\/api\/health', reference\(resourceId\('Microsoft.App\/containerApps', parameters\('appName'\)\), '2026-07-01'\)\.configuration\.ingress\.fqdn\)\]$/,
  );
  assert.deepEqual(
    probe.properties.Locations.map((item) => item.Id),
    [
      "us-va-ash-azr",
      "us-ca-sjc-azr",
      "emea-nl-ams-azr",
      "apac-sg-sin-azr",
      "apac-jp-kaw-edge",
    ],
  );
  assert.deepEqual(probe.properties.ValidationRules, {
    ExpectedHttpStatusCode: 200,
    IgnoreHttpStatusCode: false,
    SSLCheck: true,
    SSLCertRemainingLifetimeCheck: 7,
    ContentValidation: {
      ContentMatch: '\"mode\":\"configured\"',
      IgnoreCase: false,
      PassIfTextFound: true,
    },
  });
  const availabilityAlert = availability.resources.find(
    (resource) => resource.type === "Microsoft.Insights/metricAlerts",
  );
  assert.equal(
    availabilityAlert.properties.enabled,
    "[and(parameters('probeEnabled'), parameters('alertsEnabled'))]",
  );
  assert.equal(availabilityAlert.properties.severity, 1);
  assert.equal(availabilityAlert.properties.evaluationFrequency, "PT1M");
  assert.equal(availabilityAlert.properties.windowSize, "PT5M");
  assert.equal(availabilityAlert.properties.autoMitigate, true);
  const criteria = availabilityAlert.properties.criteria;
  assert.equal(
    criteria["odata.type"],
    "Microsoft.Azure.Monitor.WebtestLocationAvailabilityCriteria",
  );
  assert.equal(
    criteria.failedLocationCount,
    "[parameters('failedLocationCount')]",
  );
  assert.match(criteria.componentId, /Microsoft.Insights\/components/);
  assert.match(criteria.webTestId, /Microsoft.Insights\/webtests/);
  assert.deepEqual(availabilityAlert.properties.scopes, [
    criteria.webTestId,
    criteria.componentId,
  ]);
  assert.equal(availabilityAlert.properties.actions.length, 1);
  assert.match(
    availabilityAlert.properties.actions[0].actionGroupId,
    /Microsoft.Insights\/actionGroups/,
  );
  const schedulerExample = (
    await readFile(
      "infra/azure/scheduler-monitoring.example.bicepparam",
      "utf8",
    )
  ).replace(
    "using './scheduler-monitoring.bicep'",
    `using '${path.relative(temporary, path.resolve("infra/azure/scheduler-monitoring.bicep")).split(path.sep).join("/")}'`,
  );
  await compileFixture(schedulerExample, "scheduler-alert-positive", false);
  for (const value of [4, 1441])
    await compileFixture(
      schedulerExample.replace(
        "staleAfterMinutes = 45",
        `staleAfterMinutes = ${value}`,
      ),
      `scheduler-alert-bound-${value}`,
      true,
    );
  for (const value of [5, 1440])
    await compileFixture(
      schedulerExample.replace(
        "staleAfterMinutes = 45",
        `staleAfterMinutes = ${value}`,
      ),
      `scheduler-alert-bound-${value}`,
      false,
    );
  for (const [name, value] of [
    ["identity", "nova-staging-alert-query-example"],
    ["workspace", "nova-staging-logs-example"],
    ["insights", "nova-staging-insights-example"],
    ["receivers", "nova-staging-operators-example"],
  ])
    await compileFixture(
      schedulerExample.replace(`'${value}'`, "''"),
      `scheduler-alert-empty-${name}`,
      true,
    );
  await compileFixture(
    schedulerExample.replace("alertsEnabled = false", "alertsEnabled = true"),
    "scheduler-alert-enabled",
    false,
  );
  const scheduler = templates["scheduler-monitoring"];
  assert.equal(
    scheduler.resources.length,
    1,
    "Scheduler monitoring creates only its rule loop, with no recipients, role grants or identities",
  );
  assert.equal(scheduler.parameters.alertsEnabled.defaultValue, false);
  assert.equal(scheduler.parameters.staleAfterMinutes.minValue, 5);
  assert.equal(scheduler.parameters.staleAfterMinutes.maxValue, 1440);
  assert.equal(scheduler.variables.rules.length, 2);
  const schedulerAlert = scheduler.resources[0];
  assert.equal(schedulerAlert.type, "Microsoft.Insights/scheduledQueryRules");
  assert.equal(schedulerAlert.kind, "LogAlert");
  assert.equal(schedulerAlert.identity.type, "UserAssigned");
  assert.equal(
    Object.keys(schedulerAlert.identity.userAssignedIdentities).length,
    1,
  );
  assert.match(
    Object.keys(schedulerAlert.identity.userAssignedIdentities)[0],
    /Microsoft.ManagedIdentity\/userAssignedIdentities.*queryIdentityName/,
  );
  assert.equal(schedulerAlert.copy.count, "[length(variables('rules'))]");
  assert.equal(
    schedulerAlert.properties.enabled,
    "[parameters('alertsEnabled')]",
  );
  assert.equal(schedulerAlert.properties.skipQueryValidation, false);
  assert.equal(schedulerAlert.properties.evaluationFrequency, "PT5M");
  assert.equal(schedulerAlert.properties.windowSize, "PT5M");
  assert.equal(schedulerAlert.properties.autoMitigate, true);
  assert.equal(schedulerAlert.properties.severity, 1);
  assert.equal(schedulerAlert.properties.scopes.length, 1);
  assert.match(
    schedulerAlert.properties.scopes[0],
    /Microsoft.OperationalInsights\/workspaces/,
  );
  assert.equal(schedulerAlert.properties.actions.actionGroups.length, 1);
  assert.match(
    schedulerAlert.properties.actions.actionGroups[0],
    /Microsoft.Insights\/actionGroups/,
  );
  const condition = schedulerAlert.properties.criteria.allOf;
  assert.equal(condition.length, 1);
  assert.equal(condition[0].metricMeasureColumn, "Evidence");
  assert.equal(condition[0].timeAggregation, "Maximum");
  assert.deepEqual(condition[0].failingPeriods, {
    numberOfEvaluationPeriods: 1,
    minFailingPeriodsToAlert: 1,
  });
  const querySource = scheduler.variables.source.replaceAll("''", "'");
  for (const fragment of [
    "AppDependencies",
    "_ResourceId =~ base64_decode_tostring('{0}')",
    "AppRoleName == 'nova-capital'",
    "Properties['nova.provider']) == 'postgres'",
    "Properties['nova.maintenance_origin']) == 'scheduler'",
    "base64(resourceId('Microsoft.Insights/components', parameters('applicationInsightsName')))",
  ])
    assert.ok(
      querySource.includes(fragment),
      "Scheduler query lost its source/scheduled identity boundary",
    );
  for (const rule of scheduler.variables.rules) {
    assert.ok(
      !rule.query.includes("${"),
      "Bicep multiline text must use explicit format interpolation",
    );
    assert.ok(rule.query.includes("variables('source')"));
    assert.ok(rule.query.includes("TimeGenerated <= now()"));
    assert.ok(rule.query.includes("summarize Evidence=count()"));
    assert.ok(rule.query.includes("extend TimeGenerated=now()"));
    assert.ok(
      !rule.query.includes(" by "),
      "An empty stream must retain a zero-evidence aggregate row",
    );
  }
  const noSuccess = scheduler.variables.rules.find(
    (rule) => rule.suffix === "scheduler-no-success",
  );
  assert.equal(noSuccess.operator, "LessThan");
  assert.equal(noSuccess.threshold, 1);
  assert.equal(
    noSuccess.lookback,
    "[format('PT{0}M', parameters('staleAfterMinutes'))]",
  );
  assert.ok(noSuccess.query.includes("ago({1}m)"));
  assert.ok(noSuccess.query.includes("parameters('staleAfterMinutes')"));
  assert.ok(noSuccess.query.includes("maintenance.batch_completed"));
  assert.ok(noSuccess.query.includes("Success == true"));
  assert.ok(noSuccess.query.includes("''ok''"));
  const failed = scheduler.variables.rules.find(
    (rule) => rule.suffix === "scheduler-failed",
  );
  assert.equal(failed.operator, "GreaterThan");
  assert.equal(failed.threshold, 0);
  assert.equal(failed.lookback, "PT5M");
  for (const fragment of [
    "ago(5m)",
    "maintenance.batch_failed",
    "maintenance.batch_unconfirmed",
    "Success == false",
    "''failed''",
    "''unavailable''",
  ])
    assert.ok(failed.query.includes(fragment));
  const storageAccount = storageResources.find(
    (resource) => resource.type === "Microsoft.Storage/storageAccounts",
  );
  const blobService = storageResources.find(
    (resource) =>
      resource.type === "Microsoft.Storage/storageAccounts/blobServices",
  );
  const privateContainers = storageResources.filter(
    (resource) =>
      resource.type ===
      "Microsoft.Storage/storageAccounts/blobServices/containers",
  );
  assert.equal(storageResources.length, 4);
  assert.equal(storageAccount.kind, "StorageV2");
  for (const setting of [
    "allowBlobPublicAccess",
    "allowSharedKeyAccess",
    "allowCrossTenantReplication",
    "isHnsEnabled",
    "isNfsV3Enabled",
    "isSftpEnabled",
    "isLocalUserEnabled",
  ])
    assert.equal(storageAccount.properties[setting], false, setting);
  assert.equal(storageAccount.properties.supportsHttpsTrafficOnly, true);
  assert.equal(storageAccount.properties.defaultToOAuthAuthentication, true);
  assert.equal(storageAccount.properties.minimumTlsVersion, "TLS1_2");
  assert.equal(
    storageAccount.properties.encryption.services.blob.enabled,
    true,
  );
  assert.equal(storageAccount.properties.publicNetworkAccess, "Enabled");
  assert.equal(storageAccount.properties.networkAcls.bypass, "None");
  assert.equal(blobService.properties.isVersioningEnabled, false);
  for (const policy of [
    "deleteRetentionPolicy",
    "containerDeleteRetentionPolicy",
  ]) {
    assert.equal(blobService.properties[policy].enabled, true);
    assert.equal(
      blobService.properties[policy].days,
      "[parameters('deletionRetentionDays')]",
    );
  }
  assert.deepEqual(blobService.properties.cors.corsRules, []);
  assert.equal(privateContainers.length, 2);
  assert.notEqual(privateContainers[0].name, privateContainers[1].name);
  assert.ok(
    privateContainers.every(
      (resource) => resource.properties.publicAccess === "None",
    ),
  );
  assert.ok(
    !/listKeys\(|listAccountSas\(|listServiceSas\(/i.test(
      JSON.stringify(templates.storage),
    ),
  );
  // Untyped Bicep emits ARM v1 resource arrays; typed workload templates use
  // ARM v2 symbolic resource objects. Inspect each foundation resource by type.
  const foundationTypes = {
    network: "Microsoft.Network/virtualNetworks",
    workspace: "Microsoft.OperationalInsights/workspaces",
    environment: "Microsoft.App/managedEnvironments",
    diagnostics: "Microsoft.Insights/diagnosticSettings",
    registry: "Microsoft.ContainerRegistry/registries",
    vault: "Microsoft.KeyVault/vaults",
    vaultDns: "Microsoft.Network/privateDnsZones",
    vaultDnsLink: "Microsoft.Network/privateDnsZones/virtualNetworkLinks",
    vaultEndpoint: "Microsoft.Network/privateEndpoints",
    vaultDnsGroup: "Microsoft.Network/privateEndpoints/privateDnsZoneGroups",
  };
  const foundation = Object.fromEntries(
    Object.entries(foundationTypes).map(([key, type]) => {
      const resources = templates.foundation.resources.filter(
        (resource) => resource.type === type,
      );
      assert.equal(resources.length, 1, `Expected one foundation ${type}`);
      return [key, resources[0]];
    }),
  );
  const identities = templates.foundation.resources.filter(
    (resource) =>
      resource.type === "Microsoft.ManagedIdentity/userAssignedIdentities",
  );
  assert.equal(identities.length, 2);
  foundation.webIdentity = identities.find((resource) =>
    resource.name.includes("-web"),
  );
  foundation.jobIdentity = identities.find((resource) =>
    resource.name.includes("-maintenance"),
  );
  assert.equal(foundation.vault.properties.publicNetworkAccess, "Disabled");
  assert.equal(foundation.vault.properties.enableRbacAuthorization, true);
  assert.equal(foundation.vault.properties.enablePurgeProtection, true);
  assert.equal(foundation.vault.properties.enableSoftDelete, true);
  assert.equal(foundation.vault.properties.softDeleteRetentionInDays, 90);
  assert.deepEqual(foundation.vault.properties.networkAcls, {
    bypass: "None",
    defaultAction: "Deny",
  });
  assert.equal(foundation.registry.properties.adminUserEnabled, false);
  assert.equal(foundation.registry.properties.anonymousPullEnabled, false);
  assert.equal(
    foundation.registry.properties.roleAssignmentMode,
    "LegacyRegistryPermissions",
  );
  assert.notEqual(foundation.webIdentity.name, foundation.jobIdentity.name);
  assert.equal(
    foundation.environment.properties.environmentMode,
    "WorkloadProfiles",
  );
  assert.equal(
    foundation.environment.properties.appLogsConfiguration.destination,
    "azure-monitor",
  );
  assert.equal(
    foundation.environment.properties.vnetConfiguration.internal,
    false,
  );
  assert.ok(
    foundation.environment.properties.vnetConfiguration.infrastructureSubnetId.includes(
      "/subnets/applications",
    ),
  );
  assert.equal(
    foundation.network.properties.subnets[0].properties.delegations[0]
      .properties.serviceName,
    "Microsoft.App/environments",
  );
  assert.ok(
    foundation.vaultEndpoint.properties.subnet.id.includes(
      "/subnets/private-endpoints",
    ),
  );
  assert.deepEqual(
    foundation.vaultEndpoint.properties.privateLinkServiceConnections[0]
      .properties.groupIds,
    ["vault"],
  );
  assert.ok(
    foundation.vaultEndpoint.properties.privateLinkServiceConnections[0].properties.privateLinkServiceId.includes(
      "vault",
    ),
  );
  assert.equal(foundation.vaultDns.name, "privatelink.vaultcore.azure.net");
  assert.equal(foundation.vaultDnsLink.properties.registrationEnabled, false);
  assert.ok(
    foundation.vaultDnsLink.properties.virtualNetwork.id.includes("network"),
  );
  assert.ok(
    foundation.vaultDnsGroup.properties.privateDnsZoneConfigs[0].properties.privateDnsZoneId.includes(
      "privatelink.vaultcore.azure.net",
    ),
  );
  assert.equal(foundation.workspace.properties.retentionInDays, 30);
  assert.equal(foundation.workspace.properties.features.disableLocalAuth, true);
  assert.equal(templates.foundation.parameters.logDailyQuotaGb.maxValue, 10);
  assert.ok(
    foundation.diagnostics.properties.workspaceId.includes("workspace"),
  );
  assert.deepEqual(foundation.diagnostics.properties.logs, [
    { categoryGroup: "allLogs", enabled: true },
  ]);
  assert.ok(!/listKeys\(/i.test(JSON.stringify(templates.foundation)));
  assert.ok(
    Object.values(foundation).every(
      (resource) => !resource.type.endsWith("/secrets"),
    ),
    "Foundation must not populate credential values",
  );
  const web = templates.workload.resources.app;
  const environment = web.properties.template.containers[0].env;
  const setting = (name, value) =>
    environment.includes(
      `createObject('name', '${name}', 'value', '${value}')`,
    );
  assert.equal(web.identity.type, "UserAssigned");
  assert.equal(web.properties.configuration.ingress.allowInsecure, false);
  assert.equal(web.properties.configuration.ingress.targetPort, 3000);
  assert.ok(
    web.properties.configuration.ingress.ipSecurityRestrictions.includes(
      "proxyRestrictions",
    ),
  );
  assert.ok(setting("SERVICES_ENABLED", "true"));
  assert.ok(setting("SECRETS_PROVIDER", "azure_key_vault"));
  assert.ok(setting("DATABASE_TLS_MODE", "verify_full"));
  assert.ok(setting("AZURE_CREDENTIAL_MODE", "managed_identity"));
  assert.ok(setting("CLAMAV_HOST", "127.0.0.1"));
  assert.ok(
    environment.includes(
      "createObject('name', 'CONTACT_ENABLED', 'value', if(equals(parameters('ingress').mode, 'trusted_proxy'), 'true', 'false'))",
    ),
  );
  assert.ok(
    !web.properties.configuration.secrets,
    "Web app must resolve secrets through its allowlisted vault loader",
  );
  const containers = web.properties.template.containers;
  assert.equal(containers.length, 2);
  assert.deepEqual(containers[0].command, [
    "node",
    "scripts/standalone-entry.mjs",
  ]);
  for (const container of containers)
    assert.ok(container.image.includes("@sha256:"));
  assert.equal(containers[1].resources.memory, "3Gi");
  const scannerPolicy = JSON.parse(
    await readFile("infra/scanner/policy.json", "utf8"),
  );
  assert.equal(scannerPolicy.clamd.HeuristicAlerts, "yes");
  assert.equal(scannerPolicy.clamd.AlertExceedsMax, "yes");
  assert.equal(scannerPolicy.clamd.ConcurrentDatabaseReload, "no");
  assert.equal(scannerPolicy.freshclam.TestDatabases, "yes");
  assert.equal(scannerPolicy.updateChecks, "12");
  const megabytes = (value) => {
    assert.match(value, /^[1-9][0-9]*M$/);
    return Number.parseInt(value, 10);
  };
  assert.ok(
    megabytes(scannerPolicy.clamd.MaxFileSize) >= 10 &&
      megabytes(scannerPolicy.clamd.MaxFileSize) <= 32,
  );
  assert.ok(
    megabytes(scannerPolicy.clamd.MaxScanSize) >=
      megabytes(scannerPolicy.clamd.MaxFileSize) &&
      megabytes(scannerPolicy.clamd.MaxScanSize) <= 128,
  );
  assert.ok(
    megabytes(scannerPolicy.clamd.StreamMaxLength) >
      megabytes(scannerPolicy.clamd.MaxFileSize) &&
      megabytes(scannerPolicy.clamd.StreamMaxLength) <= 64,
  );
  assert.equal(scannerPolicy.clamd.MaxThreads, "2");
  assert.equal(scannerPolicy.clamd.MaxQueue, "8");
  assert.equal(scannerPolicy.clamd.MaxRecursion, "8");
  assert.equal(scannerPolicy.clamd.MaxFiles, "256");
  assert.equal(scannerPolicy.clamd.SelfCheck, "60");
  const policyReference = templates.workload.variables.scannerPolicy.match(
    /^\[variables\('([^']+)'\)\]$/,
  );
  assert.ok(
    policyReference,
    "The compiled workload must retain its imported scanner policy",
  );
  assert.deepEqual(
    templates.workload.variables[policyReference[1]],
    scannerPolicy,
  );
  assert.equal(
    templates.workload.variables.scannerEnvironment,
    "[concat(variables('scannerClamdEnvironment'), variables('scannerFreshclamEnvironment'), createArray(createObject('name', 'FRESHCLAM_CHECKS', 'value', variables('scannerPolicy').updateChecks)))]",
  );
  for (const [name, section, prefix] of [
    ["scannerClamdEnvironment", "clamd", "CLAMD_CONF_"],
    ["scannerFreshclamEnvironment", "freshclam", "FRESHCLAM_CONF_"],
  ]) {
    const loop = templates.workload.variables.copy.find(
      (item) => item.name === name,
    );
    assert.equal(
      loop.count,
      `[length(items(variables('scannerPolicy').${section}))]`,
    );
    assert.equal(
      loop.input.name,
      `[format('${prefix}{0}', items(variables('scannerPolicy').${section})[copyIndex('${name}')].key)]`,
    );
    assert.equal(
      loop.input.value,
      `[items(variables('scannerPolicy').${section})[copyIndex('${name}')].value]`,
    );
  }
  assert.equal(
    containers[1].env,
    "[concat(variables('scannerEnvironment'), createArray(createObject('name', 'CLAMD_CONF_TCPAddr', 'value', '127.0.0.1')))]",
  );

  assert.equal(web.properties.template.scale.minReplicas, 1);
  assert.equal(templates.workload.parameters.maximumReplicas.maxValue, 3);
  for (const type of ["Startup", "Readiness", "Liveness"])
    assert.ok(containers[0].probes.some((probe) => probe.type === type));
  assert.deepEqual(templates.workload.parameters.authentication.defaultValue, {
    provider: "supabase",
  });
  assert.deepEqual(templates.workload.parameters.telemetry.defaultValue, {
    provider: "console",
  });
  assert.ok(
    environment.includes(
      "createObject('name', 'AUTH_PROVIDER', 'value', parameters('authentication').provider)",
    ),
  );
  assert.ok(
    environment.includes(
      "createObject('name', 'OBSERVABILITY_PROVIDER', 'value', parameters('telemetry').provider)",
    ),
  );
  assert.ok(
    environment.includes("string(variables('selectedSecretReferences'))"),
  );
  assert.ok(environment.includes("variables('authenticationEnvironment')"));
  assert.ok(environment.includes("variables('telemetryEnvironment')"));
  const authEnvironment =
    templates.workload.variables.authenticationEnvironment;
  for (const [name, field] of Object.entries({
    ENTRA_TENANT_ID: "tenantId",
    ENTRA_CLIENT_ID: "clientId",
    ENTRA_TENANT_SUBDOMAIN: "tenantSubdomain",
    ENTRA_DIRECTORY_CLIENT_ID: "directoryClientId",
    ENTRA_MFA_ISSUER: "mfaIssuer",
    ENTRA_MFA_ACTIVE_KEY_ID: "mfaActiveKeyId",
    ENTRA_RECOVERY_MODE: "recoveryMode",
  }))
    assert.ok(
      authEnvironment.includes(
        `createObject('name', '${name}', 'value', parameters('authentication').${field})`,
      ),
    );
  const references = templates.workload.variables.selectedSecretReferences;
  for (const [name, field] of Object.entries({
    ENTRA_CLIENT_SECRET: "loginSecretReference",
    ENTRA_DIRECTORY_CLIENT_SECRET: "directorySecretReference",
    ENTRA_MFA_ENCRYPTION_KEYS: "mfaKeysSecretReference",
  }))
    assert.ok(
      references.includes(`'${name}', parameters('authentication').${field}`),
    );
  assert.ok(
    references.includes(
      "'AZURE_MONITOR_CONNECTION_STRING', parameters('telemetry').connectionSecretReference",
    ),
  );
  assert.ok(
    templates.workload.variables.telemetryEnvironment.includes(
      "createObject('name', 'APPLICATION_INSIGHTS_NO_STATSBEAT', 'value', 'true')",
    ),
  );
  assert.equal(
    templates.workload.definitions.Connections.additionalProperties,
    false,
  );
  for (const key of [
    "AZURE_CREDENTIAL_MODE",
    "AUTH_PROVIDER",
    "OBSERVABILITY_PROVIDER",
    "ENTRA_CLIENT_SECRET",
    "AZURE_MONITOR_CONNECTION_STRING",
  ])
    assert.ok(
      !Object.hasOwn(
        templates.workload.definitions.Connections.properties,
        key,
      ),
    );
  const job = templates.maintenance.resources.job;
  assert.equal(job.properties.configuration.replicaRetryLimit, 0);
  assert.equal(job.properties.configuration.replicaTimeout, 180);
  assert.equal(
    job.properties.configuration.scheduleTriggerConfig.parallelism,
    1,
  );
  assert.deepEqual(job.properties.template.containers[0].command, [
    "node",
    "scripts/run-maintenance.mjs",
  ]);
  assert.ok(
    job.properties.template.containers[0].env.find(
      (entry) => entry.name === "CRON_SECRET",
    ).secretRef,
  );
  assert.ok(
    job.properties.configuration.secrets[0].keyVaultUrl.includes(
      "maintenanceReference",
    ),
  );
  assert.ok(!Object.hasOwn(job.properties.configuration.secrets[0], "value"));
  const roles = templates.access.resources;
  assert.ok(
    roles.jobSecret.scope.includes("'Microsoft.KeyVault/vaults/secrets'") &&
      roles.jobSecret.scope.includes("maintenanceSecretName"),
    "Job identity must not read the whole vault",
  );
  for (const name of ["objectRole", "policyRole"]) {
    for (const permission of roles[name].properties.permissions) {
      assert.ok(
        permission.actions.every(
          (action) => !/\/write$|\/delete$|listkeys|\*/i.test(action),
        ),
        "No runtime resource modification or account keys",
      );
    }
  }
  assert.ok(roles.reportAccess.properties.principalId.includes("webIdentity"));
  assert.ok(roles.imageAccess.properties.principalId.includes("webIdentity"));
  assert.equal(roles.insights.existing, true);
  assert.equal(roles.insights.type, "Microsoft.Insights/components");
  assert.equal(
    roles.telemetryAccess.condition,
    "[equals(parameters('telemetry').provider, 'azure_monitor')]",
  );
  assert.ok(
    roles.telemetryAccess.scope.includes("'Microsoft.Insights/components'"),
  );
  assert.ok(
    roles.telemetryAccess.scope.includes(
      "parameters('telemetry').applicationInsightsName",
    ),
  );
  assert.ok(
    roles.telemetryAccess.properties.principalId.includes("webIdentity"),
  );
  assert.equal(
    roles.telemetryAccess.properties.principalType,
    "ServicePrincipal",
  );
  assert.ok(
    templates.access.variables.telemetryPublisher.includes(
      "3913510d-42f4-4e42-8a64-420c390055eb",
    ),
  );
  assert.equal(
    roles.telemetryAccess.properties.roleDefinitionId,
    "[variables('telemetryPublisher')]",
  );
  assert.deepEqual(templates.access.parameters.telemetry.defaultValue, {
    provider: "console",
  });
  console.log(
    "Eight Azure templates and parameter examples compile; Entra/telemetry selectors, pinned-reference wiring, scoped ingestion publisher, monitoring/HTTPS availability/scheduled-evidence scopes/thresholds/query-identity/notification defaults, private storage/retention, foundation networking/vault/logging, bootstrap, private scanner, ingress, identity, secret, scaling and scheduler policies pass offline checks.",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
