import { cp, mkdtemp, rm, readdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
async function verifyLinks(directory, root) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const resolved = await realpath(file);
      if (resolved !== root && !resolved.startsWith(root + path.sep))
        throw new Error("Package symlink escapes standalone output");
    } else if (entry.isDirectory()) await verifyLinks(file, root);
  }
}
export async function withStandaloneCopy(work) {
  const temporary = await mkdtemp(path.join(tmpdir(), "nova-package-check-"));
  try {
    const destination = path.join(temporary, "app");
    await cp(".next/standalone", destination, {
      recursive: true,
      verbatimSymlinks: true,
    });
    const root = await realpath(destination);
    await verifyLinks(root, root);
    return await work(root);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
