import assert from "node:assert/strict";
import test from "node:test";
import packageManifest from "../package.json";
import vercelConfig from "../vercel.json";

test("migrations stay out of package lifecycle and application scripts", () => {
  const scripts: Record<string, string> = packageManifest.scripts;

  assert.equal(scripts.postinstall, undefined);
  assert.equal(scripts.prepare, undefined);

  for (const scriptName of ["build", "dev", "preview", "typecheck", "test"]) {
    assert.doesNotMatch(scripts[scriptName] ?? "", /drizzle-kit|migrate/);
  }

  assert.equal(scripts["db:migrate"], "tsx server/db/migrate.ts");
  assert.deepEqual(
    Object.entries(scripts)
      .filter(([, command]) => /\bmigrate\b/.test(command))
      .map(([name]) => name),
    ["db:migrate"],
  );
});

test("Vercel applies committed migrations before it builds a deployment", () => {
  assert.equal(vercelConfig.buildCommand, "pnpm db:migrate && pnpm build");
  assert.doesNotMatch(vercelConfig.buildCommand, /drizzle-kit push/);
});
