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
  assert.equal(vercelConfig.buildCommand, "pnpm db:migrate && pnpm auth:seed && pnpm build");
  assert.doesNotMatch(vercelConfig.buildCommand, /drizzle-kit push/);
});

test("Vercel routes nested auth paths before its detected API 404", () => {
  assert.deepEqual(vercelConfig.routes, [
    { src: "/api/auth/(.*)", dest: "/api/auth/[...all].ts" },
    { src: "/privacy", dest: "/privacy.html" },
    { src: "/changelog", dest: "/changelog.html" },
    { src: "/admin", dest: "/admin.html" },
    { src: "/ingest/static/(.*)", dest: "https://us-assets.i.posthog.com/static/$1" },
    { src: "/ingest/(.*)", dest: "https://us.i.posthog.com/$1" },
  ]);
  // Still `routes` rather than `rewrites`, and the two cannot be mixed. The
  // auth entry is why: `routes` run before the filesystem and the detected
  // API's own 404, where a rewrite runs after it — which is what this test's
  // name has been guarding since before the proxy existed.
  assert.equal("rewrites" in vercelConfig, false);
});

/**
 * The analytics proxy, on the same terms as the routes above it. It exists so
 * neither half of the counting reaches the processor from a user's own
 * machine: the site's script and the desktop's recorder both post to Luke's
 * own origin, and the visitor's address is this deployment's to forward or
 * not rather than something the processor is handed by the browser.
 */
test("the analytics proxy sends assets and ingestion to their own hosts", () => {
  const proxied = vercelConfig.routes.filter((route) => route.dest.startsWith("https://"));
  assert.deepEqual(
    proxied.map((route) => route.src),
    ["/ingest/static/(.*)", "/ingest/(.*)"],
    "the asset path must be matched before the ingestion catch-all swallows it",
  );
  for (const route of proxied) {
    assert.match(route.dest, /^https:\/\/[a-z0-9.-]+\.i\.posthog\.com\//);
  }
});
