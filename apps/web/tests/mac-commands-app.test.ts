import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { db } from "@sidecar/database/core/query";
import { user } from "@sidecar/database/schemas/auth";
import { getTestDB } from "@sidecar/database/testing";
import {
  MAC_COMMAND_BOUNDS,
  type MacCommand,
  type MacCommandResult,
  macCommandsAnswerSchema,
} from "@sidecar/hosted/mac-command-wire";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Clock, Duration, Effect, Layer, Option, Queue, Result } from "effect";
import { TestClock } from "effect/testing";
import { HttpRouter } from "effect/unstable/http";
import { SqlClient } from "effect/unstable/sql";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../server/hosted/http";
import {
  MAC_COMMAND_REFUSAL,
  MAC_COMMAND_SERVICE,
  MAC_COMMAND_STATUS,
  runOnMac,
  runOnMacTool,
} from "../server/hosted/mac-command";
import { macCommandsApp } from "../server/mac-commands-app";
import { driven, forkClockDriven } from "./support/clock-driven";

/**
 * An agent's command run on the developer's Mac, end to end over a real
 * dialect: the call refuses where no Mac of the account read lately, a
 * Mac's held read counts it listening and is answered with the command the
 * call queued, the result it posts is what the call answers, and a call
 * that hears nothing says so. The route answers the bearer's account alone.
 *
 * Synthetic accounts, bearers, and commands throughout.
 */

const ORIGIN = "https://luke.test";
const MAC_COMMANDS = "/api/mac-commands";

const RESULT: MacCommandResult = {
  exitCode: 0,
  stdout: "feature/mac-commands\n",
  stderr: "",
  truncated: false,
  timedOut: false,
};

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

const openAccounts = Effect.gen(function* () {
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  }
  return { owner, other };
});

/** The group answering one request, on the fiber's own clock, so a held read waits on the test's. */
const ask = (request: Request) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, client),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      macCommandsApp({
        resolveUserId: (incoming) => {
          const bearer = incoming.headers.get("authorization") ?? "";
          return Effect.succeed(
            bearer.startsWith("Bearer ") ? Option.some(bearer.slice(7)) : Option.none(),
          );
        },
      }).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const response = yield* Effect.promise(() => handler(request));
    // SAFETY: the group answers JSON; the test compares it as the wire value it is.
    const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
    yield* Effect.promise(() => dispose());
    return { status: response.status, body } satisfies Answer;
  });

const read = (userId: string) =>
  new Request(new URL(MAC_COMMANDS, ORIGIN), { headers: { authorization: `Bearer ${userId}` } });

const settle = (userId: string, id: string, result: MacCommandResult = RESULT) =>
  new Request(new URL(MAC_COMMANDS, ORIGIN), {
    method: "POST",
    headers: { authorization: `Bearer ${userId}` },
    body: JSON.stringify({ id, result }),
  });

/** A held read driven through its hold on the test's clock. */
const heldRead = (userId: string) =>
  Effect.flatMap(forkClockDriven(ask(read(userId))), (subject) =>
    driven(subject, MAC_COMMAND_SERVICE.POLL),
  );

function commandsOf(answered: Answer): readonly MacCommand[] {
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
  const commands = readEither(macCommandsAnswerSchema)(unparsedWire(answered.body));
  if (Result.isFailure(commands)) return assert.fail(`not the wire's: ${commands.failure.refusal}`);
  return commands.success.commands;
}

const NOT_FOUND = {
  status: HOSTED_HTTP_STATUS.NOT_FOUND,
  body: { error: HOSTED_API_ERROR.NOT_FOUND },
};

