// Local scheduler: `node --env-file=.env.local scripts/run-maintenance.mjs --watch`.
// Hosted scheduler: invoke once without --watch using securely injected environment.
const environment = process.env.APP_ENV ?? "development";
const provider = process.env.SCHEDULER_PROVIDER ?? "local";
const secret = process.env.CRON_SECRET;
const watch = process.argv.slice(2).includes("--watch");
if (process.argv.slice(2).some((arg) => arg !== "--watch"))
  throw new Error(
    "Only --watch is supported. Supply secrets through the environment.",
  );
if (!secret || secret.length < 32 || secret.length > 256)
  throw new Error("CRON_SECRET must contain 32 to 256 characters.");
if (
  !["development", "test", "staging", "production"].includes(environment) ||
  !["local", "external"].includes(provider)
)
  throw new Error("Invalid scheduler profile.");
const local = environment === "development" || environment === "test";
if ((watch || provider === "local") && !local)
  throw new Error(
    "Use an external single-run scheduler in staging/production.",
  );
let base;
try {
  base = new URL(process.env.APP_URL ?? "http://127.0.0.1:3000");
} catch {
  throw new Error("APP_URL must be a valid application origin.");
}
if (
  base.username ||
  base.password ||
  base.search ||
  base.hash ||
  base.pathname !== "/"
)
  throw new Error("APP_URL must be a bare application origin.");
if (
  base.protocol !== "https:" &&
  !(
    local &&
    base.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)
  )
)
  throw new Error(
    "Maintenance requires HTTPS or an explicit development loopback origin.",
  );
let stopped = false;
let wake;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    stopped = true;
    wake?.();
  });
async function run() {
  // Drain at most ten batches per invocation; another run safely resumes large queues.
  let expiredOffers = 0;
  let mayHaveMore = false;
  for (let attempt = 0; attempt < 10 && !stopped; attempt++) {
    const response = await fetch(new URL("/api/maintenance", base), {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(`Maintenance returned HTTP ${response.status}.`);
    const result = await response.json();
    if (
      !Number.isInteger(result.expiredOffers) ||
      result.expiredOffers < 0 ||
      result.expiredOffers > 500 ||
      typeof result.mayHaveMore !== "boolean"
    )
      throw new Error("Invalid maintenance response.");
    expiredOffers += result.expiredOffers;
    mayHaveMore = result.mayHaveMore;
    if (!mayHaveMore) break;
  }
  console.log(
    JSON.stringify({ event: "offer_expiry", expiredOffers, mayHaveMore }),
  );
}
do {
  try {
    await run();
  } catch {
    console.error(
      "Offer maintenance failed. Check application availability and scheduler configuration.",
    );
    if (!watch) process.exitCode = 1;
  }
  if (watch && !stopped)
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        wake = undefined;
        resolve();
      }, 60000);
      wake = () => {
        clearTimeout(timer);
        wake = undefined;
        resolve();
      };
    });
} while (watch && !stopped);
