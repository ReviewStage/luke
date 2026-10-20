import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  MAC_COMMAND_IMAGE_TYPE,
  MAC_COMMAND_KIND,
  type MacBrowserResult,
  type MacCommand,
  type MacCommandResult,
} from "@luke/features/mac-command-wire";
import { eq, sql } from "drizzle-orm";
import { Clock, Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { macCommand } from "../../schemas/mac-command.js";
import { getTestDB } from "../../testing/index.js";
import {
  claimMacCommands,
  macCommandResult,
  macCommandsWaiting,
  macListeningSince,
  markMacListening,
  queueMacCommand,
  settleMacBrowserResult,
  settleMacCommand,
  withdrawMacCommand,
} from "../mac-command-store.js";

/**
 * The commands an account's agents queue for its Mac, over a real dialect:
 * a command is claimed once and settled once, by its own account alone, a
 * row its call has stopped waiting for is never claimed, a read claims and
 * waits on only the kinds it names, a row queued before kinds were reads
 * as a shell command, a Mac counts as listening for a kind only from
 * its last read naming it on, and a browser command's image is read back
 * with its result and leaves with the row.
 *
 * Synthetic accounts and commands throughout.
 */

/** The instant the clock reads now, which every command these tests queue is at or after. */
const now = Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis));

const RESULT: MacCommandResult = {
  exitCode: 0,
  stdout: "main\n",
  stderr: "",
  truncated: false,
  timedOut: false,
};

const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  }
  return { owner, other };
});

const command = (timeoutSeconds = 60): MacCommand => ({
  id: randomUUID(),
  kind: MAC_COMMAND_KIND.SHELL,
  command: "git branch --show-current",
  timeoutSeconds,
});

const browserCommand = (): MacCommand => ({
  id: randomUUID(),
  kind: MAC_COMMAND_KIND.BROWSER,
  params: { act: "open", address: "http://localhost:3000" },
  timeoutSeconds: 30,
});

/** A browser command's result with a screenshot: a PNG's signature and a few bytes past it, in base64. */
const BROWSER_RESULT: MacBrowserResult = {
  output: { address: "http://localhost:3000/", title: "Preview" },
  image: {
    mediaType: MAC_COMMAND_IMAGE_TYPE.PNG,
    data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString("base64"),
  },
};

/** What an older Mac's read names: shell alone. */
const SHELL_ONLY = [MAC_COMMAND_KIND.SHELL];

const SHELL_AND_BROWSER = [MAC_COMMAND_KIND.SHELL, MAC_COMMAND_KIND.BROWSER];

