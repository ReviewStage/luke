/**
 * base-snapshot.test.ts -- a workspace's repository's base snapshot, against a fake of Vercel Sandbox's API: filled once from the image with the repository cloned and its dependencies installed and no credential left behind, filled by one of several launches at once, filled again on another image or in place of a snapshot a launch found unusable, and gone after a fill that failed.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { Duration, Effect, Fiber, Redacted } from "effect";
import { runnerSandboxApi } from "../testing/runner-sandbox-fake.js";
import { fixtureToken } from "../testing/vercel-sandbox-fake.js";
import {
  BASE_SNAPSHOT,
  BASE_STATE,
  type BaseSnapshotOf,
  baseSnapshotName,
  fillBaseSnapshot,
  readBaseSnapshot,
} from "./base-snapshot.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "./repository-sandbox-contract.js";
import type { RepositorySandbox } from "./repository-shell.js";
import { composePolicy } from "./sandbox-firewall.js";
import {
  sessionOnFirstUse,
  type VercelSandboxApi,
  vercelSandboxApi,
} from "./vercel-sandbox-api.js";

const IMAGE = "agent-image:fixture";
const NEXT_IMAGE = "agent-image:next";
const TOKEN = "ghs_fixtureBaseSnapshotToken";
const RELAY: BaseSnapshotOf = {
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

/** The base snapshot filled for the repository given, on the image given, in place of the snapshot named where one is. */
const filled = (api: VercelSandboxApi, image = IMAGE, replacing?: string) =>
  fillBaseSnapshot(api, RELAY, image, CREDENTIAL, opener(api), replacing);

/** Whether a run the fake took was the install. */
const isInstall = (args: readonly string[]) => args.some((arg) => arg.includes("pnpm install"));

/** The base's snapshot as a launch on the image given reads it, where it is ready. */
const readySnapshot = (api: VercelSandboxApi, image = IMAGE) =>
  Effect.map(readBaseSnapshot(api, RELAY, image), (read) =>
    read.state === BASE_STATE.READY ? read.snapshotId : undefined,
  );

it.effect(
  "a repository with no base snapshot has one filled from the image: cloned with the token at the firewall for the clone alone, installed, and snapshotted to lapse a month after its last use",
  () =>
    Effect.gen(function* () {
      const { fake, api } = yield* fixture;
      const before = yield* readBaseSnapshot(api, RELAY, IMAGE);

      yield* filled(api);

      assert.equal(before.state, BASE_STATE.WANTED);
      const [sandbox] = fake.sandboxes;
      assert.ok(sandbox !== undefined);
      assert.deepEqual(
        [sandbox.name, sandbox.image, sandbox.status, sandbox.deleted],
        [baseSnapshotName(RELAY), IMAGE, "stopped", false],
      );
      assert.deepEqual(fake.snapshots, [sandbox.currentSnapshotId]);
      assert.equal(
        fake.snapshotExpirations.get(fake.snapshots[0] ?? ""),
        Duration.toMillis(BASE_SNAPSHOT.LAPSE),
      );
      assert.equal(yield* readySnapshot(api), fake.snapshots[0]);
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

it.effect("launches that fill at once leave one base snapshot", () =>
  Effect.gen(function* () {
    const { fake, api } = yield* fixture;

    const fibers = yield* Effect.forEach([1, 2, 3], () => Effect.forkChild(filled(api)));
    yield* Effect.forEach(fibers, Fiber.join);

    assert.equal(fake.sandboxes.length, 1);
    assert.equal(fake.snapshots.length, 1);
  }),
);

it.effect(
  "a base made on another image is not created from, and the next fill makes it again on the new image",
  () =>
    Effect.gen(function* () {
      const { fake, api } = yield* fixture;
      yield* filled(api);

      const onNext = yield* readySnapshot(api, NEXT_IMAGE);
      yield* filled(api, NEXT_IMAGE);

      assert.equal(onNext, undefined);
      assert.deepEqual(
        fake.sandboxes.map((each) => [each.image, each.deleted]),
        [
          [IMAGE, true],
          [NEXT_IMAGE, false],
        ],
      );
      assert.equal(yield* readySnapshot(api, NEXT_IMAGE), fake.snapshots[1]);
    }),
);

it.effect(
  "a fill in place of the snapshot a launch found unusable makes it again, and one in place of a snapshot already replaced leaves the base be",
  () =>
    Effect.gen(function* () {
      const { fake, api } = yield* fixture;
      yield* filled(api);
      const [first = ""] = fake.snapshots;

      yield* filled(api, IMAGE, first);
      yield* filled(api, IMAGE, first);

      assert.equal(fake.snapshots.length, 2);
      assert.equal(yield* readySnapshot(api), fake.snapshots[1]);
    }),
);

it.effect("a fill whose install failed leaves no base snapshot", () =>
  Effect.gen(function* () {
    const { fake, api } = yield* fixture;
    fake.hooks.runExit = (args) => (isInstall(args) ? 1 : 0);

    const failed = yield* Effect.result(filled(api));

    assert.equal(failed._tag, "Failure");
    assert.deepEqual(fake.snapshots, []);
    assert.equal(fake.sandboxes[0]?.deleted, true);
    assert.equal((yield* readBaseSnapshot(api, RELAY, IMAGE)).state, BASE_STATE.WANTED);
  }),
);
