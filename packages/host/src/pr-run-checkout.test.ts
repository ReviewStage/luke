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
  fetchPullRequestHead,
  locateCheckout,
  markSetUp,
  PR_RUNS_FOLDER,
  refreshCheckout,
  removeCheckout,
} from "./pr-run-checkout.js";
import { fixtureGit, fixtureGitTool, pullRequestOrigin } from "./testing/pull-request-origin.js";

/**
 * Luke's own checkout of a pull request, over real Git and a repository on
 * disk standing in for GitHub: a first run makes the repository's clone and
 * the pull request's worktree, on its head branch with GitHub as `origin`;
 * a later one moves it to the newest head and keeps what setup installed;
 * setup is asked for again only where a lockfile changed; and anything a
 * refresh would lose (an edit, a commit, a file in the way) is refused and
 * left exactly as it stood.
 */

const machine = NodeChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
);

const OWNER = {
  accountEmail: "Developer@Luke.test",
  workspaceId: "ws_fixture",
  repository: "Octocat/Relay",
  number: 7,
} as const;

/** An origin with pull request 7 at its first commit, a state root, the checkout's place, and refreshes fetching from the origin. */
const fixture = Effect.gen(function* () {
  const scratch = yield* temporaryDirectoryScoped("luke-pr-checkout-");
  const origin = pullRequestOrigin(path.join(scratch, "origin"));
  const first = origin.commit({
    "README.md": "first\n",
    ".gitignore": "node_modules/\n",
    "pnpm-lock.yaml": "lock: 1\n",
  });
  origin.pointPullRequest(OWNER.number, first);
  const stateRoot = path.join(scratch, "state");
  const tool = fixtureGitTool(scratch);
  const fetchFrom =
    (url: string, number: number, headRef: string): FetchInto =>
    (clone) =>
      Effect.map(fetchPullRequestHead(tool, clone, number, { url, configArgs: [] }), (step) =>
        "refused" in step ? step : { ok: { sha: step.ok, headRef } },
      );
  const placeOf = (number: number): CheckoutPlace => {
    const place = checkoutPlace(stateRoot, { ...OWNER, number });
    assert.ok(place);
    return place;
  };
  const place = placeOf(OWNER.number);
  const refresh = (into: FetchInto = fetchFrom(origin.folder, OWNER.number, "fix-relay")) =>
    refreshCheckout(tool, place, OWNER.repository, into);
  return { scratch, origin, first, stateRoot, place, placeOf, tool, fetchFrom, refresh };
});

const inWorktree = (place: CheckoutPlace, args: readonly string[]) =>
  fixtureGit(place.folder, args);

it.effect(
  "a first run makes the repository's clone and the pull request's worktree on its head branch, with GitHub as origin",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { stateRoot, place, first, refresh } = yield* fixture;

        const outcome = yield* refresh();

        assert.deepEqual(outcome, { ok: { sha: first, setupNeeded: true } });
        const repositoryFolder = path.join(
          stateRoot,
          PR_RUNS_FOLDER,
          "developer@luke.test",
          "ws_fixture",
          "octocat",
          "relay",
        );
        assert.equal(place.folder, path.join(repositoryFolder, "pr-7"));
        assert.equal(place.clone, path.join(repositoryFolder, "repository.git"));
        assert.equal(inWorktree(place, ["rev-parse", "HEAD"]), first);
        assert.equal(inWorktree(place, ["symbolic-ref", "--short", "HEAD"]), "fix-relay");
        assert.equal(
          inWorktree(place, ["remote", "get-url", "origin"]),
          "https://github.com/Octocat/Relay.git",
        );
        assert.equal(inWorktree(place, ["config", "branch.fix-relay.merge"]), "refs/pull/7/head");
        assert.equal(readFileSync(path.join(place.folder, "README.md"), "utf8"), "first\n");
      }),
    ).pipe(Effect.provide(machine)),
);

it.effect(
  "a later run moves the worktree to the newest head, keeps what setup installed, and asks for setup again only when a lockfile changed",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { origin, place, tool, refresh } = yield* fixture;
        const made = yield* refresh();
        assert.ok("ok" in made);
        yield* markSetUp(tool, place, made.ok.sha);
        mkdirSync(path.join(place.folder, "node_modules"));
        writeFileSync(path.join(place.folder, "node_modules", "installed.js"), "kept\n");

        const second = origin.commit({ "README.md": "second\n", "src/added.ts": "new\n" });
        origin.pointPullRequest(OWNER.number, second);
        const unchangedLock = yield* refresh();
        const third = origin.commit({ "pnpm-lock.yaml": "lock: 2\n" });
        origin.pointPullRequest(OWNER.number, third);
        const changedLock = yield* refresh();

        assert.deepEqual(unchangedLock, { ok: { sha: second, setupNeeded: false } });
        assert.deepEqual(changedLock, { ok: { sha: third, setupNeeded: true } });
        assert.equal(inWorktree(place, ["rev-parse", "HEAD"]), third);
        assert.equal(inWorktree(place, ["symbolic-ref", "--short", "HEAD"]), "fix-relay");
        assert.equal(readFileSync(path.join(place.folder, "README.md"), "utf8"), "second\n");
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
      const { origin, first, place, refresh } = yield* fixture;
      yield* refresh();
      writeFileSync(path.join(place.folder, "README.md"), "my edit\n");
      origin.pointPullRequest(OWNER.number, origin.commit({ "README.md": "second\n" }));

      const outcome = yield* refresh();

      assert.deepEqual(outcome, { refused: CHECKOUT_REFUSAL.EDITED });
      assert.equal(readFileSync(path.join(place.folder, "README.md"), "utf8"), "my edit\n");
      assert.equal(inWorktree(place, ["rev-parse", "HEAD"]), first);
    }),
  ).pipe(Effect.provide(machine)),
);

