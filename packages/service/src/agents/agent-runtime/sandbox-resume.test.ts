/**
 * sandbox-resume.test.ts -- an eve session whose Vercel sandbox, or that sandbox's snapshot, is gone opens a fresh one through its selector on its next open, as the eve patch makes it.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { temporaryDirectory } from "@luke/wire/testing";
import { expect, test } from "vitest";
import { createVercelSandbox } from "../../../node_modules/eve/dist/src/execution/sandbox/bindings/vercel.js";
import type { VercelModule } from "../../../node_modules/eve/dist/src/execution/sandbox/bindings/vercel-sdk-types.js";
import { ensureSandboxAccess } from "../../../node_modules/eve/dist/src/execution/sandbox/ensure.js";
import { writeSandboxPreparedArtifactsManifest } from "../../../node_modules/eve/dist/src/runtime/sandbox/prepared-artifacts.js";
import type { RuntimeSandboxRegistry } from "../../../node_modules/eve/dist/src/runtime/sandbox/registry.js";
import type { SandboxState } from "../../../node_modules/eve/dist/src/sandbox/state.js";
import { createSandboxEnvironment } from "../../../node_modules/eve/dist/src/shared/sandbox-environment.js";

/**
 * eve 0.74.0 opens a session's sandbox once through the root's selector
 * (`apps/dev/sandbox.ts`, which checks the repository out) and on every
 * later open resumes the sandbox its state names, which never ran the
 * selector again: a sandbox Vercel deleted, or one whose snapshot expired
 * (`CODER.SANDBOX_SNAPSHOTS`), failed that resume, and every later sandbox
 * call of the session failed the same way. The patch in
 * `patches/eve@0.74.0.patch` makes the resume answer such a sandbox as
 * gone, deleting what is left of it, and the session's next open start a
 * fresh one through its selector, as eve 0.83.0 does for the first case;
 * this fails if an eve bump drops it.
 *
 * Synthetic sandboxes, snapshots, and sessions throughout.
 */

const NODE = "coder";
const SESSION = "session_fixture";
const TEMPLATE_SNAPSHOT = "snap_template_fixture";

/** An error as Vercel's SDK throws one for a refused call, by the status eve reads off it. */
function refusal(status: number, code: string): Error {
  return Object.assign(new Error(`Vercel answered ${status}`), {
    status,
    json: { error: { code } },
  });
}

/** One sandbox the fake keeps: whether its snapshot is gone, so its next command is refused. */
interface FakeSandbox {
  readonly name: string;
  status: string;
  tags: Record<string, string> | undefined;
  snapshotGone: boolean;
}

/**
 * A fake of the Vercel Sandbox SDK eve's provider calls: it keeps the
 * project's sandboxes by name, creates one from the template's snapshot,
 * and refuses a command in a sandbox whose snapshot is gone with the 410
 * Vercel answers it.
 */
function fakeVercel() {
  const sandboxes = new Map<string, FakeSandbox>();
  let created = 0;

  function handle(sandbox: FakeSandbox) {
    return {
      get name() {
        return sandbox.name;
      },
      get status() {
        return sandbox.status;
      },
      get tags() {
        return sandbox.tags;
      },
      async runCommand() {
        if (sandbox.snapshotGone) throw refusal(410, "snapshot_not_found");
        sandbox.status = "running";
        return { exitCode: 0, stdout: async () => "", stderr: async () => "" };
      },
      async update(patch: { readonly tags?: Record<string, string> }) {
        sandbox.tags = patch.tags ?? sandbox.tags;
      },
      async stop() {
        sandbox.status = "stopped";
      },
      async delete() {
        sandboxes.delete(sandbox.name);
      },
    };
  }

  // Note that the fake stands in for the SDK's classes, whose private fields no plain object carries.
  const module = {
    Sandbox: {
      async get(options: { readonly name: string }) {
        const sandbox = sandboxes.get(options.name);
        if (sandbox === undefined) throw refusal(404, "not_found");
        return handle(sandbox);
      },
    },
  } as unknown as VercelModule;

  return {
    sandboxes,
    created: () => created,
    loadSandboxModule: async () => module,
    createSandbox: async (input: {
      readonly createOptions: { readonly name: string; readonly tags?: Record<string, string> };
    }) => {
      created += 1;
      const sandbox = {
        name: input.createOptions.name,
        status: "running",
        tags: input.createOptions.tags,
        snapshotGone: false,
      };
      sandboxes.set(sandbox.name, sandbox);
      return handle(sandbox) as unknown as Awaited<ReturnType<VercelModule["Sandbox"]["get"]>>;
    },
  };
}

