import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer, temporaryDirectory } from "@luke/wire/testing";
import { Duration, Effect, Fiber, Redacted } from "effect";
import { TestClock } from "effect/testing";
import type { TestContext } from "vitest";
import {
  fixtureOidcToken,
  SOURCE_SANDBOX,
  type SourceCheckout,
  type SourceSandbox,
  sourceCheckout,
  sourceSandbox,
} from "../../testing/source-sandbox.js";
import { vercelSandboxApi } from "../vercel-sandbox-api.js";
import { SNAPSHOT, SNAPSHOT_MISS, type SnapshotOutcome, snapshotSource } from "./snapshot.js";

/**
 * The source agent's work copied for an agent started from it, over Vercel
 * Sandbox's REST API answering from a script and the sandbox's shell standing
 * as a real POSIX shell with git, in a checkout and a remote the test made
 * (`testing/source-sandbox.ts`): what it committed, changed, staged, and
 * made, bar what git ignores and files named like credentials, lands as one commit on the branch asked for,
 * and the source's own index and working tree are as they were; a checkout
 * with nothing uncommitted pushes its `HEAD`; a retry pushes over its own
 * branch; a stopped sandbox is woken and stopped again unless it must stay
 * up, and a running one is left running; and a sandbox gone, a failed copy,
 * or one past its bound is a miss, a sandbox it was waking stopped again all
 * the same.
 */

const SESSION = "wrun_fixture";
const BRANCH = "luke/fix-invites-continued-0a1b2c3d";
const MESSAGE = "Snapshot of Fix invites for continued agent";
const TOKEN = Redacted.make("ghs_fixture_installation_token");

/** A checkout of this test's own. */
const checkoutFor = (t: TestContext) =>
  Effect.promise(async () => sourceCheckout(await temporaryDirectory(t, "snapshot-")));

/** What the source's own checkout stands at, which the copy must leave alone. */
function standing({ checkout, sh }: SourceCheckout) {
  return {
    head: sh(checkout, "git", "rev-parse", "HEAD"),
    status: sh(checkout, "git", "status", "--porcelain"),
    index: readFileSync(join(checkout, ".git", "index")).toString("base64"),
  };
}

/** The copy asked of the sandbox over the responder given, the sandbox left up where `keepUp` says so. */
function copyOver(respond: Parameters<typeof fakeHttpClientLayer>[0], keepUp = false) {
  return Effect.flatMap(
    vercelSandboxApi(async () => fixtureOidcToken()),
    (api) =>
      snapshotSource(api, {
        sessionId: SESSION,
        branch: BRANCH,
        message: MESSAGE,
        token: Effect.succeed(TOKEN),
        keepUp: Effect.succeed(keepUp),
      }),
  ).pipe(Effect.provide(fakeHttpClientLayer(respond)));
}

/** A request's body as text. */
async function bodyOf(init: RequestInit): Promise<string> {
  return init.body === undefined ? "" : new Response(init.body).text();
}

/** The copy asked of the double. */
function copy(sandbox: SourceSandbox, keepUp = false) {
  return copyOver(
    async (url, init) =>
      sandbox.answer(url, init.method ?? "GET", await bodyOf(init)) ??
      assert.fail(`no Vercel answer for ${url}`),
    keepUp,
  );
}

/** The pushed branch's commit, as the remote holds it. */
function pushed({ remote, sh }: SourceCheckout): string {
  return sh(remote, "git", "rev-parse", `refs/heads/${BRANCH}`);
}

it.effect(
  "a running source's committed, changed, staged, and new files land as one commit on the branch, what git ignores and files named like credentials left out, its own index and tree untouched and the sandbox left running",
  (t) =>
    Effect.gen(function* () {
      const source = yield* checkoutFor(t);
      const { checkout, remote, sh } = source;
      writeFileSync(join(checkout, "invites.ts"), "export const ttl = 7;\n");
      writeFileSync(join(checkout, "mailer.ts"), "export const from = 'b';\n");
      sh(checkout, "git", "add", "mailer.ts");
      writeFileSync(join(checkout, "expiry.test.ts"), "test('expires');\n");
      mkdirSync(join(checkout, "dist"));
      writeFileSync(join(checkout, "dist", "bundle.js"), "built\n");
      writeFileSync(join(checkout, ".env"), "SECRET=fixture\n");
      mkdirSync(join(checkout, "certs"));
      writeFileSync(join(checkout, "certs", "dev.pem"), "fixture\n");
      const before = standing(source);
      const sandbox = sourceSandbox(source, "running");

      const outcome = yield* copy(sandbox);

      assert.ok(outcome.copied);
      assert.deepEqual(
        { branch: outcome.branch, uncommitted: outcome.uncommitted },
        { branch: BRANCH, uncommitted: true },
      );
      assert.equal(pushed(source), outcome.commit);
      assert.equal(sh(remote, "git", "rev-parse", `${outcome.commit}^`), before.head);
      assert.equal(sh(remote, "git", "log", "-1", "--format=%s", outcome.commit), MESSAGE);
      assert.deepEqual(
        sh(remote, "git", "ls-tree", "-r", "--name-only", outcome.commit).split("\n"),
        [".gitignore", "expiry.test.ts", "invites.ts", "mailer.ts"],
      );
      assert.equal(
        sh(remote, "git", "show", `${outcome.commit}:invites.ts`),
        "export const ttl = 7;",
      );
      assert.equal(
        sh(remote, "git", "show", `${outcome.commit}:mailer.ts`),
        "export const from = 'b';",
      );
      assert.deepEqual(standing(source), before);
      assert.deepEqual(sandbox.policies, [
        { session: SOURCE_SANDBOX.RUNNING, hosts: ["*", "github.com", "api.github.com"] },
      ]);
      assert.deepEqual([sandbox.state.status, sandbox.stops], ["running", []]);
    }),
);

