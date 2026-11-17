import "server-only";
import type { SecretProvider } from "../contracts";
import { secretKeys } from "../secret-settings";
export class EnvironmentSecrets implements SecretProvider {
  private readonly values: Readonly<Record<string, string>>;
  constructor(env: Readonly<Record<string, string | undefined>>) {
    this.values = Object.freeze(
      Object.fromEntries(
        secretKeys
          .filter((key) => Boolean(env[key]))
          .map((key) => [key, env[key]!]),
      ),
    );
  }
  async resolve() {
    return this.values;
  }
}
