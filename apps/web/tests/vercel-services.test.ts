import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, matchesGlob } from "node:path";
import { fileURLToPath } from "node:url";
import { RESERVED_WORKSPACE_SLUGS } from "@luke/features/workspace-wire";
import { temporaryDirectory } from "@luke/runtime/testing";
import { test } from "vitest";
import { webFunctions } from "../server/function-layout";
import { apiRewrites, rewritesDrifted, vercelConfigSource } from "../server/function-rewrites";

interface Route {
  readonly src: string;
  readonly dest: string;
}

interface Transform {
  readonly type: string;
  readonly op: string;
  readonly args: string;
}

interface ServiceRoute {
  readonly src: string;
  readonly transforms?: readonly Transform[];
}

interface Service {
  readonly root: string;
  readonly buildCommand?: string;
  readonly routes?: readonly (Route | ServiceRoute)[];
}

interface Rewrite {
  readonly source: string;
  readonly destination: { readonly service: string };
}

const SERVICE = { WEB: "web", LUKE: "luke", DEV: "dev" } as const;

interface Services {
  readonly [SERVICE.WEB]: Service;
  readonly [SERVICE.LUKE]: Service;
  readonly [SERVICE.DEV]: Service;
}

interface Git {
  readonly deploymentEnabled: Readonly<Record<string, boolean>>;
}

const VERCEL_JSON = readFileSync(
  fileURLToPath(new URL("../../../vercel.json", import.meta.url)),
  "utf8",
);

// SAFETY: the file is this repository's own vercel.json, read for its deployment shape.
const vercel = JSON.parse(VERCEL_JSON) as {
  git: Git;
  services: Services;
  rewrites: readonly Rewrite[];
};

const WEB = fileURLToPath(new URL("..", import.meta.url));

test("the /api/ rewrites are generated into the web service's routes, ahead of its other routes, and the committed file carries exactly that generation", async () => {
  const generated = apiRewrites(await webFunctions(WEB));
  const web = vercel.services[SERVICE.WEB];
  assert.ok(web.routes);
  assert.deepEqual(web.routes.slice(0, generated.length), generated);
  assert.deepEqual(
    web.routes.slice(generated.length).filter((route) => route.src.startsWith("/api/")),
    [],
  );
  assert.equal(await rewritesDrifted(WEB), false);
  // SAFETY: the generator's own output, read back as the JSON it wrote.
  const regenerated = JSON.parse(await vercelConfigSource(WEB)) as typeof vercel;
  assert.equal("routes" in regenerated, false);
  assert.deepEqual(regenerated.services[SERVICE.WEB].routes, web.routes);
  // The generator carries every service whole, the coder's mount route included.
  assert.deepEqual(regenerated.services, vercel.services);
});

/** Whether Vercel deploys a push to the branch, by the `git.deploymentEnabled` globs, where a branch no glob names deploys. */
function deploys(branch: string): boolean {
  const refused = Object.entries(vercel.git.deploymentEnabled).some(
    ([glob, enabled]) => !enabled && matchesGlob(branch, glob),
  );
  return !refused;
}

test("a GitHub merge-queue branch is not deployed, and every other branch is", () => {
  for (const branch of [
    "gh-readonly-queue/main/pr-3551-d1c107a6f00dbb4b1e5bd2d1b8f3a5c7e9d01234",
    "gh-readonly-queue/release/1.2/pr-7-0123456789abcdef0123456789abcdef01234567",
  ]) {
    assert.equal(deploys(branch), false, branch);
  }
  for (const branch of [
    "main",
    "ci/vercel-no-merge-queue-deploys",
    "conductor/some-workspace",
    "pr-assets",
    "gh-readonly-queue",
  ]) {
    assert.equal(deploys(branch), true, branch);
  }
});

test("regenerating vercel.json gives back the committed file byte for byte", async () => {
  assert.equal(await vercelConfigSource(WEB), VERCEL_JSON);
});

test("a vercel.json key the generator does not know refuses the generation rather than being dropped", async (t) => {
  const root = await temporaryDirectory(t, "luke-vercel-config-");
  const web = join(root, "apps", "web");
  mkdirSync(web, { recursive: true });
  writeFileSync(join(root, "vercel.json"), JSON.stringify({ ...vercel, images: { sizes: [256] } }));
  await assert.rejects(vercelConfigSource(web), /images/u);
});

/**
 * The name eve knows each agent service by, which it derives from the
 * service's package name without its scope and names the service's Workflow
 * queue after. A standing session wakes only on its owning deployment's
 * queue, so these never change once a session has started under them.
 */
const EVE_AGENT_NAME = { [SERVICE.LUKE]: "luke", [SERVICE.DEV]: "coder" } as const;

test("each eve service keeps the agent name its standing sessions' queue is named after, whatever its directory or service key", () => {
  for (const service of [SERVICE.LUKE, SERVICE.DEV] as const) {
    const manifest = new URL(
      `../../../${vercel.services[service].root}/package.json`,
      import.meta.url,
    );
    // SAFETY: the service's own package.json, read for its name.
    const { name } = JSON.parse(readFileSync(fileURLToPath(manifest), "utf8")) as { name: string };
    assert.equal(name.slice(name.lastIndexOf("/") + 1), EVE_AGENT_NAME[service], service);
  }
});

/** The first step of a path, where it is spelled as itself rather than matched. */
const FIRST_STEP = /^\^?\/([a-z0-9-]+)(?:\/|$)/u;

