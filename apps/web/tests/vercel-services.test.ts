import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RESERVED_WORKSPACE_SLUGS } from "@luke/features/workspace-wire";
import { Schema } from "effect";
import { test } from "vitest";
import { config, EVE_WORKSPACE, SERVICE } from "../../../vercel";
import { webFunctions } from "../server/function-layout";
import { apiRewrites, rewritesDrifted } from "../server/function-rewrites";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const REPOSITORY = join(WEB, "..", "..");

/** A route that lands a path on a page or a function of the service it runs in. */
const PathRoute = Schema.Struct({ src: Schema.String, dest: Schema.String });
/** A route that rewrites the path a request entered its service with. */
const TransformRoute = Schema.Struct({
  src: Schema.String,
  transforms: Schema.Array(
    Schema.Struct({ type: Schema.String, op: Schema.String, args: Schema.String }),
  ),
});

/**
 * The configuration Vercel is handed, read as the deployment's shape: what
 * `vercel.ts` exports is `withEve`'s plain object, typed loosely by eve, so
 * the test reads it through a Schema rather than trusting its type.
 */
const DeployedConfig = Schema.Struct({
  services: Schema.Record(
    Schema.String,
    Schema.Struct({
      root: Schema.String,
      buildCommand: Schema.String,
      routes: Schema.optional(Schema.Array(Schema.Union([PathRoute, TransformRoute]))),
    }),
  ),
  routes: Schema.Array(
    Schema.Struct({ src: Schema.String, destination: Schema.Struct({ service: Schema.String }) }),
  ),
});

const deployed = Schema.decodeUnknownSync(DeployedConfig)(config);

const webRoutes = (deployed.services[SERVICE.WEB]?.routes ?? []).flatMap((route) =>
  "dest" in route ? [route] : [],
);

/** The service a public path enters, by the first top-level route that matches it whole, as Vercel picks one. */
function serviceFor(path: string): string | undefined {
  return deployed.routes.find((route) => new RegExp(route.src, "u").test(path))?.destination
    .service;
}

/** The path a service's own routes hand its runtime: the first route that matches rewrites it, as Vercel applies a `request.path` transform. */
function pathInService(service: string, path: string): string {
  for (const route of deployed.services[service]?.routes ?? []) {
    if ("dest" in route) continue;
    const pattern = new RegExp(route.src, "u");
    if (!pattern.test(path)) continue;
    const set = route.transforms.find((one) => one.type === "request.path" && one.op === "set");
    return set === undefined ? path : path.replace(pattern, set.args);
  }
  return path;
}

/** The directory a service's build command enters first, from the service's root. */
const ENTERED = /^cd '([^']+)'/u;

test("the /api/ rewrites are generated into the web service's routes, ahead of its other routes, and the committed table carries exactly that generation", async () => {
  const generated = apiRewrites(await webFunctions(WEB));
  assert.deepEqual(webRoutes.slice(0, generated.length), generated);
  assert.deepEqual(
    webRoutes.slice(generated.length).filter((route) => route.src.startsWith("/api/")),
    [],
  );
  assert.equal(await rewritesDrifted(WEB), false);
});

test("a public path enters its service: each agent at its workspace member's mount and at its mount from before the workspace, and everything else the website", () => {
  assert.equal(serviceFor("/eve/luke/v1/session"), SERVICE.LUKE);
  assert.equal(serviceFor("/eve/luke/v1/health"), SERVICE.LUKE);
  assert.equal(serviceFor("/eve/v1/session/s_1/stream"), SERVICE.LUKE);
  assert.equal(serviceFor("/eve/dev/v1/session"), SERVICE.DEV);
  assert.equal(serviceFor("/eve/coder/v1/session/s_1/cancel"), SERVICE.DEV);
  assert.equal(serviceFor("/api/plans"), SERVICE.WEB);
  assert.equal(serviceFor("/acme/plan/p_1"), SERVICE.WEB);
});

test("an agent reads every path it is reached by as eve's own /eve/v1/*, which is what its door is written against", () => {
  assert.equal(pathInService(SERVICE.LUKE, "/eve/luke/v1/session"), "/eve/v1/session");
  assert.equal(
    pathInService(SERVICE.LUKE, "/eve/v1/session/s_1/stream"),
    "/eve/v1/session/s_1/stream",
  );
  assert.equal(pathInService(SERVICE.DEV, "/eve/dev/v1/session/s_1"), "/eve/v1/session/s_1");
  assert.equal(
    pathInService(SERVICE.DEV, "/eve/coder/v1/callback/hook_1"),
    "/eve/v1/callback/hook_1",
  );
});

test("every service is rooted at a directory from the repository root, and each agent's build enters its own member of the eve workspace", () => {
  for (const [name, service] of Object.entries(deployed.services)) {
    assert.ok(statSync(join(REPOSITORY, service.root)).isDirectory(), `${name}: ${service.root}`);
  }
  for (const [member, name] of [
    ["luke", SERVICE.LUKE],
    ["dev", SERVICE.DEV],
  ] as const) {
    const service = deployed.services[name];
    assert.ok(service, name);
    const entered = ENTERED.exec(service.buildCommand)?.[1];
    assert.ok(entered, service.buildCommand);
    assert.equal(
      join(REPOSITORY, service.root, entered),
      join(REPOSITORY, EVE_WORKSPACE, "agents", member),
    );
  }
});

/** The first step of a path, where it is spelled as itself rather than matched. */
const FIRST_STEP = /^\^?\/([a-z0-9-]+)(?:\/|$)/u;

test("no workspace's slug can be the first step of a page the web app serves under its own name", () => {
  const routed = [
    ...webRoutes.map((route) => route.src),
    ...deployed.routes.map((route) => route.src),
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