it.layer(getTestDB())("the Mac command store", (it) => {
  it.effect(
    "a command is claimed and settled once, by its own account, and its result read by that account alone",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const since = yield* now;
        const queued = command();
        yield* queueMacCommand(owner, queued);

        const claimedByOther = yield* claimMacCommands(other, since, SHELL_ONLY);
        const settledByOther = yield* settleMacCommand(other, queued.id, RESULT);
        const settledUnclaimed = yield* settleMacCommand(owner, queued.id, RESULT);
        const claimed = yield* claimMacCommands(owner, since, SHELL_ONLY);
        const claimedAgain = yield* claimMacCommands(owner, since, SHELL_ONLY);
        const settled = yield* settleMacCommand(owner, queued.id, RESULT);
        const settledAgain = yield* settleMacCommand(owner, queued.id, { ...RESULT, exitCode: 1 });

        assert.deepEqual(claimedByOther, []);
        assert.equal(settledByOther, false, "another account settles nothing");
        assert.equal(settledUnclaimed, false, "nothing is settled before a Mac claims it");
        assert.deepEqual(claimed, [queued]);
        assert.deepEqual(claimedAgain, [], "a claimed command is not handed out twice");
        assert.equal(settled, true);
        assert.equal(settledAgain, false, "the first result stands");
        assert.deepEqual(yield* macCommandResult(owner, queued.id), Option.some(RESULT));
        assert.deepEqual(yield* macCommandResult(other, queued.id), Option.none());
      }),
  );

  it.effect(
    "a browser command's result is read back with its image, kept out of its JSON, and leaves with the row",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const { owner, other } = yield* openAccounts;
        const since = yield* now;
        const browser = browserCommand();
        const shell = command();
        yield* queueMacCommand(owner, browser);
        yield* queueMacCommand(owner, shell);
        yield* claimMacCommands(owner, since, SHELL_AND_BROWSER);

        const settledByOther = yield* settleMacBrowserResult(other, browser.id, BROWSER_RESULT);
        const settledOnShell = yield* settleMacBrowserResult(owner, shell.id, BROWSER_RESULT);
        const settled = yield* settleMacBrowserResult(owner, browser.id, BROWSER_RESULT);
        const [stored] = yield* db
          .select({ result: macCommand.result })
          .from(macCommand)
          .where(eq(macCommand.id, browser.id));
        const read = yield* macCommandResult(owner, browser.id);
        yield* withdrawMacCommand(owner, browser.id);
        const left = yield* db
          .select({ id: macCommand.id })
          .from(macCommand)
          .where(eq(macCommand.id, browser.id));

        assert.equal(settledByOther, false, "another account settles nothing");
        assert.equal(settledOnShell, false, "an image never lands on a shell command");
        assert.equal(settled, true);
        assert.deepEqual(stored?.result, { output: BROWSER_RESULT.output });
        assert.deepEqual(read, Option.some(BROWSER_RESULT));
        assert.deepEqual(left, [], "nothing of the image is kept once its call took it");
      }),
  );

  it.effect(
    "a read naming shell alone waits on and claims no browser command, which a read naming browser claims",
    () =>
      Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        const since = yield* now;
        const shell = command();
        const browser = browserCommand();
        yield* queueMacCommand(owner, browser);

        const olderWaits = yield* macCommandsWaiting(owner, since, SHELL_ONLY);
        yield* queueMacCommand(owner, shell);
        const olderClaimed = yield* claimMacCommands(owner, since, SHELL_ONLY);
        const newerWaits = yield* macCommandsWaiting(owner, since, SHELL_AND_BROWSER);
        const newerClaimed = yield* claimMacCommands(owner, since, SHELL_AND_BROWSER);

        assert.equal(olderWaits, false, "a browser command does not wake an older Mac's read");
        assert.deepEqual(olderClaimed, [shell]);
        assert.equal(newerWaits, true);
        assert.deepEqual(newerClaimed, [browser]);
      }),
  );

  it.effect("a row queued before kinds were reads as a shell command", () =>
    Effect.gen(function* () {
      const db = yield* Database;
      const { owner } = yield* openAccounts;
      const since = yield* now;
      const id = randomUUID();
      // Note that the row is written as a build before kinds wrote one, naming no kind.
      yield* db.execute(
        sql`INSERT INTO mac_command (id, user_id, command, timeout_seconds, queued_at)
            VALUES (${id}, ${owner}, 'uptime', 60, ${since.toISOString()})`,
      );

      const [row] = yield* db
        .select({ kind: macCommand.kind })
        .from(macCommand)
        .where(eq(macCommand.id, id));
      const claimed = yield* claimMacCommands(owner, since, SHELL_ONLY);

      assert.equal(row?.kind, MAC_COMMAND_KIND.SHELL);
      assert.deepEqual(claimed, [
        { id, kind: MAC_COMMAND_KIND.SHELL, command: "uptime", timeoutSeconds: 60 },
      ]);
    }),
  );

  it.effect("a Mac counts as listening for a kind only from a read naming it", () =>
    Effect.gen(function* () {
      const { owner, other } = yield* openAccounts;
      const since = yield* now;

      yield* markMacListening(owner, SHELL_ONLY);
      const shellAfterOlder = yield* macListeningSince(owner, MAC_COMMAND_KIND.SHELL, since);
      const browserAfterOlder = yield* macListeningSince(owner, MAC_COMMAND_KIND.BROWSER, since);
      yield* markMacListening(owner, SHELL_AND_BROWSER);
      const browserAfterNewer = yield* macListeningSince(owner, MAC_COMMAND_KIND.BROWSER, since);
      yield* markMacListening(owner, SHELL_ONLY);
      const browserAfterBoth = yield* macListeningSince(owner, MAC_COMMAND_KIND.BROWSER, since);
      const browserForOther = yield* macListeningSince(other, MAC_COMMAND_KIND.BROWSER, since);

      assert.equal(shellAfterOlder, true, "every Mac that reads runs shell commands");
      assert.equal(browserAfterOlder, false);
      assert.equal(browserAfterNewer, true);
      assert.equal(browserAfterBoth, true, "an older Mac's read leaves a newer one counted");
      assert.equal(browserForOther, false);
    }),
  );
});
