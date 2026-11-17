import "server-only";
import { RuntimeConfigurationLoader } from "./runtime-configuration";
export {
  ConfigurationService,
  type ServerConfig,
} from "./configuration-service";
// Only immutable process configuration is cached, never request/session identity.
const runtime = new RuntimeConfigurationLoader(process.env);
export function loadConfig() {
  return runtime.load();
}
