import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { getTestDB, startTask } from "@luke/database/testing";
import { SHOWN_CODE_BOUNDS } from "@luke/features/task-wire";
import { unparsedWire, type WireRecord } from "@luke/wire";
import { Effect, type Layer } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { REPOSITORY_SANDBOX_CONTRACT, type RepositoryCall } from "../agents/repository-shell.js";
import { ACTION_RESULT_STATUS } from "../core.js";
import type { GitHubApp } from "../github/github-app.js";
import {
  connectWorkspaceGitHub,
  githubReaching,
  openGithubUser,
} from "../testing/github-app-fake.js";
import { type CheckoutFiles, sandboxDouble } from "../testing/repository-sandbox.js";
import { runShowCode, SHOW_CODE_REFUSAL } from "./show-code.js";

/**
 * The brain's `show_code`, reading the lines it names from the
 * session's checkout of the task's repository: the window of the file
 * around the lines pointed at is the call's answer, cut to the bounds, and
 * every file that cannot be shown is refused in words that say nothing was
 * shown. The sandbox is a double at eve's boundary, GitHub a script, and the
 * store PGlite. Synthetic repositories and code throughout. Every call
 * carries the model's note on why it shows the lines, which travels with
 * them, and a call without one shows nothing.
 */

const RELAY = { owner: "Acme", name: "Relay", defaultBranch: "trunk" } as const;
const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;
/** The installation connected to the task's workspace, which reaches the repository. */
const INSTALLATION = { id: 7, login: RELAY.owner, repositories: [RELAY] } as const;

const INVITE = [
  'import { db } from "./db.js";',
  "",
  "export async function acceptInvite(token: string) {",
  "  const invite = await db.invites.find(token);",
  "  return invite;",
  "}",
].join("\n");

const NOTE = "acceptInvite finds the invite by its token and never checks that it has expired.";

const LONG_FILE = Array.from({ length: 2_000 }, (_, index) => `line ${index + 1}`).join("\n");

const FILES: CheckoutFiles = {
  "src/invite.ts": INVITE,
  "notes.txt": LONG_FILE,
  ".env": "KEY=sk_live_x",
  "app/.env.local": "KEY=sk_live_y",
  "image.bin": "PNG\u0000\u0001",
  "wide.txt": "x".repeat(SHOWN_CODE_BOUNDS.MAX_LINE_CHARS + 50),
};

/** An account holding one task, on the repository given, in a workspace the installation is connected to, and the sandbox its session opens over the files, its checkout at the commit given. */
const openTask = (repository: string | null, commit?: string) =>
  Effect.gen(function* () {
    const userId = yield* openGithubUser();
    const started = yield* startTask(userId, { name: "Teammate invitations", repository });
    yield* connectWorkspaceGitHub(started.workspaceId, INSTALLATION);
    const sandbox = sandboxDouble(() => undefined, {
      files: FILES,
      ...(commit === undefined ? undefined : { commit }),
    });
    const call: RepositoryCall = {
      task: { userId, taskId: started.id },
      repository,
      sandbox: sandbox.door,
    };
    return { sandbox, call };
  });

/** A call as the model makes it, its input as given, the note included only where the input names one. */
const showExactly = (
  call: RepositoryCall,
  input: WireRecord,
  github: Layer.Layer<GitHubApp | HttpClient.HttpClient> = githubReaching([INSTALLATION]).layer,
) => runShowCode(call, unparsedWire(input)).pipe(Effect.provide(github));

/** A call with the note the model writes beside the lines. */
const show = (call: RepositoryCall, input: WireRecord) =>
  showExactly(call, { note: NOTE, ...input });

it.layer(getTestDB())("show_code reads the plan's checkout", (it) => {
  it.effect(
    "a file that is missing, outside the checkout, binary, or secret is refused as not shown, and no secret is read at all",
    () =>
      Effect.gen(function* () {
        const { call, sandbox } = yield* openTask(RELAY_FULL_NAME);
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
});
