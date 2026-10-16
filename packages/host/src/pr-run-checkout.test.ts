import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
import { Effect, Layer } from "effect";
import {
  CHECKOUT_REFUSAL,
  type CheckoutPlace,
  checkoutPlace,
  type FetchInto,
  locateCheckout,
  markSetUp,
  PR_RUNS_FOLDER,
  refreshCheckout,
  removeCheckout,
  snapshotCommit,
} from "./pr-run-checkout.js";
import { fixtureGit, fixtureGitTool, pullRequestOrigin } from "./testing/pull-request-origin.js";

/**
 * Luke's own checkout of a coding agent's work, over real Git and a
 * repository on disk standing in for GitHub: the agent's work arrives as its
 * starting commit and a patch of everything since, made a commit in the
 * repository's clone and checked out in the agent's worktree on the agent's
 * branch with GitHub as `origin`; a later snapshot moves the worktree and
 * keeps what setup installed; setup is asked for again only where a
 * lockfile or the setup command changed; and anything a refresh would lose
 * (an edit, a commit, a file in the way) is refused and left exactly as it
 * stood.
 */

const machine = NodeChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
);

const SETUP = "pnpm install";
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const OTHER_AGENT = "9d2b7b5f-4e3f-4e9c-9c77-7f5d8b3f4c32";

const OWNER = {
  accountEmail: "Developer@Luke.test",
  workspaceId: "ws_fixture",
  repository: "Octocat/Relay",
  agentId: AGENT,
} as const;

/**
 * An origin whose `main` holds the agent's starting commit and whose `work`
 * branch holds the agent's work, a state root, the checkout's place, and
 * refreshes taking the work as a snapshot of `work` over the base.
 */
const fixture = Effect.gen(function* () {
  const scratch = yield* temporaryDirectoryScoped("luke-run-checkout-");
  const origin = pullRequestOrigin(path.join(scratch, "origin"));
  const base = origin.commit({
    "README.md": "base\n",
    ".gitignore": "node_modules/\n",
    "pnpm-lock.yaml": "lock: 1\n",
  });
  origin.branch("work");
  const first = origin.commit({ "README.md": "first\n" });
  const stateRoot = path.join(scratch, "state");
  const tool = fixtureGitTool(scratch);
  /** A snapshot of the agent's work as it stands at `to`, over the base, on the agent's branch. */
  const snapshotOf =
    (to: string, agentId = AGENT, url = origin.folder): FetchInto =>
    (clone) =>
      Effect.map(
        snapshotCommit(tool, clone, agentId, {
          url,
          configArgs: [],
          base,
          patch: origin.diff(base, to),
        }),
        (step) =>
          "refused" in step
            ? step
            : { ok: { sha: step.ok, headRef: "luke/fix-relay", ownBranch: true } },
      );
  const placeOf = (agentId: string): CheckoutPlace => {
    const place = checkoutPlace(stateRoot, { ...OWNER, agentId });
    assert.ok(place);
    return place;
  };
  const place = placeOf(AGENT);
  const refresh = (into: FetchInto, setup: string | null = SETUP) =>
    refreshCheckout(tool, place, OWNER.repository, into, setup);
  return { scratch, origin, base, first, stateRoot, place, placeOf, tool, snapshotOf, refresh };
});

const inWorktree = (place: CheckoutPlace, args: readonly string[]) =>
  fixtureGit(place.folder, args);
const treeOf = (folder: string, commit: string) =>
  fixtureGit(folder, ["rev-parse", `${commit}^{tree}`]);

