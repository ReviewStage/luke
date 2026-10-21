import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { SHOWN_CODE_BOUNDS } from "@luke/features/task-wire";
import { unparsedWire, type WireRecord } from "@luke/wire";
import { Effect } from "effect";
import { REPOSITORY_SANDBOX_CONTRACT } from "../agents/repository-sandbox-contract.js";
import { ACTION_RESULT_STATUS } from "../core.js";
import { type CheckoutFiles, sandboxDouble } from "../testing/repository-sandbox.js";
import { SHOW_CODE_REFUSAL, showCodeIn } from "./show-code.js";

/**
 * `show_code`, reading the lines it names from an agent's checkout of the
 * task's repository: every file that cannot be shown is refused in words
 * that say nothing was shown, and no secret file is read at all. The sandbox
 * is a double at eve's boundary. Synthetic repositories and code throughout.
 * Every call carries the model's note on why it shows the lines, which
 * travels with them, and a call without one shows nothing.
 */

const RELAY_FULL_NAME = "Acme/Relay";

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

it.effect(
  "a file that is missing, outside the checkout, binary, or secret is refused as not shown, and no secret is read at all",
  () =>
    Effect.gen(function* () {
      const sandbox = sandboxDouble(() => undefined, { files: FILES });
      const checkout = Effect.succeed({ sandbox, repository: RELAY_FULL_NAME });
      const refused = (input: WireRecord) =>
        Effect.map(showCodeIn(checkout, unparsedWire({ note: NOTE, ...input })), (answer) => {
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
      const read = sandbox.runs.map((run) => run.env?.[REPOSITORY_SANDBOX_CONTRACT.VARIABLE.FILE]);
      assert.equal(
        read.some((path) => path?.includes(".env")),
        false,
      );
    }),
);
