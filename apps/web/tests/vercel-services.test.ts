import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