it.effect(
  "a first run makes the repository's clone and the agent's worktree on its branch, with GitHub as origin and the agent's work checked out",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { stateRoot, origin, base, first, place, snapshotOf, refresh } = yield* fixture;

        const outcome = yield* refresh(snapshotOf(first));

        assert.ok("ok" in outcome);
        assert.equal(outcome.ok.setupNeeded, true);
        const repositoryFolder = path.join(
          stateRoot,
          PR_RUNS_FOLDER,
          "developer@luke.test",
          "ws_fixture",
          "octocat",
          "relay",
        );
        assert.equal(place.folder, path.join(repositoryFolder, `agent-${AGENT}`));
        assert.equal(place.clone, path.join(repositoryFolder, "repository.git"));
        assert.equal(inWorktree(place, ["rev-parse", "HEAD"]), outcome.ok.sha);
        assert.equal(inWorktree(place, ["rev-parse", "HEAD^"]), base);
        assert.equal(treeOf(place.folder, "HEAD"), treeOf(origin.folder, first));
        assert.equal(inWorktree(place, ["symbolic-ref", "--short", "HEAD"]), "luke/fix-relay");
        assert.equal(
          inWorktree(place, ["remote", "get-url", "origin"]),
          "https://github.com/Octocat/Relay.git",
        );
        assert.equal(
          inWorktree(place, ["config", "branch.luke/fix-relay.merge"]),
          "refs/heads/luke/fix-relay",
        );
        assert.equal(readFileSync(path.join(place.folder, "README.md"), "utf8"), "first\n");
      }),
    ).pipe(Effect.provide(machine)),
);

it.effect(
  "a later snapshot moves the worktree, keeps what setup installed, and asks for setup again only when a lockfile or the setup command changed",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { origin, first, place, tool, snapshotOf, refresh } = yield* fixture;
        const made = yield* refresh(snapshotOf(first));
        assert.ok("ok" in made);
        yield* markSetUp(tool, place, made.ok.sha, SETUP);
        mkdirSync(path.join(place.folder, "node_modules"));
        writeFileSync(path.join(place.folder, "node_modules", "installed.js"), "kept\n");

        const same = yield* refresh(snapshotOf(first));
        const second = origin.commit({ "README.md": "second\n", "src/added.ts": "new\n" });
        const unchangedLock = yield* refresh(snapshotOf(second));
        const otherSetup = yield* refresh(snapshotOf(second), "npm ci");
        const noSetup = yield* refresh(snapshotOf(second), null);
        const third = origin.commit({ "pnpm-lock.yaml": "lock: 2\n" });
        const changedLock = yield* refresh(snapshotOf(third));

        assert.deepEqual(same, { ok: { sha: made.ok.sha, setupNeeded: false } });
        assert.ok(
          "ok" in unchangedLock && "ok" in otherSetup && "ok" in noSetup && "ok" in changedLock,
        );
        assert.equal(unchangedLock.ok.setupNeeded, false);
        assert.equal(otherSetup.ok.setupNeeded, true);
        assert.equal(noSetup.ok.setupNeeded, false);
        assert.equal(changedLock.ok.setupNeeded, true);
        assert.equal(treeOf(place.folder, "HEAD"), treeOf(origin.folder, third));
        assert.equal(inWorktree(place, ["symbolic-ref", "--short", "HEAD"]), "luke/fix-relay");
        assert.equal(
          readFileSync(path.join(place.folder, "node_modules", "installed.js"), "utf8"),
          "kept\n",
        );
      }),
    ).pipe(Effect.provide(machine)),
);

it.effect("an edit to a tracked file is refused and left as it stands", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { origin, first, place, snapshotOf, refresh } = yield* fixture;
      const made = yield* refresh(snapshotOf(first));
      writeFileSync(path.join(place.folder, "README.md"), "my edit\n");

      const outcome = yield* refresh(snapshotOf(origin.commit({ "README.md": "second\n" })));

      assert.deepEqual(outcome, { refused: CHECKOUT_REFUSAL.EDITED });
      assert.equal(readFileSync(path.join(place.folder, "README.md"), "utf8"), "my edit\n");
      assert.ok("ok" in made);
      assert.equal(inWorktree(place, ["rev-parse", "HEAD"]), made.ok.sha);
    }),
  ).pipe(Effect.provide(machine)),
);

