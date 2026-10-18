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

test("a link to any place in Luke, a plan's, a section's and a picture's among them, is served the Open in Luke page, and no page of Luke's own is", () => {
  const opens = (vercel.services[SERVICE.WEB].routes ?? []).flatMap((route) =>
    "dest" in route && route.dest === "/open.html" ? [new RegExp(`^${route.src}$`, "u")] : [],
  );
  const served = (path: string) => opens.some((route) => route.test(path));

  assert.equal(opens.length, 1);
  assert.equal(served("/acme/plan/3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b"), true);
  assert.equal(served("/personal-u_1/plan/3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b/"), true);
  assert.equal(
    served(
      "/acme/plan/3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b/files/0b6f6b52-2c1e-4f8e-9a4d-7f1c2e9d5a01",
    ),
    true,
  );
  for (const path of [
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
    assert.equal(served(path), true, path);
  }
  for (const path of [
    "/about",
    "/changelog/page/2",
    "/api/plans/x/board",
    "/api/inbox/i1",
    "/api/automations/x1/runs",
    "/api/agents/a1",
    "/acme/plans/x",
    "/acme",
    "/",
  ]) {
    assert.equal(served(path), false, path);
  }
});