it.effect("a checkout with nothing uncommitted pushes its HEAD as it stands", (t) =>
  Effect.gen(function* () {
    const source = yield* checkoutFor(t);
    writeFileSync(join(source.checkout, "invites.ts"), "export const ttl = 7;\n");
    source.sh(source.checkout, "git", "commit", "--quiet", "-am", "Expire invites");
    const head = source.sh(source.checkout, "git", "rev-parse", "HEAD");

    const outcome = yield* copy(sourceSandbox(source, "running"));

    assert.deepEqual(outcome, { copied: true, branch: BRANCH, commit: head, uncommitted: false });
    assert.equal(pushed(source), head);
  }),
);

it.effect(
  "a retry of the same Start pushes over the branch its first try left, though the work moved on",
  (t) =>
    Effect.gen(function* () {
      const source = yield* checkoutFor(t);
      writeFileSync(join(source.checkout, "invites.ts"), "export const ttl = 7;\n");
      const first = yield* copy(sourceSandbox(source, "running"));
      writeFileSync(join(source.checkout, "invites.ts"), "export const ttl = 14;\n");

      const second = yield* copy(sourceSandbox(source, "running"));

      assert.ok(first.copied && second.copied);
      assert.notEqual(second.commit, first.commit);
      assert.equal(pushed(source), second.commit);
      assert.equal(
        source.sh(source.remote, "git", "show", `${second.commit}:invites.ts`),
        "export const ttl = 14;",
      );
    }),
);

it.effect(
  "a stopped sandbox is woken for the copy, which runs in the woken session, and stopped again",
  (t) =>
    Effect.gen(function* () {
      const source = yield* checkoutFor(t);
      writeFileSync(join(source.checkout, "invites.ts"), "export const ttl = 7;\n");
      const sandbox = sourceSandbox(source, "stopped");

      const outcome = yield* copy(sandbox);

      assert.ok(outcome.copied);
      assert.deepEqual(sandbox.ran, [SOURCE_SANDBOX.WOKEN]);
      assert.deepEqual([sandbox.state.status, sandbox.stops], ["stopped", [SOURCE_SANDBOX.WOKEN]]);
    }),
);

it.effect(
  "a woken sandbox a developer's terminal holds, or a turn of the source took up, is left running",
  (t) =>
    Effect.gen(function* () {
      const sandbox = sourceSandbox(yield* checkoutFor(t), "stopped");

      const outcome = yield* copy(sandbox, true);

      assert.ok(outcome.copied);
      assert.deepEqual([sandbox.state.status, sandbox.stops], ["running", []]);
    }),
);

it.effect("a session that never opened a sandbox copies nothing and wakes nothing", (t) =>
  Effect.gen(function* () {
    const sandbox = sourceSandbox(yield* checkoutFor(t), undefined);

    const outcome = yield* copy(sandbox);

    assert.deepEqual(outcome, { copied: false, miss: SNAPSHOT_MISS.NO_SANDBOX });
    assert.deepEqual([sandbox.ran, sandbox.stops], [[], []]);
  }),
);

it.effect("a copy git refuses is a miss, and the sandbox it woke is stopped again", (t) =>
  Effect.gen(function* () {
    const source = yield* checkoutFor(t);
    source.sh(source.checkout, "git", "remote", "set-url", "origin", join(source.root, "gone.git"));
    const sandbox = sourceSandbox(source, "stopped");

    const outcome = yield* copy(sandbox);

    assert.deepEqual(outcome, { copied: false, miss: SNAPSHOT_MISS.FAILED });
    assert.deepEqual(sandbox.stops, [SOURCE_SANDBOX.WOKEN]);
  }),
);

it.effect(
  "a wake that never answers is given up at the bound, and the sandbox it was waking is stopped again",
  (t) =>
    Effect.gen(function* () {
      const sandbox = sourceSandbox(yield* checkoutFor(t), "stopped");
      let wakeStarted = () => {};
      const woken = new Promise<void>((resolve) => {
        wakeStarted = resolve;
      });
      const fiber = yield* Effect.forkChild(
        copyOver(async (url, init) => {
          if (new URL(url).searchParams.get("resume") !== "true") {
            return (
              sandbox.answer(url, init.method ?? "GET", await bodyOf(init)) ?? assert.fail(url)
            );
          }
          // Vercel began bringing the sandbox up, and never answered the wake.
          sandbox.state.status = "pending";
          sandbox.state.session = SOURCE_SANDBOX.WOKEN;
          wakeStarted();
          return new Promise<Response>((_, reject) => {
            init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          });
        }),
      );
      yield* Effect.promise(() => woken);

      yield* TestClock.adjust(Duration.sum(SNAPSHOT.TIMEOUT, Duration.seconds(1)));
      const outcome: SnapshotOutcome = yield* Fiber.join(fiber);

      assert.deepEqual(outcome, { copied: false, miss: SNAPSHOT_MISS.TIMED_OUT });
      assert.deepEqual([sandbox.ran, sandbox.stops], [[], [SOURCE_SANDBOX.WOKEN]]);
    }),
);