it.effect("a commit made in the worktree is refused and kept", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { origin, first, place, snapshotOf, refresh } = yield* fixture;
      yield* refresh(snapshotOf(first));
      writeFileSync(path.join(place.folder, "local.txt"), "mine\n");
      inWorktree(place, ["add", "local.txt"]);
      inWorktree(place, ["commit", "--quiet", "-m", "local"]);
      const local = inWorktree(place, ["rev-parse", "HEAD"]);

      const outcome = yield* refresh(snapshotOf(origin.commit({ "README.md": "second\n" })));

      assert.deepEqual(outcome, { refused: CHECKOUT_REFUSAL.MOVED });
      assert.equal(inWorktree(place, ["rev-parse", "HEAD"]), local);
    }),
  ).pipe(Effect.provide(machine)),
);

it.effect(
  "a snapshot that adds a file the worktree holds untracked or ignored is refused, and the file kept",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { origin, first, place, snapshotOf, refresh } = yield* fixture;
        const made = yield* refresh(snapshotOf(first));
        writeFileSync(path.join(place.folder, "notes.md"), "untracked\n");
        mkdirSync(path.join(place.folder, "node_modules"));
        writeFileSync(path.join(place.folder, "node_modules", "pinned.js"), "ignored\n");
        const next = origin.commit({
          "notes.md": "theirs\n",
          "node_modules/pinned.js": "theirs\n",
        });

        const outcome = yield* refresh(snapshotOf(next));

        assert.ok("refused" in outcome);
        assert.match(outcome.refused, /notes\.md/u);
        assert.match(outcome.refused, /node_modules\/pinned\.js/u);
        assert.equal(readFileSync(path.join(place.folder, "notes.md"), "utf8"), "untracked\n");
        assert.ok("ok" in made);
        assert.equal(inWorktree(place, ["rev-parse", "HEAD"]), made.ok.sha);
      }),
    ).pipe(Effect.provide(machine)),
);

it.effect(
  "a base that cannot be fetched makes no worktree, and work that does not apply leaves the worktree where it stood",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { scratch, base, first, place, tool, snapshotOf, refresh } = yield* fixture;
        const unreachable = snapshotOf(first, AGENT, path.join(scratch, "no-such-origin"));
        const garbled: FetchInto = (clone) =>
          snapshotCommit(tool, clone, AGENT, {
            url: path.join(scratch, "origin"),
            configArgs: [],
            base,
            patch: Buffer.from(
              "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-not there\n+x\n",
            ),
          }).pipe(
            Effect.map((step) =>
              "refused" in step ? step : { ok: { sha: step.ok, headRef: "x", ownBranch: false } },
            ),
          );

        const firstFailure = yield* refresh(unreachable);
        assert.ok("refused" in firstFailure);
        assert.equal(existsSync(place.folder), false);

        const made = yield* refresh(snapshotOf(first));
        const laterFailure = yield* refresh(garbled);
        assert.ok("refused" in laterFailure);
        assert.ok("ok" in made);
        assert.equal(inWorktree(place, ["rev-parse", "HEAD"]), made.ok.sha);
      }),
    ).pipe(Effect.provide(machine)),
);

it.effect(
  "two agents of one repository share its clone, and a branch the clone already holds is never moved",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { origin, first, place, placeOf, tool, snapshotOf, refresh } = yield* fixture;
        yield* refresh(snapshotOf(first));
        const held = inWorktree(place, ["rev-parse", "luke/fix-relay"]);
        const other = placeOf(OTHER_AGENT);
        const theirs = origin.commit({ "OTHER.md": "theirs\n" });

        const outcome = yield* refreshCheckout(
          tool,
          other,
          OWNER.repository,
          snapshotOf(theirs, OTHER_AGENT),
          SETUP,
        );

        assert.ok("ok" in outcome);
        assert.equal(other.clone, place.clone);
        assert.equal(inWorktree(other, ["symbolic-ref", "--short", "HEAD"]), "agent-9d2b7b5f");
        assert.equal(inWorktree(place, ["rev-parse", "luke/fix-relay"]), held);
      }),
    ).pipe(Effect.provide(machine)),
);

