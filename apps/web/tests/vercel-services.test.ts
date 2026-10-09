import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { webFunctions } from "../server/function-layout";
import {
  apiRewrites,
  rewritesDrifted,
  TopLevelRoutesBesideServicesError,
  VERCEL_CONFIG_FILE,
  vercelConfigSource,
} from "../server/function-rewrites";

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

/**
 * In services mode Vercel evaluates only the keys a service owns, so a build
 * or routing key left at the top level is ignored rather than refused: a route
 * added there deploys green and does not exist. These keys have exactly one
 * home each, and the test says which.
 */
const SERVICE_OWNED_KEYS = [
  "routes",
  "buildCommand",
  "installCommand",
  "ignoreCommand",
  "devCommand",
  "outputDirectory",
  "framework",
  "functions",
] as const;

const SERVICE = { WEB: "web", EVE: "eve", CODER: "coder" } as const;

/** Where the coding-agent service's eve routes stand publicly: eve's named mount, which the service's own route turns back into `/eve/v1/*`. */
const CODER_MOUNT = "/eve/coder";

interface Services {
  readonly [SERVICE.WEB]: Service;
  readonly [SERVICE.EVE]: Service;
  readonly [SERVICE.CODER]: Service;
}

// SAFETY: the file is this repository's own vercel.json, read for its deployment shape.
const vercel = JSON.parse(
  readFileSync(fileURLToPath(new URL("../vercel.json", import.meta.url)), "utf8"),
) as { services: Services; rewrites: readonly Rewrite[] };

test("the deployment is the web, eve, and coder services, and every build and routing key lives under a service", () => {
  assert.deepEqual(Object.keys(vercel.services), [SERVICE.WEB, SERVICE.EVE, SERVICE.CODER]);
  assert.equal(vercel.services[SERVICE.WEB].root, ".");
  assert.equal(vercel.services[SERVICE.EVE].root, "eve");
  assert.equal(vercel.services[SERVICE.CODER].root, "coder");
  for (const key of SERVICE_OWNED_KEYS) {
    assert.equal(
      key in vercel,
      false,
      `vercel.json#${key} is ignored in services mode; it belongs under services.${SERVICE.WEB}`,
    );
  }
});

test("the web service owns the routes, the eve service has none, and every rewrite names a declared service", () => {
  const web = vercel.services[SERVICE.WEB];
  assert.ok(web.routes);
  assert.ok(web.routes.length > 0);
  assert.equal(vercel.services[SERVICE.EVE].routes, undefined);
  const declared = new Set(Object.keys(vercel.services));
  assert.deepEqual(
    vercel.rewrites.map((rewrite) => rewrite.destination.service),
    [SERVICE.CODER, SERVICE.EVE, SERVICE.WEB],
  );
  for (const rewrite of vercel.rewrites) assert.ok(declared.has(rewrite.destination.service));
  assert.equal(vercel.rewrites.at(-1)?.source, "/(.*)");
});

test("the coder service stands at eve's named mount: its rewrite comes before the planning brain's, its build names the mount, and its one route turns the mount back into eve's own path", () => {
  const coder = vercel.services[SERVICE.CODER];
  assert.equal(vercel.rewrites[0]?.source, `${CODER_MOUNT}/v1/(.*)`);
  assert.ok(coder.buildCommand?.includes(`EVE_PUBLIC_ROUTE_PREFIX=${CODER_MOUNT}`));
  assert.deepEqual(coder.routes, [
    {
      src: `^${CODER_MOUNT}/v1/(.*)$`,
      transforms: [{ type: "request.path", op: "set", args: "/eve/v1/$1" }],
    },
  ]);
});

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
});

test("a top-level routes key beside services is refused by the generator before the file is read for anything else", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vercel-services-"));
  const shape = { ...vercel, routes: vercel.services[SERVICE.WEB].routes };
  await writeFile(join(directory, VERCEL_CONFIG_FILE), JSON.stringify(shape));
  await assert.rejects(rewritesDrifted(directory), {
    name: TopLevelRoutesBesideServicesError.name,
  });
  await assert.rejects(vercelConfigSource(directory), {
    name: TopLevelRoutesBesideServicesError.name,
  });
});
