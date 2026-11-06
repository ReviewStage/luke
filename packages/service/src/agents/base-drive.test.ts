/**
 * base-drive.test.ts -- a workspace's repository's base drive, against a fake of Vercel Sandbox's API: filled once from the image with the repository cloned and its dependencies installed and no credential left behind, filled by one of several launches at once, not filled while its fill's sandbox is still being created or still runs, and gone after a fill that failed.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { Effect, Fiber, Redacted } from "effect";
import { runnerSandboxApi } from "../testing/runner-sandbox-fake.js";
import { fixtureToken } from "../testing/vercel-sandbox-fake.js";
import {
  BASE_DRIVE,
  type BaseDriveOf,
  baseDriveFilled,
  baseDriveName,
  fillBaseDrive,
} from "./base-drive.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "./repository-sandbox-contract.js";
import type { RepositorySandbox } from "./repository-shell.js";
import { composePolicy } from "./sandbox-firewall.js";
import {
  sessionOnFirstUse,
  type VercelSandboxApi,
  vercelSandboxApi,
} from "./vercel-sandbox-api.js";

const IMAGE = "agent-image:fixture";
const TOKEN = "ghs_fixtureBaseDriveToken";
const RELAY: BaseDriveOf = {
  workspaceId: "workspace-relay",
  fullName: "Acme/Relay",
  defaultBranch: "trunk",
};
const CREDENTIAL = { token: Redacted.make(TOKEN), access: { kind: GITHUB_ACCESS.APP } } as const;

/** The fake Vercel and the API over it. */
const fixture = Effect.gen(function* () {
  const fake = runnerSandboxApi();
  const api = yield* vercelSandboxApi(async () => fixtureToken()).pipe(Effect.provide(fake.layer));
  return { fake, api };
});

/** The fill's sandbox as the clone reaches it: each run straight to the API, and each policy composed from the sources its write names. */
function opener(api: VercelSandboxApi) {
  return ({ name, running }: { name: string; running: string }): RepositorySandbox => {
    const session = sessionOnFirstUse(api, { name, sessionId: running });
    return {
      run: (ask) =>
        Effect.runPromise(
          Effect.flatMap(session, (held) =>
            held.run({
              command: "bash",
              args: ["-c", ask.command],
              ...(ask.workingDirectory === undefined ? undefined : { cwd: ask.workingDirectory }),
              ...(ask.env === undefined ? undefined : { env: ask.env }),
            }),
          ),
        ),
      firewall: {
        write: (sources) =>
          Effect.flatMap(session, (held) =>
            held.updateNetworkPolicy(composePolicy(sources, new Map())),
          ),
      },
    };
  };
}

/** The base drive filled for the repository given. */
const filled = (api: VercelSandboxApi) => fillBaseDrive(api, RELAY, IMAGE, CREDENTIAL, opener(api));

/** Whether a run the fake took was the install. */
const isInstall = (args: readonly string[]) => args.some((arg) => arg.includes("pnpm install"));

it.effect(
  "a repository with no base drive has one filled from the image: cloned at the workspace with the token at the firewall for the clone alone, installed, and its sandbox deleted",
  () =>
    Effect.gen(function* () {
      const { fake, api } = yield* fixture;

      const atFork: { installed: boolean; stopped: boolean }[] = [];
      const forking: VercelSandboxApi = {
        ...api,
        forkDrive: (source, target) =>
          Effect.andThen(
            Effect.sync(() =>
              atFork.push({
                installed: fake.runs.some((run) => isInstall(run.args)),
                stopped: fake.sandboxes[0]?.status === "stopped",
              }),
            ),
            api.forkDrive(source, target),
          ),
      };

      yield* fillBaseDrive(forking, RELAY, IMAGE, CREDENTIAL, opener(api));

      const name = baseDriveName(RELAY);
      // The base drive is forked once, from a staging drive already installed and let go by its stopped sandbox.
      assert.deepEqual(atFork, [{ installed: true, stopped: true }]);
      assert.deepEqual([...fake.drives], [name]);
      const [sandbox] = fake.sandboxes;
      assert.ok(sandbox !== undefined);
      assert.equal(sandbox.image, IMAGE);
      assert.deepEqual(sandbox.mounts, {
        [BASE_DRIVE.MOUNT_PATH]: { drive: `${name}-staging`, mode: "read-write" },
      });
      assert.equal(sandbox.deleted, true);
      const clone = fake.runs.findIndex((run) =>
        Object.hasOwn(run.env, REPOSITORY_SANDBOX_CONTRACT.VARIABLE.URL),
      );
      const install = fake.runs.findIndex((run) => isInstall(run.args));
      assert.ok(clone !== -1 && install > clone);
      // The token stood at the firewall for the clone, and came off before the install.
      assert.ok(JSON.stringify(fake.policies[0]?.policy).includes("Basic "));
      assert.deepEqual(fake.policies.at(-1)?.policy, { mode: "allow-all" });
      assert.equal(JSON.stringify([fake.runs, fake.sandboxes]).includes(TOKEN), false);

      yield* filled(api);
      assert.equal(fake.sandboxes.length, 1);
    }),
);

it.effect("launches that fill at once leave one base drive", () =>
  Effect.gen(function* () {
    const { fake, api } = yield* fixture;

    const fibers = yield* Effect.forEach([1, 2, 3], () => Effect.forkChild(filled(api)));
    yield* Effect.forEach(fibers, Fiber.join);

    assert.deepEqual([...fake.drives], [baseDriveName(RELAY)]);
    assert.equal(fake.sandboxes.filter((each) => !each.deleted).length, 0);
  }),
);

it.effect("a base drive is not filled while its fill's sandbox is still being created", () =>
  Effect.gen(function* () {
    const { api } = yield* fixture;
    let whileCreating: boolean | undefined;
    const creating: VercelSandboxApi = {
      ...api,
      create: (ask) =>
        Effect.andThen(
          Effect.map(baseDriveFilled(api, RELAY), (filled) => {
            whileCreating = filled;
          }),
          api.create(ask),
        ),
    };

    yield* fillBaseDrive(creating, RELAY, IMAGE, CREDENTIAL, opener(api));

    assert.equal(whileCreating, false);
    assert.equal(yield* baseDriveFilled(api, RELAY), true);
  }),
);

it.effect(
  "a base drive whose fill is still installing is not filled until its sandbox is gone",
  () =>
    Effect.gen(function* () {
      const { fake, api } = yield* fixture;
      let arrived = () => {};
      const installing = new Promise<void>((resolve) => {
        arrived = resolve;
      });
      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      fake.hooks.onRun = async (_env, _command, args) => {
        if (!isInstall(args)) return;
        arrived();
        await released;
      };

      const fill = yield* Effect.forkChild(filled(api));
      yield* Effect.promise(() => installing);
      const whileInstalling = yield* baseDriveFilled(api, RELAY);
      release();
      yield* Fiber.join(fill);

      assert.equal(whileInstalling, false);
      assert.equal(yield* baseDriveFilled(api, RELAY), true);
    }),
);

it.effect("a fill whose install failed leaves no base drive", () =>
  Effect.gen(function* () {
    const { fake, api } = yield* fixture;
    fake.hooks.runExit = (args) => (isInstall(args) ? 1 : 0);

    const failed = yield* Effect.result(filled(api));

    assert.equal(failed._tag, "Failure");
    assert.deepEqual([...fake.drives], []);
    assert.equal(fake.sandboxes[0]?.deleted, true);
  }),
);