it.effect("an agent that changed nothing runs its starting commit as it stands", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { origin, base, place, snapshotOf, refresh } = yield* fixture;

      const outcome = yield* refresh(snapshotOf(base));

      assert.ok("ok" in outcome);
      assert.equal(treeOf(place.folder, "HEAD"), treeOf(origin.folder, base));
    }),
  ).pipe(Effect.provide(machine)),
);

it.effect("a folder Luke did not make is refused rather than adopted", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { first, place, snapshotOf, refresh } = yield* fixture;
      mkdirSync(place.folder, { recursive: true });
      writeFileSync(path.join(place.folder, "theirs.txt"), "not Luke's\n");

      const outcome = yield* refresh(snapshotOf(first));

      assert.deepEqual(outcome, { refused: CHECKOUT_REFUSAL.NOT_LUKES });
      assert.equal(readFileSync(path.join(place.folder, "theirs.txt"), "utf8"), "not Luke's\n");
    }),
  ).pipe(Effect.provide(machine)),
);

it.effect("a segment that could climb out of the checkout's folder names no place", () =>
  Effect.sync(() => {
    for (const owner of [
      { ...OWNER, accountEmail: ".." },
      { ...OWNER, accountEmail: "a/b@luke.test" },
      { ...OWNER, workspaceId: "../elsewhere" },
      { ...OWNER, workspaceId: "" },
      { ...OWNER, repository: "octocat/.." },
      { ...OWNER, repository: "octocat/relay/extra" },
      { ...OWNER, repository: "../relay" },
      { ...OWNER, agentId: "../8c1a6a4f" },
      { ...OWNER, agentId: "" },
    ]) {
      assert.equal(checkoutPlace("/state", owner), undefined, JSON.stringify(owner));
    }
  }),
);

it.effect(
  "a deletion removes the worktree without following a link inside it, refuses one reached through a link, and the next run makes it afresh",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { scratch, first, place, tool, snapshotOf, refresh } = yield* fixture;
        yield* refresh(snapshotOf(first));
        const outside = path.join(scratch, "outside");
        mkdirSync(outside);
        writeFileSync(path.join(outside, "precious.txt"), "keep\n");
        symlinkSync(outside, path.join(place.folder, "linked"));

        assert.equal(yield* locateCheckout(place), place.folder);
        assert.equal(yield* removeCheckout(tool, place), true);
        assert.equal(existsSync(place.folder), false);
        assert.equal(readFileSync(path.join(outside, "precious.txt"), "utf8"), "keep\n");
        const again = yield* refresh(snapshotOf(first));
        assert.ok("ok" in again && again.ok.setupNeeded);

        // A repository folder swapped for a link to somewhere else is no checkout of Luke's to reveal or delete.
        const repositoryFolder = path.dirname(place.folder);
        const elsewhere = path.join(scratch, "elsewhere");
        mkdirSync(path.join(elsewhere, `agent-${AGENT}`), { recursive: true });
        writeFileSync(path.join(elsewhere, `agent-${AGENT}`, "precious.txt"), "keep\n");
        rmSync(repositoryFolder, { recursive: true, force: true });
        symlinkSync(elsewhere, repositoryFolder);

        assert.equal(yield* locateCheckout(place), undefined);
        assert.equal(yield* removeCheckout(tool, place), false);
        assert.equal(
          readFileSync(path.join(elsewhere, `agent-${AGENT}`, "precious.txt"), "utf8"),
          "keep\n",
        );
      }),
    ).pipe(Effect.provide(machine)),
);
