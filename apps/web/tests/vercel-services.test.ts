import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RESERVED_WORKSPACE_SLUGS } from "@luke/features/workspace-wire";
import { test } from "vitest";
import { config, SERVICE } from "../../../vercel";
import { webFunctions } from "../server/function-layout";
import { apiRewrites, rewritesDrifted } from "../server/function-rewrites";

const WEB = fileURLToPath(new URL("..", import.meta.url));

const webRoutes = (config.services[SERVICE.WEB].routes ?? []).flatMap((route) =>
  "dest" in route ? [route] : [],
);

test("the /api/ rewrites are generated into the web service's routes, ahead of its other routes, and the committed table carries exactly that generation", async () => {
  const generated = apiRewrites(await webFunctions(WEB));
  assert.deepEqual(webRoutes.slice(0, generated.length), generated);
  assert.deepEqual(
    webRoutes.slice(generated.length).filter((route) => route.src.startsWith("/api/")),
    [],
  );
  assert.equal(await rewritesDrifted(WEB), false);
  // Vercel ignores a top-level `routes` key in services mode, so a route left there would 404 in production.
  assert.equal("routes" in config, false);
});

/** The first step of a path, where it is spelled as itself rather than matched. */
const FIRST_STEP = /^\^?\/([a-z0-9-]+)(?:\/|$)/u;

test("no workspace's slug can be the first step of a page the web app serves under its own name", () => {
  const routed = [
    ...webRoutes.map((route) => route.src),
    ...config.rewrites.map((rewrite) => rewrite.source),
  ];
  const pages = readdirSync(WEB)
    .filter((name) => name.endsWith(".html"))
    .map((name) => `/${name.slice(0, -".html".length)}`);
  const published = readdirSync(`${WEB}/public`, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `/${entry.name}`);
  const steps = new Set(
    [...routed, ...pages, ...published].flatMap((path) => FIRST_STEP.exec(path)?.[1] ?? []),
  );
  steps.delete("index");

  assert.deepEqual(
    [...steps].filter((step) => !RESERVED_WORKSPACE_SLUGS.has(step)),
    [],
  );
});

test("a plan's link, a section's among them, is served the Open in Luke page, and no page of Luke's own is", () => {
  const opens = webRoutes.flatMap((route) =>
    route.dest === "/open.html" ? [new RegExp(`^${route.src}$`, "u")] : [],
  );
  const served = (path: string) => opens.some((route) => route.test(path));

  assert.equal(opens.length, 1);
  assert.equal(served("/acme/plan/3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b"), true);
  assert.equal(served("/personal-u_1/plan/3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b/"), true);
  for (const path of ["/about", "/changelog/page/2", "/api/plans/x/board", "/acme/plans/x", "/"]) {
    assert.equal(served(path), false, path);
  }
});
