import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { temporaryDirectory } from "@luke/runtime/testing";
import { type TestContext, test, vi } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../../scripts/eve-source-maps.sh", import.meta.url));

/** The deployment's commit, which the SDK reports as its release. */
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

/**
 * A `sentry-cli` that reaches no Sentry: `upload` records its arguments and
 * the maps it would have sent from the paths it was handed, links followed as
 * the real one follows them, and every other command does nothing.
 */
const SENTRY_CLI = `#!/bin/sh
[ "$2" = upload ] || exit 0
here=$(dirname "$0")
printf '%s\\n' "$@" > "$here/upload-arguments"
for path in "$@"; do
    [ -d "$path" ] && find -L "$path" -name node_modules -prune -o -name '*.map' -print
done | sort > "$here/uploaded-maps"
`;

/** What `eve build` leaves for Vercel, with the hidden maps the root's Nitro config asks for. */
const BUILT_FILES = [
  "functions/__server.func/index.mjs",
  "functions/__server.func/index.mjs.map",
  "functions/__server.func/_libs/eve.mjs",
  "functions/__server.func/_libs/eve.mjs.map",
  "functions/__server.func/node_modules/traced/index.js",
  "functions/__server.func/node_modules/traced/index.js.map",
  "functions/.well-known/workflow/v1/flow.func/index.mjs",
  "functions/.well-known/workflow/v1/flow.func/index.mjs.map",
];

interface Run {
  readonly status: number | null;
  readonly output: string;
  /** Each argument the upload was called with, or undefined where nothing was uploaded. */
  readonly uploadArguments: readonly string[] | undefined;
  /** The maps the upload sent, relative to the service's root. */
  readonly uploadedMaps: readonly string[];
}

/** A service root holding a built output under `output`, as `eve build` leaves it. */
async function builtService(t: TestContext, output: string, files = BUILT_FILES): Promise<string> {
  const root = await temporaryDirectory(t, "luke-eve-source-maps-");
  for (const file of files) {
    mkdirSync(dirname(join(root, output, file)), { recursive: true });
    writeFileSync(join(root, output, file), `${file}\n`);
  }
  // Note that eve links most routes to the server's bundle rather than copying it.
  mkdirSync(join(root, output, "functions/eve/v1"), { recursive: true });
  symlinkSync("./__server.func", join(root, output, "functions/index.func"));
  symlinkSync("./../../__server.func", join(root, output, "functions/eve/v1/session.func"));
  return root;
}

/** Runs the step from the service's root after its build, as its build command does. */
async function upload(
  t: TestContext,
  root: string,
  environment: Record<string, string>,
): Promise<Run> {
  const bin = await temporaryDirectory(t, "luke-eve-source-maps-bin-");
  writeFileSync(join(bin, "sentry-cli"), SENTRY_CLI);
  chmodSync(join(bin, "sentry-cli"), 0o755);
  const ran = spawnSync("bash", [SCRIPT], {
    cwd: root,
    encoding: "utf8",
    env: { PATH: `${bin}${delimiter}${process.env.PATH}`, HOME: root, ...environment },
  });
  const read = (name: string) =>
    existsSync(join(bin, name)) ? readFileSync(join(bin, name), "utf8").trim().split("\n") : [];
  const uploadArguments = existsSync(join(bin, "upload-arguments"))
    ? read("upload-arguments")
    : undefined;
  return {
    status: ran.status,
    output: ran.stdout + ran.stderr,
    uploadArguments,
    uploadedMaps: read("uploaded-maps").filter((line) => line.length > 0),
  };
}

/** The value given after `flag` among an upload's arguments. */
function flagValue(
  argumentsGiven: readonly string[] | undefined,
  flag: string,
): string | undefined {
  const at = argumentsGiven?.indexOf(flag) ?? -1;
  return at === -1 ? undefined : argumentsGiven?.[at + 1];
}

function existing(root: string, output: string): string[] {
  return BUILT_FILES.filter((file) => existsSync(join(root, output, file)));
}

test("a build without SENTRY_AUTH_TOKEN uploads nothing and leaves the output as eve wrote it", async (t) => {
  const root = await builtService(t, ".vercel/output");
  const run = await upload(t, root, { VERCEL: "1", VERCEL_GIT_COMMIT_SHA: COMMIT });
  assert.equal(run.status, 0, run.output);
  assert.equal(run.uploadArguments, undefined);
  assert.deepEqual(existing(root, ".vercel/output"), BUILT_FILES);
});

test("a Preview build with the token uploads nothing and leaves the output as eve wrote it", async (t) => {
  const root = await builtService(t, ".vercel/output");
  const run = await upload(t, root, {
    VERCEL: "1",
    VERCEL_GIT_COMMIT_SHA: COMMIT,
    SENTRY_AUTH_TOKEN: "test-token",
    VERCEL_ENV: "preview",
  });
  assert.equal(run.status, 0, run.output);
  assert.equal(run.uploadArguments, undefined);
  assert.deepEqual(existing(root, ".vercel/output"), BUILT_FILES);
});

