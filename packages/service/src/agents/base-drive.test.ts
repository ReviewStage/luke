/**
 * base-drive.test.ts -- a workspace's repository's base drive, against a fake of Vercel Sandbox's API: filled once from the image with the repository cloned and its dependencies installed and no credential left behind, filled by one of several launches at once, and gone after a fill that failed.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { Effect, Fiber, Redacted } from "effect";
import { fixtureToken, runnerSandboxApi } from "../testing/runner-sandbox-fake.js";
import { BASE_DRIVE, type BaseDriveOf, baseDriveName, fillBaseDrive } from "./base-drive.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "./repository-sandbox-contract.js";
import type { RepositorySandbox } from "./repository-shell.js";
import { composePolicy, type FirewallEntry, type FirewallSlot } from "./sandbox-firewall.js";
import { type VercelSandboxApi, vercelSandboxApi } from "./vercel-sandbox-api.js";

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

/** The fill's sandbox as the clone reaches it: each run straight to the API, and each policy composed from what stands at its firewall. */
function opener(api: VercelSandboxApi) {
  return (running: string): RepositorySandbox => {
    const standing = new Map<FirewallSlot, FirewallEntry>();
    const composed = () =>
      Effect.suspend(() => api.updateNetworkPolicy(running, composePolicy(standing)));
    return {
      run: (ask) =>
        Effect.runPromise(
          api.run(running, {
            command: "bash",
            args: ["-c", ask.command],
            ...(ask.workingDirectory === undefined ? undefined : { cwd: ask.workingDirectory }),
            ...(ask.env === undefined ? undefined : { env: ask.env }),
          }),
        ),
      firewall: {
        set: (slot, entry) =>
          Effect.andThen(
            Effect.sync(() => standing.set(slot, entry)),
            composed(),
          ),
        withdraw: (slot) =>
          Effect.andThen(
            Effect.sync(() => standing.delete(slot)),
            composed(),
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

      yield* filled(api);

      const name = baseDriveName(RELAY);
      assert.deepEqual([...fake.drives], [name]);
      const [sandbox] = fake.sandboxes;
      assert.ok(sandbox !== undefined);
      assert.equal(sandbox.image, IMAGE);
      assert.deepEqual(sandbox.mounts, {
        [BASE_DRIVE.MOUNT_PATH]: { drive: name, mode: "read-write" },
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
