import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RESERVED_WORKSPACE_SLUGS } from "@luke/features/workspace-wire";
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

const SERVICE = { WEB: "web", EVE: "eve", CODER: "coder" } as const;

interface Services {
  readonly [SERVICE.WEB]: Service;
  readonly [SERVICE.EVE]: Service;
  readonly [SERVICE.CODER]: Service;
}

// SAFETY: the file is this repository's own vercel.json, read for its deployment shape.
const vercel = JSON.parse(
  readFileSync(fileURLToPath(new URL("../vercel.json", import.meta.url)), "utf8"),
) as { services: Services; rewrites: readonly Rewrite[] };

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