test("a build with the token uploads every bundle's maps to luke-web under the commit, then ships none", async (t) => {
  const root = await builtService(t, ".vercel/output");
  const run = await upload(t, root, {
    VERCEL: "1",
    VERCEL_GIT_COMMIT_SHA: COMMIT,
    SENTRY_AUTH_TOKEN: "test-token",
    VERCEL_ENV: "production",
  });
  assert.equal(run.status, 0, run.output);
  assert.equal(flagValue(run.uploadArguments, "--org"), "stage-review");
  assert.equal(flagValue(run.uploadArguments, "--project"), "luke-web");
  assert.equal(flagValue(run.uploadArguments, "--release"), COMMIT);
  // The workflow's hidden function is uploaded, each bundle once, and no traced dependency's map.
  assert.deepEqual(run.uploadedMaps, [
    ".vercel/output/functions/.well-known/workflow/v1/flow.func/index.mjs.map",
    ".vercel/output/functions/__server.func/_libs/eve.mjs.map",
    ".vercel/output/functions/__server.func/index.mjs.map",
  ]);
  assert.deepEqual(existing(root, ".vercel/output"), [
    "functions/__server.func/index.mjs",
    "functions/__server.func/_libs/eve.mjs",
    "functions/__server.func/node_modules/traced/index.js",
    "functions/__server.func/node_modules/traced/index.js.map",
    "functions/.well-known/workflow/v1/flow.func/index.mjs",
  ]);
});

test("the output Vercel names for the service is the one uploaded from", async (t) => {
  const root = await builtService(t, "service-output");
  const run = await upload(t, root, {
    VERCEL: "1",
    EVE_INTERNAL_BUILD_OUTPUT_DIRECTORY: "service-output",
    SENTRY_AUTH_TOKEN: "test-token",
    VERCEL_ENV: "production",
  });
  assert.equal(run.status, 0, run.output);
  assert.equal(run.uploadedMaps.length, 3);
  assert.ok(run.uploadedMaps.every((map) => map.startsWith("service-output/functions/")));
  assert.ok(!existsSync(join(root, "service-output/functions/__server.func/index.mjs.map")));
});

test("a build with the token but no maps fails rather than shipping traces Sentry cannot read", async (t) => {
  const root = await builtService(
    t,
    ".vercel/output",
    BUILT_FILES.filter((file) => !file.endsWith(".mjs.map")),
  );
  const run = await upload(t, root, {
    VERCEL: "1",
    VERCEL_GIT_COMMIT_SHA: COMMIT,
    SENTRY_AUTH_TOKEN: "test-token",
    VERCEL_ENV: "production",
  });
  assert.notEqual(run.status, 0);
  assert.equal(run.uploadArguments, undefined);
});

/** Each eve root's Nitro config, which decides whether `eve build` writes the maps this step uploads. */
const NITRO_CONFIGS = ["luke", "dev"].map((root) =>
  fileURLToPath(new URL(`../../${root}/nitro.config.ts`, import.meta.url)),
);

/** What a Nitro config's production overrides say about source maps. */
interface NitroProductionConfig {
  readonly sourcemap?: string;
}

/** The production overrides one Nitro config answers under `environment`. */
async function nitroProductionConfig(
  path: string,
  environment: Readonly<Record<string, string>>,
): Promise<NitroProductionConfig> {
  vi.resetModules();
  vi.stubEnv("SENTRY_AUTH_TOKEN", environment.SENTRY_AUTH_TOKEN ?? "");
  vi.stubEnv("VERCEL_ENV", environment.VERCEL_ENV ?? "");
  try {
    const loaded: { default: { $production: NitroProductionConfig } } = await import(
      /* @vite-ignore */ path
    );
    return loaded.default.$production;
  } finally {
    vi.unstubAllEnvs();
  }
}

test("each eve root's Nitro config writes hidden maps only for a production build holding the token", async () => {
  for (const path of NITRO_CONFIGS) {
    const production = await nitroProductionConfig(path, {
      SENTRY_AUTH_TOKEN: "test-token",
      VERCEL_ENV: "production",
    });
    assert.equal(production.sourcemap, "hidden", path);
    for (const environment of [
      { SENTRY_AUTH_TOKEN: "test-token", VERCEL_ENV: "preview" },
      { SENTRY_AUTH_TOKEN: "test-token" },
      { VERCEL_ENV: "production" },
    ]) {
      assert.deepEqual(await nitroProductionConfig(path, environment), {}, path);
    }
  }
});
