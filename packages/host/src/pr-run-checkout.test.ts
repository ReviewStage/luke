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
  PR_RUNS_FOLDER,
  refreshCheckout,
  removeCheckout,
} from "./pr-run-checkout.js";
import { fixtureGit, fixtureGitTool, pullRequestOrigin } from "./testing/pull-request-origin.js";

/**
 * Luke's own checkout of a pull request, over real Git and a repository on
 * disk standing in for GitHub: a first run makes it at the pull request's
 * head, a later one moves it to the newest head and keeps what the last run
 * installed, and anything a refresh would lose (an edit, a commit, a file in
 * the way) is refused and left exactly as it stood.
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

/** An origin with pull request 7 at its first commit, a state root, the checkout's place, and a fetch from the origin. */
const fixture = Effect.gen(function* () {
  const scratch = yield* temporaryDirectoryScoped("luke-pr-checkout-");
  const origin = pullRequestOrigin(path.join(scratch, "origin"));
  const first = origin.commit({ "README.md": "first\n", ".gitignore": "node_modules/\n" });
  origin.pointPullRequest(OWNER.number, first);
  const stateRoot = path.join(scratch, "state");
  const place = checkoutPlace(stateRoot, OWNER);
  assert.ok(place);
  const tool = fixtureGitTool(scratch);
  const fetchInto: FetchInto = (folder) =>
    fetchPullRequestHead(tool, folder, {
      url: origin.folder,
      ref: `refs/pull/${OWNER.number}/head`,
      configArgs: [],
    });
  const refresh = (into: FetchInto = fetchInto) => refreshCheckout(tool, place, into);
  return { scratch, origin, first, stateRoot, place, tool, refresh };
});

const headOf = (place: CheckoutPlace) => fixtureGit(place.folder, ["rev-parse", "HEAD"]);

it.effect(
  "a first run makes the checkout at the pull request's head, under the account, workspace, and repository",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { stateRoot, place, first, refresh } = yield* fixture;

        const outcome = yield* refresh();

        assert.deepEqual(outcome, { ok: first });
        assert.equal(
          place.folder,
          path.join(
            stateRoot,
            PR_RUNS_FOLDER,
            "developer@luke.test",
            "ws_fixture",
            "octocat",
            "relay",
            "pr-7",
          ),
        );
        assert.equal(headOf(place), first);
        assert.equal(readFileSync(path.join(place.folder, "README.md"), "utf8"), "first\n");
        assert.equal(existsSync(`${place.folder}.staging`), false);
      }),
    ).pipe(Effect.provide(machine)),
);

it.effect(
  "a later run moves the checkout to the newest head and keeps what the last run installed",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { origin, place, refresh } = yield* fixture;
        yield* refresh();
        mkdirSync(path.join(place.folder, "node_modules"));
        writeFileSync(path.join(place.folder, "node_modules", "installed.js"), "kept\n");
        const second = origin.commit({ "README.md": "second\n", "src/added.ts": "new\n" });
        origin.pointPullRequest(OWNER.number, second);

        const outcome = yield* refresh();

        assert.deepEqual(outcome, { ok: second });
        assert.equal(headOf(place), second);
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
      assert.equal(headOf(place), first);
    }),
  ).pipe(Effect.provide(machine)),
);

it.effect("a commit made in the checkout is refused and kept", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { origin, place, refresh } = yield* fixture;
      yield* refresh();
      writeFileSync(path.join(place.folder, "local.txt"), "mine\n");
      fixtureGit(place.folder, ["add", "local.txt"]);
      fixtureGit(place.folder, ["commit", "--quiet", "-m", "local"]);
      const local = headOf(place);
      origin.pointPullRequest(OWNER.number, origin.commit({ "README.md": "second\n" }));

      const outcome = yield* refresh();

      assert.deepEqual(outcome, { refused: CHECKOUT_REFUSAL.MOVED });
      assert.equal(headOf(place), local);
    }),
  ).pipe(Effect.provide(machine)),
);

it.effect(
  "a newest commit that adds a file the checkout holds untracked or ignored is refused, and the file kept",
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
        assert.equal(
          readFileSync(path.join(place.folder, "node_modules", "pinned.js"), "utf8"),
          "ignored\n",
        );
        assert.equal(headOf(place), first);
      }),
    ).pipe(Effect.provide(machine)),
);

it.effect(
  "a fetch that fails leaves the checkout where it stood, and a first one leaves nothing behind",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { scratch, first, place, tool, refresh } = yield* fixture;
        const unreachable: FetchInto = (folder) =>
          fetchPullRequestHead(tool, folder, {
            url: path.join(scratch, "no-such-origin"),
            ref: "refs/pull/7/head",
            configArgs: [],
          });

        const firstFailure = yield* refresh(unreachable);
        assert.ok("refused" in firstFailure);
        assert.equal(existsSync(place.folder), false);
        assert.equal(existsSync(`${place.folder}.staging`), false);

        yield* refresh();
        const laterFailure = yield* refresh(unreachable);
        assert.ok("refused" in laterFailure);
        assert.equal(headOf(place), first);
        assert.equal(readFileSync(path.join(place.folder, "README.md"), "utf8"), "first\n");
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
  "a deletion removes the checkout without following a link inside it, and refuses one reached through a link",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { scratch, place, refresh } = yield* fixture;
        yield* refresh();
        const outside = path.join(scratch, "outside");
        mkdirSync(outside);
        writeFileSync(path.join(outside, "precious.txt"), "keep\n");
        symlinkSync(outside, path.join(place.folder, "linked"));

        assert.equal(yield* locateCheckout(place), place.folder);
        assert.equal(yield* removeCheckout(place), true);
        assert.equal(existsSync(place.folder), false);
        assert.equal(readFileSync(path.join(outside, "precious.txt"), "utf8"), "keep\n");

        // A repository folder swapped for a link to somewhere else is no checkout of Luke's to reveal or delete.
        const repositoryFolder = path.dirname(place.folder);
        const elsewhere = path.join(scratch, "elsewhere");
        mkdirSync(path.join(elsewhere, "pr-7"), { recursive: true });
        writeFileSync(path.join(elsewhere, "pr-7", "precious.txt"), "keep\n");
        rmSync(repositoryFolder, { recursive: true, force: true });
        symlinkSync(elsewhere, repositoryFolder);

        assert.equal(yield* locateCheckout(place), undefined);
        assert.equal(yield* removeCheckout(place), false);
        assert.equal(readFileSync(path.join(elsewhere, "pr-7", "precious.txt"), "utf8"), "keep\n");
      }),
    ).pipe(Effect.provide(machine)),
);
