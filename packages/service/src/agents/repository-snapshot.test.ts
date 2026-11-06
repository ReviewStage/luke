/**
 * repository-snapshot.test.ts -- a workspace's repository snapshot, against a fake of Vercel Sandbox's REST API: built from the image with the repository cloned whole and no credential left behind, built once by launches at once, and built again past its age or after a build that failed or was left behind.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { Duration, Effect, Fiber, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { fixtureToken, runnerSandboxApi } from "../testing/runner-sandbox-fake.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "./repository-sandbox-contract.js";
import type { RepositorySandbox } from "./repository-shell.js";
import {
  buildRepositorySnapshot,
  forgetRepositorySnapshot,
  REPOSITORY_SNAPSHOT,
  REPOSITORY_SNAPSHOT_STATE,
  type RepositorySnapshotOf,
  readRepositorySnapshot,
  repositorySnapshotName,
} from "./repository-snapshot.js";
import { composePolicy } from "./sandbox-firewall.js";
import { type VercelSandboxApi, vercelSandboxApi } from "./vercel-sandbox-api.js";

const IMAGE = "agent-image:fixture";
const TOKEN = "ghs_fixtureRepositorySnapshotToken";
const RELAY: RepositorySnapshotOf = {
  image: IMAGE,
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

/** The build's sandbox as the clone reaches it: each run straight to the API, and each policy composed from the sources its write names. */
function opener(api: VercelSandboxApi) {
  return (running: string): RepositorySandbox => {
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
        write: (sources) => api.updateNetworkPolicy(running, composePolicy(sources, new Map())),
      },
    };
  };
}

/** The snapshot built for the repository given. */
const built = (api: VercelSandboxApi, of: RepositorySnapshotOf = RELAY) =>
  buildRepositorySnapshot(api, of, CREDENTIAL, opener(api));

it.effect(
  "a repository with no snapshot is built from the image, cloned whole with the token at the firewall for the clone alone, and snapshotted ready to open",
  () =>
    Effect.gen(function* () {
      const { fake, api } = yield* fixture;

      assert.deepEqual(yield* readRepositorySnapshot(api, RELAY), {
        state: REPOSITORY_SNAPSHOT_STATE.WANTED,
      });
      yield* built(api);

      const [sandbox] = fake.sandboxes;
      assert.ok(sandbox !== undefined);
      assert.equal(sandbox.name, repositorySnapshotName(RELAY));
      assert.equal(sandbox.image, IMAGE);
      assert.equal(sandbox.status, "stopped");
      // The agent's user was made before the clone, so a sandbox opened from the snapshot holds it.
      assert.ok(fake.runs.some((run) => run.args.join(" ") === "-m -s /bin/bash agent"));
      const clone = fake.runs.find((run) =>
        Object.hasOwn(run.env, REPOSITORY_SANDBOX_CONTRACT.VARIABLE.URL),
      );
      assert.ok(clone !== undefined);
      assert.equal(clone.env[REPOSITORY_SANDBOX_CONTRACT.VARIABLE.BRANCH], "trunk");
      assert.equal(Object.hasOwn(clone.env, REPOSITORY_SANDBOX_CONTRACT.VARIABLE.DEPTH), false);
      // The token stood at the firewall for the clone, and came off before the snapshot.
      assert.ok(JSON.stringify(fake.policies[0]?.policy).includes("Basic "));
      assert.deepEqual(fake.policies.at(-1)?.policy, { mode: "allow-all" });
      const visible = JSON.stringify([fake.runs, fake.sandboxes, fake.commands]);
      assert.equal(visible.includes(TOKEN), false);
      assert.deepEqual(yield* readRepositorySnapshot(api, RELAY), {
        state: REPOSITORY_SNAPSHOT_STATE.READY,
        snapshotId: fake.snapshots[0],
      });
      // It lapses on its own three days and fifteen minutes after its last use, so one no launch opens goes.
      assert.equal(fake.snapshotExpirations.get(fake.snapshots[0] ?? ""), 260_100_000);
    }),
);

it.effect("launches that build at once build one snapshot", () =>
  Effect.gen(function* () {
    const { fake, api } = yield* fixture;

    const fibers = yield* Effect.forEach([1, 2, 3], () => Effect.forkChild(built(api)));
    yield* Effect.forEach(fibers, Fiber.join);

    assert.equal(fake.sandboxes.length, 1);
    assert.equal(fake.snapshots.length, 1);
    assert.equal(
      (yield* readRepositorySnapshot(api, RELAY)).state,
      REPOSITORY_SNAPSHOT_STATE.READY,
    );
  }),
);

it.effect("a snapshot ready or being built is left be by another build", () =>
  Effect.gen(function* () {
    const { fake, api } = yield* fixture;
    yield* built(api);

    yield* built(api);

    assert.equal(fake.sandboxes.length, 1);
    assert.equal(fake.snapshots.length, 1);
  }),
);

