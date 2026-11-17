import { readFile, symlink, realpath } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
// The binary package's npm tarball represents symlinks as a manifest.
// Restore only links wholly inside the explicit temporary tool package.
assert.ok(process.env.POSTGRES_BIN_DIR, "Set POSTGRES_BIN_DIR");
const root = path.resolve(process.env.POSTGRES_BIN_DIR, "../..");
const metadata = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
assert.match(metadata.name, /^@embedded-postgres\//);
assert.equal(metadata.version, "17.11.0-beta.19");
const links = JSON.parse(
  await readFile(path.join(root, "native/pg-symlinks.json"), "utf8"),
);
for (const link of links) {
  const source = path.resolve(root, link.source);
  const target = path.resolve(root, link.target);
  assert.ok(
    source.startsWith(root + path.sep) && target.startsWith(root + path.sep),
    "Tool symlink escapes package",
  );
  try {
    await symlink(path.relative(path.dirname(target), source), target);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    assert.equal(await realpath(target), await realpath(source));
  }
}
console.log(
  "Reviewed PostgreSQL test-tool links are contained in their package.",
);
