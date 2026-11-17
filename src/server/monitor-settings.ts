import "server-only";
import { ConfigurationError } from "./errors";
/** Public Azure regional ingestion only; never accept arbitrary exporter endpoints. */
export function parseMonitorConnection(value: string) {
  try {
    if (value.length > 512) throw Error();
    const entries = value.split(";").map((entry) => entry.split("="));
    if (
      entries.length !== 2 ||
      entries.some((entry) => entry.length !== 2) ||
      entries[0][0] !== "InstrumentationKey" ||
      entries[1][0] !== "IngestionEndpoint" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        entries[0][1],
      )
    )
      throw Error();
    const endpoint = entries[1][1];
    const url = new URL(endpoint);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      !/^[a-z][a-z0-9-]{1,79}\.in\.applicationinsights\.azure\.com$/.test(
        url.hostname,
      ) ||
      (endpoint !== url.origin && endpoint !== `${url.origin}/`)
    )
      throw Error();
    return Object.freeze({
      connectionString: `InstrumentationKey=${entries[0][1].toLowerCase()};IngestionEndpoint=${url.origin}`,
      origin: url.origin,
    });
  } catch {
    throw new ConfigurationError(["AZURE_MONITOR_CONNECTION_STRING"]);
  }
}
