import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      "server-only": path.resolve(root, "tests/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/load/native-load.test.ts"],
    testTimeout: 90000,
    hookTimeout: 30000,
    maxWorkers: 1,
  },
});
