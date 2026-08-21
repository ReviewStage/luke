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

test("Vercel migrates and seeds a deployment's database before it builds", () => {
  assert.equal(
    vercelConfig.buildCommand,
    "pnpm db:migrate && pnpm auth:seed && pnpm admin:seed && pnpm build",
  );
  assert.doesNotMatch(vercelConfig.buildCommand, /drizzle-kit push/);
});

test("Vercel routes nested auth paths before its detected API 404", () => {
  assert.deepEqual(vercelConfig.routes, [
    { src: "/api/auth/(.*)", dest: "/api/auth/[...all].ts" },
    { src: "/privacy", dest: "/privacy.html" },
    { src: "/changelog", dest: "/changelog.html" },
    { src: "/admin", dest: "/admin.html" },
  ]);
  assert.equal("rewrites" in vercelConfig, false);
});