it.effect("a commit made in the worktree is refused and kept", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { origin, place, refresh } = yield* fixture;
      yield* refresh();
      writeFileSync(path.join(place.folder, "local.txt"), "mine\n");
      inWorktree(place, ["add", "local.txt"]);
      inWorktree(place, ["commit", "--quiet", "-m", "local"]);
      const local = inWorktree(place, ["rev-parse", "HEAD"]);
      origin.pointPullRequest(OWNER.number, origin.commit({ "README.md": "second\n" }));

      const outcome = yield* refresh();

      assert.deepEqual(outcome, { refused: CHECKOUT_REFUSAL.MOVED });
      assert.equal(inWorktree(place, ["rev-parse", "HEAD"]), local);
    }),
  ).pipe(Effect.provide(machine)),
);

it.effect(
  "a newest commit that adds a file the worktree holds untracked or ignored is refused, and the file kept",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { origin, first, place, refresh } = yield* fixture;
        yield* refresh();
        writeFileSync(path.join(place.folder, "notes.md"), "untracked\n");
        mkdirSync(path.join(place.folder, "node_modules"));
        writeFileSync(path.join(place.folder, "node_modules", "pinned.js"), "ignored\n");
        origin.pointPullRequest(
          OWNER.number,
          origin.commit({ "notes.md": "theirs\n", "node_modules/pinned.js": "theirs\n" }),
        );

        const outcome = yield* refresh();

        assert.ok("refused" in outcome);
        assert.match(outcome.refused, /notes\.md/u);
        assert.match(outcome.refused, /node_modules\/pinned\.js/u);
        assert.equal(readFileSync(path.join(place.folder, "notes.md"), "utf8"), "untracked\n");
        assert.equal(inWorktree(place, ["rev-parse", "HEAD"]), first);
      }),
    ).pipe(Effect.provide(machine)),
);

it.effect("a fetch that fails leaves the worktree where it stood, and a first one makes none", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { scratch, first, place, fetchFrom, refresh } = yield* fixture;
      const unreachable = fetchFrom(
        path.join(scratch, "no-such-origin"),
        OWNER.number,
        "fix-relay",
      );

      const firstFailure = yield* refresh(unreachable);
      assert.ok("refused" in firstFailure);
      assert.equal(existsSync(place.folder), false);

      yield* refresh();
      const laterFailure = yield* refresh(unreachable);
      assert.ok("refused" in laterFailure);
      assert.equal(inWorktree(place, ["rev-parse", "HEAD"]), first);
    }),
  ).pipe(Effect.provide(machine)),
);

it.effect(
  "two pull requests of one repository share its clone, and a head branch already held takes the pull request's number",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { origin, first, place, placeOf, tool, fetchFrom, refresh } = yield* fixture;
        const other = origin.commit({ "OTHER.md": "eight\n" });
        origin.pointPullRequest(8, other);
        const eight = placeOf(8);

        yield* refresh();
        const outcome = yield* refreshCheckout(
          tool,
          eight,
          OWNER.repository,
          fetchFrom(origin.folder, 8, "fix-relay"),
        );

        assert.deepEqual(outcome, { ok: { sha: other, setupNeeded: true } });
        assert.equal(eight.clone, place.clone);
        assert.equal(inWorktree(eight, ["symbolic-ref", "--short", "HEAD"]), "pr-8");
        assert.equal(inWorktree(place, ["rev-parse", "HEAD"]), first);
      }),
    ).pipe(Effect.provide(machine)),
);

it.effect("a folder Luke did not make is refused rather than adopted", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { place, refresh } = yield* fixture;
      mkdirSync(place.folder, { recursive: true });
      writeFileSync(path.join(place.folder, "theirs.txt"), "not Luke's\n");

      const outcome = yield* refresh();

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
      { ...OWNER, number: 0 },
      { ...OWNER, number: 1.5 },
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
        const { scratch, first, place, tool, refresh } = yield* fixture;
        yield* refresh();
        const outside = path.join(scratch, "outside");
        mkdirSync(outside);
        writeFileSync(path.join(outside, "precious.txt"), "keep\n");
        symlinkSync(outside, path.join(place.folder, "linked"));

        assert.equal(yield* locateCheckout(place), place.folder);
        assert.equal(yield* removeCheckout(tool, place), true);
        assert.equal(existsSync(place.folder), false);
        assert.equal(readFileSync(path.join(outside, "precious.txt"), "utf8"), "keep\n");
        assert.deepEqual(yield* refresh(), { ok: { sha: first, setupNeeded: true } });

        // A repository folder swapped for a link to somewhere else is no checkout of Luke's to reveal or delete.
        const repositoryFolder = path.dirname(place.folder);
        const elsewhere = path.join(scratch, "elsewhere");
        mkdirSync(path.join(elsewhere, "pr-7"), { recursive: true });
        writeFileSync(path.join(elsewhere, "pr-7", "precious.txt"), "keep\n");
        rmSync(repositoryFolder, { recursive: true, force: true });
        symlinkSync(elsewhere, repositoryFolder);

        assert.equal(yield* locateCheckout(place), undefined);
        assert.equal(yield* removeCheckout(tool, place), false);
        assert.equal(readFileSync(path.join(elsewhere, "pr-7", "precious.txt"), "utf8"), "keep\n");
      }),
    ).pipe(Effect.provide(machine)),
);
