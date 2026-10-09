import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { SHOWN_CODE_BOUNDS } from "@sidecar/hosted/plan-wire";
import { isRecord, unparsedWire, type WireRecord } from "@sidecar/wire";
import { Effect, type Layer } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import { ACTION_RESULT_STATUS } from "../server/core";
import type { GitHubApp } from "../server/github/github-app";
import { createPlan } from "../server/hosted/plan-store";
import {
  REPOSITORY_REFUSAL,
  REPOSITORY_SANDBOX_CONTRACT,
  type RepositoryCall,
} from "../server/hosted/repository-shell";
import { runShowCode, SHOW_CODE_REFUSAL } from "../server/hosted/show-code";
import { githubReaching, openGithubUser } from "./support/github-app-fake";
import { type CheckoutFiles, sandboxDouble } from "./support/repository-sandbox";
import { testSqlClient } from "./support/sql-client";

/**
 * The planning model's `show_code`, reading the lines it names from the
 * session's checkout of the plan's repository: the window of the file
 * around the lines pointed at is the call's answer, cut to the bounds, and
 * every file that cannot be shown is refused in words that say nothing was
 * shown. The sandbox is a double at eve's boundary, GitHub a script, and the
 * store PGlite. Synthetic repositories and code throughout.
 */

const RELAY = { owner: "Acme", name: "Relay", defaultBranch: "trunk" } as const;
const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;
const INSTALLATION = { id: 7, login: RELAY.owner, repositories: [RELAY] } as const;

const INVITE = [
  'import { db } from "./db.js";',
  "",
  "export async function acceptInvite(token: string) {",
  "  const invite = await db.invites.find(token);",
  "  return invite;",
  "}",
].join("\n");

const LONG_FILE = Array.from({ length: 2_000 }, (_, index) => `line ${index + 1}`).join("\n");

const FILES: CheckoutFiles = {
  "src/invite.ts": INVITE,
  "notes.txt": LONG_FILE,
  ".env": "KEY=sk_live_x",
  "app/.env.local": "KEY=sk_live_y",
  "image.bin": "PNG\u0000\u0001",
  "wide.txt": "x".repeat(SHOWN_CODE_BOUNDS.MAX_LINE_CHARS + 50),
};

/** An account holding one plan, on the repository given, and the sandbox its session opens over the files. */
const openPlan = (repository: string | null) =>
  Effect.gen(function* () {
    const userId = yield* openGithubUser();
    const started = yield* createPlan(userId, { name: "Teammate invitations", repository });
    const sandbox = sandboxDouble(() => undefined, { files: FILES });
    const call: RepositoryCall = {
      plan: { userId, planId: started.id },
      repository,
      sandbox: sandbox.door,
    };
    return { sandbox, call };
  });

const show = (
  call: RepositoryCall,
  input: WireRecord,
  github: Layer.Layer<GitHubApp | HttpClient.HttpClient> = githubReaching([INSTALLATION]).layer,
) => runShowCode(call, unparsedWire(input)).pipe(Effect.provide(github));

/** The lines an accepted answer carries. */
function linesOf(answer: WireRecord): readonly string[] {
  assert.equal(answer.status, ACTION_RESULT_STATUS.ACCEPTED);
  const code = answer.code;
  assert.ok(isRecord(code));
  const lines = code.lines;
  assert.ok(Array.isArray(lines));
  return lines.map((line) => String(line));
}

it.layer(testSqlClient)("show_code reads the plan's checkout", (it) => {
  it.effect(
    "a file of the repository is answered whole with its place, and the first call makes the checkout",
    () =>
      Effect.gen(function* () {
        const { call, sandbox } = yield* openPlan(RELAY_FULL_NAME);

        const answer = yield* show(call, { path: "src/invite.ts", startLine: 3, endLine: 4 });

        assert.deepEqual(answer, {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          code: {
            ref: { path: "src/invite.ts", startLine: 3, endLine: 4 },
            repository: RELAY_FULL_NAME,
            firstLine: 1,
            lineCount: 6,
            lines: INVITE.split("\n"),
          },
        });
        assert.equal(sandbox.clones.length, 1);
        // The path reaches the scripts as a variable and never as shell text.
        const reads = sandbox.runs.filter(
          (run) => run.env?.[REPOSITORY_SANDBOX_CONTRACT.VARIABLE.FILE] !== undefined,
        );
        assert.equal(reads.length, 2);
        for (const read of reads) assert.equal(read.command.includes("invite"), false);
      }),
  );

  it.effect(
    "a long file is answered as a window around the lines pointed at, each line cut to the bound",
    () =>
      Effect.gen(function* () {
        const { call } = yield* openPlan(RELAY_FULL_NAME);

        const answer = yield* show(call, { path: "notes.txt", startLine: 1_000, endLine: 1_001 });
        const wide = yield* show(call, { path: "wide.txt" });

        assert.equal(answer.status, ACTION_RESULT_STATUS.ACCEPTED);
        const code = answer.code;
        assert.ok(isRecord(code));
        const lines = linesOf(answer);
        assert.equal(lines.length, SHOWN_CODE_BOUNDS.WINDOW_LINES);
        assert.equal(code.lineCount, 2_000);
        const first = Number(code.firstLine);
        assert.equal(lines[0], `line ${first}`);
        assert.ok(first < 1_000 && first + SHOWN_CODE_BOUNDS.WINDOW_LINES - 1 > 1_001);
        assert.equal(linesOf(wide)[0]?.length, SHOWN_CODE_BOUNDS.MAX_LINE_CHARS);
      }),
  );

  it.effect(
    "a file that is missing, outside the checkout, binary, or secret is refused as not shown, and no secret is read at all",
    () =>
      Effect.gen(function* () {
        const { call, sandbox } = yield* openPlan(RELAY_FULL_NAME);
        const refused = (input: WireRecord) =>
          Effect.map(show(call, input), (answer) => {
            assert.equal(answer.status, ACTION_RESULT_STATUS.REJECTED);
            return answer.reason;
          });

        assert.equal(yield* refused({ path: "gone.ts" }), SHOW_CODE_REFUSAL.MISSING);
        assert.equal(yield* refused({ path: "../etc/passwd" }), SHOW_CODE_REFUSAL.MISSING);
        assert.equal(yield* refused({ path: "image.bin" }), SHOW_CODE_REFUSAL.NOT_TEXT);
        assert.equal(yield* refused({ path: ".env" }), SHOW_CODE_REFUSAL.SECRET);
        assert.equal(yield* refused({ path: "app/.env.local" }), SHOW_CODE_REFUSAL.SECRET);
        assert.equal(
          yield* refused({ path: "src/invite.ts", startLine: 9, endLine: 2 }),
          SHOW_CODE_REFUSAL.UNREADABLE,
        );
        const read = sandbox.runs.map(
          (run) => run.env?.[REPOSITORY_SANDBOX_CONTRACT.VARIABLE.FILE],
        );
        assert.equal(
          read.some((path) => path?.includes(".env")),
          false,
        );
      }),
  );

  it.effect("a plan with no repository shows nothing, and says so without opening a sandbox", () =>
    Effect.gen(function* () {
      const { call, sandbox } = yield* openPlan(null);

      const answer = yield* show(call, { path: "src/invite.ts" });

      assert.deepEqual(answer, {
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: `Not shown: ${REPOSITORY_REFUSAL.NO_REPOSITORY}`,
      });
      assert.equal(sandbox.openings, 0);
    }),
  );
});