it.effect(
  "a snapshot past its age is passed by, and the next build replaces it with a fresh one",
  () =>
    Effect.gen(function* () {
      const { fake, api } = yield* fixture;
      yield* built(api);
      yield* TestClock.adjust(REPOSITORY_SNAPSHOT.MAX_AGE);

      const stale = yield* readRepositorySnapshot(api, RELAY);
      yield* built(api);

      assert.equal(stale.state, REPOSITORY_SNAPSHOT_STATE.WANTED);
      assert.equal(fake.sandboxes[0]?.deleted, true);
      assert.equal(fake.snapshots.length, 2);
      assert.deepEqual(yield* readRepositorySnapshot(api, RELAY), {
        state: REPOSITORY_SNAPSHOT_STATE.READY,
        snapshotId: fake.snapshots[1],
      });
    }),
);

it.effect(
  "a build whose clone failed deletes its sandbox, so the next launch builds it again",
  () =>
    Effect.gen(function* () {
      const { fake, api } = yield* fixture;
      fake.hooks.runExit = (args) => (args.join(" ").includes("git clone") ? 128 : 0);

      const failed = yield* Effect.result(built(api));

      assert.equal(failed._tag, "Failure");
      assert.equal(fake.sandboxes[0]?.deleted, true);
      assert.equal(fake.snapshots.length, 0);
      assert.deepEqual(yield* readRepositorySnapshot(api, RELAY), {
        state: REPOSITORY_SNAPSHOT_STATE.WANTED,
      });
    }),
);

it.effect(
  "a build left unbuilt reads as being built within its grace, and is replaced once past it",
  () =>
    Effect.gen(function* () {
      const { fake, api } = yield* fixture;
      // A build whose function ended between its create and its snapshot, as Vercel then holds it.
      yield* api.create({
        name: repositorySnapshotName(RELAY),
        from: { image: IMAGE },
        tags: {},
        timeoutMs: 60_000,
        vcpus: 4,
        keepLastSnapshots: { count: 1, expiration: 60_000, deleteEvicted: true },
        env: {},
      });

      const within = yield* readRepositorySnapshot(api, RELAY);
      yield* built(api);
      const untouched = fake.sandboxes.length;
      // Past the grace from when Vercel says it was created.
      yield* TestClock.adjust(Duration.sum(REPOSITORY_SNAPSHOT.BUILD_GRACE, Duration.minutes(1)));
      yield* built(api);

      assert.equal(within.state, REPOSITORY_SNAPSHOT_STATE.BUILDING);
      assert.equal(untouched, 1);
      assert.equal(fake.sandboxes[0]?.deleted, true);
      assert.equal(
        (yield* readRepositorySnapshot(api, RELAY)).state,
        REPOSITORY_SNAPSHOT_STATE.READY,
      );
    }),
);

it.effect(
  "a snapshot a launch found unusable is forgotten, unless another build replaced it since",
  () =>
    Effect.gen(function* () {
      const { fake, api } = yield* fixture;
      yield* built(api);
      const [first] = fake.snapshots;
      assert.ok(first !== undefined);

      yield* forgetRepositorySnapshot(api, RELAY, "snap_another");
      const kept = yield* readRepositorySnapshot(api, RELAY);
      yield* forgetRepositorySnapshot(api, RELAY, first);

      assert.equal(kept.state, REPOSITORY_SNAPSHOT_STATE.READY);
      assert.equal(fake.sandboxes[0]?.deleted, true);
      assert.deepEqual(yield* readRepositorySnapshot(api, RELAY), {
        state: REPOSITORY_SNAPSHOT_STATE.WANTED,
      });
    }),
);

it.effect(
  "a workspace's snapshot is its own: another workspace, image, or branch is another snapshot, and the repository's case is not",
  () =>
    Effect.gen(function* () {
      const { fake, api } = yield* fixture;
      yield* built(api);

      const others: readonly RepositorySnapshotOf[] = [
        { ...RELAY, workspaceId: "workspace-other" },
        { ...RELAY, image: "agent-image:next" },
        { ...RELAY, defaultBranch: "main" },
      ];
      const reads = yield* Effect.forEach(others, (of) => readRepositorySnapshot(api, of));
      const sameRepository = yield* readRepositorySnapshot(api, {
        ...RELAY,
        fullName: "acme/relay",
      });

      assert.deepEqual(
        reads.map((read) => read.state),
        others.map(() => REPOSITORY_SNAPSHOT_STATE.WANTED),
      );
      assert.deepEqual(sameRepository, {
        state: REPOSITORY_SNAPSHOT_STATE.READY,
        snapshotId: fake.snapshots[0],
      });
    }),
);

it.effect(
  "a build that failed after another launch replaced its sandbox leaves the replacement be",
  () =>
    Effect.gen(function* () {
      const { fake, api } = yield* fixture;
      // Another launch took the name over while this build cloned, and this build's clone failed.
      fake.hooks.runExit = (args) => {
        if (!args.join(" ").includes("git clone")) return 0;
        const mine = fake.sandboxes.find((each) => !each.deleted);
        assert.ok(mine !== undefined);
        mine.deleted = true;
        fake.sandboxes.push({
          ...mine,
          deleted: false,
          currentSessionId: "sbs_replacement",
          createdAt: mine.createdAt + 1,
          resumedWith: [],
        });
        return 128;
      };

      const failed = yield* Effect.result(built(api));

      assert.equal(failed._tag, "Failure");
      assert.deepEqual(
        fake.sandboxes.filter((each) => !each.deleted).map((each) => each.currentSessionId),
        ["sbs_replacement"],
      );
    }),
);