it.layer(getTestDB())("a command run on the developer's Mac", (it) => {
  it.effect("refuses at once where no Mac of the account has read", () =>
    Effect.gen(function* () {
      const { owner } = yield* openAccounts;

      const answered = yield* runOnMac(owner, { command: "git status" });

      assert.deepEqual(answered, {
        status: MAC_COMMAND_STATUS.NOT_RUN,
        reason: MAC_COMMAND_REFUSAL.NO_MAC,
      });
    }),
  );

  it.effect(
    "a Mac's read is handed the queued command, and the result it posts is what the call answers",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const empty = yield* heldRead(owner);
        const call = yield* forkClockDriven(
          runOnMac(owner, { command: "git branch --show-current", timeoutSeconds: 5 }),
        );
        yield* Queue.take(call.asleep);

        const [queued] = commandsOf(yield* ask(read(owner)));
        if (queued === undefined) return assert.fail("the Mac's read carried no command");
        const byOther = yield* ask(settle(other, queued.id));
        const settled = yield* ask(settle(owner, queued.id));
        const answered = yield* driven(call, MAC_COMMAND_SERVICE.POLL);
        const afterward = yield* ask(settle(owner, queued.id));

        assert.deepEqual(commandsOf(empty), [], "a read with nothing waiting answers none");
        assert.deepEqual(queued, {
          id: queued.id,
          command: "git branch --show-current",
          timeoutSeconds: 5,
        });
        assert.deepEqual(byOther, NOT_FOUND, "another account settles nothing");
        assert.equal(settled.status, HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(answered, { status: MAC_COMMAND_STATUS.RAN, ...RESULT });
        assert.deepEqual(afterward, NOT_FOUND, "the call withdrew the command once it answered");
      }),
  );

  it.effect("a call whose Mac never posts says it heard nothing, past the timeout and grace", () =>
    Effect.gen(function* () {
      const { owner } = yield* openAccounts;
      yield* heldRead(owner);
      const call = yield* forkClockDriven(runOnMac(owner, { command: "sleep 600" }));
      yield* Queue.take(call.asleep);
      const [queued] = commandsOf(yield* ask(read(owner)));
      if (queued === undefined) return assert.fail("the Mac's read carried no command");

      const started = yield* Clock.currentTimeMillis;
      const answered = yield* driven(call, Duration.seconds(5));
      const waited = (yield* Clock.currentTimeMillis) - started;

      assert.deepEqual(answered, {
        status: MAC_COMMAND_STATUS.NOT_RUN,
        reason: MAC_COMMAND_REFUSAL.NO_ANSWER,
      });
      assert.equal(queued.timeoutSeconds, 60, "a call that names no timeout runs for a minute");
      assert.ok(
        waited >=
          Duration.toMillis(Duration.sum(Duration.seconds(60), MAC_COMMAND_SERVICE.ANSWER_GRACE)),
      );
      assert.deepEqual(yield* ask(settle(owner, queued.id)), NOT_FOUND);
    }),
  );

  it.effect("an ask the Mac's read would refuse is refused before it is queued", () =>
    Effect.gen(function* () {
      const { owner } = yield* openAccounts;
      yield* heldRead(owner);

      const asks = [
        { command: "" },
        { command: "ls", timeoutSeconds: 0 },
        { command: "ls", timeoutSeconds: MAC_COMMAND_BOUNDS.MAX_TIMEOUT_SECONDS + 1 },
      ];
      for (const ask of asks) {
        assert.deepEqual(yield* runOnMac(owner, ask), {
          status: MAC_COMMAND_STATUS.NOT_RUN,
          reason: MAC_COMMAND_REFUSAL.UNREADABLE,
        });
      }
      assert.deepEqual(commandsOf(yield* heldRead(owner)), [], "nothing was queued");
    }),
  );

  it.effect("a command no Mac took within the claim window is never handed to a later read", () =>
    Effect.gen(function* () {
      const { owner } = yield* openAccounts;
      yield* heldRead(owner);
      const call = yield* forkClockDriven(runOnMac(owner, { command: "open -a Xcode" }));
      yield* Queue.take(call.asleep);
      yield* TestClock.adjust(Duration.sum(MAC_COMMAND_SERVICE.CLAIM_WINDOW, Duration.seconds(1)));

      const late = yield* heldRead(owner);

      assert.deepEqual(commandsOf(late), []);
      assert.deepEqual(yield* driven(call, Duration.seconds(5)), {
        status: MAC_COMMAND_STATUS.NOT_RUN,
        reason: MAC_COMMAND_REFUSAL.NO_ANSWER,
      });
    }),
  );

  it.effect(
    "the tool every agent calls reads its input: the timeout it names rides to the Mac, and input it cannot read runs nothing",
    () =>
      Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        yield* heldRead(owner);

        const unreadable = yield* runOnMacTool(owner, unparsedWire({ cmd: "ls" }));
        const call = yield* forkClockDriven(
          runOnMacTool(
            owner,
            unparsedWire({
              command: "pnpm test",
              description: "Run the tests",
              timeout_seconds: 300,
            }),
          ),
        );
        yield* Queue.take(call.asleep);
        const [queued] = commandsOf(yield* ask(read(owner)));
        if (queued === undefined) return assert.fail("the Mac's read carried no command");
        yield* ask(settle(owner, queued.id));

        assert.deepEqual(unreadable, {
          status: MAC_COMMAND_STATUS.NOT_RUN,
          reason: MAC_COMMAND_REFUSAL.UNREADABLE,
        });
        assert.equal(queued.command, "pnpm test", "the description is never run");
        assert.equal(queued.timeoutSeconds, 300);
        assert.deepEqual(yield* driven(call, MAC_COMMAND_SERVICE.POLL), {
          status: MAC_COMMAND_STATUS.RAN,
          ...RESULT,
        });
      }),
  );

  it.effect("a request without a bearer is refused", () =>
    Effect.gen(function* () {
      const answered = yield* ask(new Request(new URL(MAC_COMMANDS, ORIGIN)));

      assert.deepEqual(answered, {
        status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
        body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
      });
    }),
  );
});
