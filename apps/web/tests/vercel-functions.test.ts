import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { VOICE_SERVICE_PATH } from "@sidecar/hosted";
import { test } from "vitest";
import {
  FUNCTION_MAX_DURATION_SECONDS,
  functionConfigSource,
  functionPath,
  VOICE_FUNCTION_MAX_DURATION_SECONDS,
} from "../server/function-durations";

test("both voice functions carry the 800 second maximum duration", () => {
  for (const path of Object.values(VOICE_SERVICE_PATH)) {
    assert.equal(FUNCTION_MAX_DURATION_SECONDS.get(path), VOICE_FUNCTION_MAX_DURATION_SECONDS);
  }
});

test("every path given a duration is a route with an entrypoint, and vercel.json names it", () => {
  const vercel = JSON.parse(
    readFileSync(fileURLToPath(new URL("../vercel.json", import.meta.url)), "utf8"),
  ) as { functions: Record<string, { maxDuration: number }> };
  for (const [path, maxDuration] of FUNCTION_MAX_DURATION_SECONDS) {
    const relative = `${path.slice("/api/".length)}.ts`;
    assert.ok(
      existsSync(fileURLToPath(new URL(`../server/routes/${relative}`, import.meta.url))),
      path,
    );
    assert.ok(existsSync(fileURLToPath(new URL(`../api/${relative}`, import.meta.url))), path);
    assert.equal(functionPath(relative), path);
    assert.deepEqual(vercel.functions[`api/${relative}`], { maxDuration });
  }
  assert.equal(Object.keys(vercel.functions).length, FUNCTION_MAX_DURATION_SECONDS.size);
});

// Vercel discovers a function from the files under `api/` in the source tree,
// before the build runs, so a route with no committed entrypoint is a 404 on
// the deployment however well it builds.
test("every route under server/routes/ has an entrypoint under api/ that re-exports it", () => {
  const routes = fileURLToPath(new URL("../server/routes/", import.meta.url));
  const api = fileURLToPath(new URL("../api/", import.meta.url));
  const sources = readdirSync(routes, { recursive: true, encoding: "utf8" }).filter((file) =>
    file.endsWith(".ts"),
  );
  assert.ok(sources.length > 0);
  for (const relative of sources) {
    const entrypoint = `${api}${relative}`;
    assert.ok(existsSync(entrypoint), relative);
    const depth = relative.split("/").length;
    const expected = `export { default } from "${"../".repeat(depth)}server/routes/${relative.slice(0, -3)}.js";\n`;
    assert.equal(readFileSync(entrypoint, "utf8"), expected, relative);
  }
});

test("the config literal parses back to the duration it was written from", async () => {
  const source = functionConfigSource(VOICE_FUNCTION_MAX_DURATION_SECONDS);
  // SAFETY: the module is the one line `functionConfigSource` wrote, whose only export is `config`.
  const module = (await import(`data:text/javascript,${encodeURIComponent(source)}`)) as {
    config: { maxDuration: number };
  };
  assert.deepEqual(module.config, { maxDuration: VOICE_FUNCTION_MAX_DURATION_SECONDS });
});