test("no workspace's slug can be the first step of a page the web app serves under its own name", () => {
  const routed = [
    ...(vercel.services[SERVICE.WEB].routes ?? []).map((route) => route.src),
    ...vercel.rewrites.map((rewrite) => rewrite.source),
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

/** A route of the web service as the platform reads it: the file it serves and the headers sent beside it, or a redirect's status and `Location`. */
interface WebRoute {
  readonly src: string;
  readonly dest?: string;
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
}

/** What the web service answers a path with: a file of the build, by the route that served it, or a redirect. */
type Served =
  | { readonly file: string; readonly route: WebRoute }
  | { readonly status: number; readonly location: string };

/**
 * What the web service answers a path with: by the first of its routes whose
 * pattern matches the whole path, as Vercel reads them, the pattern's groups
 * written into the destination; nothing where no route does, which leaves
 * the path to the build's own files.
 */
function servedBy(path: string): Served | undefined {
  // SAFETY: the web service's routes as this repository's vercel.json writes them, which the generator's schema holds to these two shapes.
  for (const route of (vercel.services[SERVICE.WEB].routes ?? []) as readonly WebRoute[]) {
    const pattern = new RegExp(`^${route.src}$`, "u");
    if (!pattern.test(path)) continue;
    if (route.dest !== undefined) return { file: path.replace(pattern, route.dest), route };
    return { status: route.status ?? 0, location: route.headers?.Location ?? "" };
  }
  return undefined;
}

const servedFile = (path: string) => {
  const served = servedBy(path);
  return served !== undefined && "file" in served ? served.file : undefined;
};

test("a link to any place in Luke, a plan's, a section's and a picture's among them, and the app's own path are served the web app, and no page of Luke's own is", () => {
  for (const path of [
    "/app",
    "/app/",
    "/acme/plan/3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b",
    "/personal-u_1/plan/3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b/",
    "/acme/plan/3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b/files/0b6f6b52-2c1e-4f8e-9a4d-7f1c2e9d5a01",
    "/acme/plan/p1/agent/a1/worker/toolu_1",
    "/acme/task/p1/version/3",
    "/acme/agent/a1",
    "/acme/inbox",
    "/acme/plan/p1/inbox/i1/",
    "/acme/automations",
    "/acme/automation/x1/run/r1",
    "/acme/factory",
    "/acme/settings/coding-agents",
    "/acme/person/user_9Fq2-x",
    "/acme/issue/i1",
  ]) {
    assert.equal(servedFile(path), "/app.html", path);
  }
  // The build's file name is never an address: it sends the browser to the app's own, for good, and the browser keeps the fragment.
  assert.deepEqual(servedBy("/app.html"), { status: 308, location: "/app" });
  assert.equal(servedFile("/about"), "/about.html");
  assert.equal(servedFile("/privacy"), "/privacy.html");
  assert.equal(servedFile("/changelog"), "/changelog.html");
  assert.equal(servedFile("/changelog/page/2"), "/changelog/page/2.html");
  assert.equal(servedFile("/admin"), "/admin.html");
  // An API path still reaches its function's route with the id it names, however its rewrite spells the rest.
  for (const [path, route] of [
    ["/api/plans/x/board", "plans/board"],
    ["/api/inbox/i1", "inbox/item"],
    ["/api/automations/x1/runs", "automations/runs"],
    ["/api/agents/a1", "agents/agent"],
  ] as const) {
    const served = new URL(servedFile(path) ?? "/", "https://tryluke.dev");
    assert.match(served.pathname, /^\/api\//u, path);
    assert.equal(served.searchParams.get("route"), route, path);
    assert.equal(served.searchParams.get("id"), path.split("/")[3], path);
  }
  // The landing page, the sign-in, a static file, and a path naming no place are the build's own files.
  for (const path of [
    "/",
    "/sign-in.html",
    "/favicon.svg",
    "/app/fonts/x.woff2",
    "/acme/plans/x",
    "/acme",
    "/application",
  ]) {
    assert.equal(servedFile(path), undefined, path);
  }
});

test("every path the web app is served at sends its Content Security Policy, refuses to be framed, and is never sniffed; no other page is held to them", () => {
  const routes = vercel.services[SERVICE.WEB].routes ?? [];
  const app = routes.filter(
    (route): route is WebRoute => "dest" in route && route.dest === "/app.html",
  );
  assert.ok(app.length > 0);
  for (const route of app) {
    const policy = route.headers?.["Content-Security-Policy"] ?? "";
    const directives = new Map(
      policy.split(";").map((directive) => {
        const [name = "", ...sources] = directive.trim().split(/\s+/u);
        return [name, sources];
      }),
    );
    assert.deepEqual(directives.get("default-src"), ["'self'"], route.src);
    assert.deepEqual(directives.get("script-src"), ["'self'"], route.src);
    assert.deepEqual(directives.get("object-src"), ["'none'"], route.src);
    assert.deepEqual(directives.get("base-uri"), ["'self'"], route.src);
    assert.deepEqual(directives.get("form-action"), ["'self'"], route.src);
    assert.deepEqual(directives.get("frame-ancestors"), ["'none'"], route.src);
    assert.equal(route.headers?.["X-Content-Type-Options"], "nosniff", route.src);
    assert.equal(route.headers?.["Referrer-Policy"], "strict-origin-when-cross-origin", route.src);
  }
  for (const path of ["/about", "/changelog/page/2", "/admin", "/api/plans/x/board"]) {
    const served = servedBy(path);
    assert.ok(served !== undefined && "route" in served, path);
    assert.equal(served.route.headers, undefined, path);
  }
});
