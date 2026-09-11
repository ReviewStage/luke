import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

interface Route {
  readonly src: string;
  readonly dest: string;
}

interface Service {
  readonly root: string;
  readonly routes?: readonly Route[];
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

const SERVICE = { WEB: "web", EVE: "eve" } as const;

interface Services {
  readonly [SERVICE.WEB]: Service;
  readonly [SERVICE.EVE]: Service;
}

// SAFETY: the file is this repository's own vercel.json, read for its deployment shape.
const vercel = JSON.parse(
  readFileSync(fileURLToPath(new URL("../vercel.json", import.meta.url)), "utf8"),
) as { services: Services; rewrites: readonly Rewrite[] };

test("the deployment is the web and eve services, and every build and routing key lives under a service", () => {
  assert.deepEqual(Object.keys(vercel.services), [SERVICE.WEB, SERVICE.EVE]);
  assert.equal(vercel.services[SERVICE.WEB].root, ".");
  assert.equal(vercel.services[SERVICE.EVE].root, "agent");
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
    [SERVICE.EVE, SERVICE.WEB],
  );
  for (const rewrite of vercel.rewrites) assert.ok(declared.has(rewrite.destination.service));
  assert.equal(vercel.rewrites.at(-1)?.source, "/(.*)");
});