/**
 * A session's sandbox access as eve builds one for each step, over an app
 * root whose template snapshot is prepared, with a selector that opens the
 * sandbox as the root's does and counts its runs, which is where the root
 * checks its repository out.
 */
async function sessionSandbox(root: string, vercel: ReturnType<typeof fakeVercel>) {
  const compileDirectoryPath = join(root, ".eve", "compile");
  mkdirSync(compileDirectoryPath, { recursive: true });
  await writeSandboxPreparedArtifactsManifest({
    compileDirectoryPath,
    entries: [
      { nodeId: NODE, providerName: "vercel", artifact: { snapshotId: TEMPLATE_SNAPSHOT } },
    ],
  });
  const environment = createSandboxEnvironment({
    runtime: {
      providerName: "vercel",
      stateProtocolVersion: 1,
      implementation: createVercelSandbox({
        loadSandboxModule: vercel.loadSandboxModule,
        loadDeleteSandboxModule: vercel.loadSandboxModule,
        createSandbox: vercel.createSandbox,
      }),
    },
  });
  let checkouts = 0;
  // Note that the registry is eve's runtime record of a compiled agent, whose source references no test reads.
  const registry = {
    sandbox: {
      definition: {
        kind: "independent",
        environment,
        logicalPath: "sandbox.ts",
        revisionHash: "fixture",
        selector: async () => {
          checkouts += 1;
          return await environment.open();
        },
      },
    },
  } as unknown as RuntimeSandboxRegistry;
  return {
    checkouts: () => checkouts,
    open: (state: SandboxState | null) =>
      ensureSandboxAccess({
        compiledArtifactsSource: { kind: "disk", appRoot: root },
        nodeId: NODE,
        registry,
        sessionId: SESSION,
        state,
      }),
  };
}

/** The sandbox name a session's state records. */
function sandboxNameOf(state: SandboxState): string {
  const recorded = state.session?.state;
  if (typeof recorded !== "object" || recorded === null || !("sandboxName" in recorded)) {
    throw new Error("The session recorded no Vercel sandbox.");
  }
  return String(recorded.sandboxName);
}

test.for([
  {
    loss: "sandbox was deleted",
    lose: (sandbox: FakeSandbox, all: Map<string, FakeSandbox>) => all.delete(sandbox.name),
  },
  {
    loss: "sandbox's snapshot expired",
    lose: (sandbox: FakeSandbox) => {
      sandbox.snapshotGone = true;
    },
  },
])("a session whose $loss opens a fresh sandbox through its selector", async ({ lose }, t) => {
  const vercel = fakeVercel();
  const session = await sessionSandbox(await temporaryDirectory(t, "eve-sandbox-"), vercel);
  const first = await session.open(null);
  await first.get();
  const recorded = await first.captureState();
  const lost = vercel.sandboxes.get(sandboxNameOf(recorded));
  if (lost === undefined) throw new Error("The first open made no sandbox.");
  lose(lost, vercel.sandboxes);

  const next = await session.open(recorded);

  expect(await next.get()).not.toBeNull();
  expect(session.checkouts()).toBe(2);
  expect(vercel.created()).toBe(2);
  const reopened = vercel.sandboxes.get(sandboxNameOf(await next.captureState()));
  expect(reopened).toMatchObject({ snapshotGone: false });
});
