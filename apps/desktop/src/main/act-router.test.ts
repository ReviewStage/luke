import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import type { WebContents } from "electron";
import {
  ACT,
  ACT_KIND,
  ACT_OUTCOME_STATUS,
  type Act,
  type ActKind,
  type ActOutcome,
} from "#shared/messages/acts";
import { ONE_ACT_OF_EACH_KIND } from "../testing/acts";
import {
  ActRefused,
  type ActRouter,
  type ActRows,
  type ActSender,
  createActRouter,
} from "./act-router";
import { HostUnreachableRefusal } from "./gateway/host-operator";

// SAFETY: the router reads the sender by identity alone; one inert object is one window.
const SENDER = {} as WebContents;

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, introduction: false };

const KINDS: readonly ActKind[] = Object.values(ACT_KIND);

/** The router answers an Effect; every test here runs it to the outcome it settles. */
function perform(router: ActRouter, act: Act, sender: ActSender): Effect.Effect<ActOutcome> {
  return router.performAct(act, sender);
}

/**
 * A table whose every row records that it ran and answers nothing, over which
 * each test replaces the one row it is about. Total by `ActRows`, so what is
 * exercised is the real dispatch rather than a hand-picked subset.
 */
function rowsRecording(ran: ActKind[], overrides: Partial<ActRows> = {}): ActRows {
  const rows = new Map<ActKind, () => undefined>();
  for (const kind of KINDS) {
    rows.set(kind, () => {
      ran.push(kind);
      return undefined;
    });
  }
  // SAFETY: KINDS enumerates every kind exactly once, so the table is total;
  // a row answering nothing is what every kind's own guard admits, because
  // the structured-clone shape a guard checks admits absence.
  const table = Object.fromEntries(rows) as unknown as ActRows;
  return { ...table, ...overrides };
}

it.effect("every kind reaches its own row, and only its own", () =>
  Effect.gen(function* () {
    const ran: ActKind[] = [];
    const router = createActRouter(rowsRecording(ran));
    for (const kind of KINDS) {
      ran.length = 0;
      // The kinds that carry a payload are covered by the vocabulary's own
      // table; here the dispatch is what is under test, so the two kinds are
      // driven through the same call with the payload each takes.
      const act = ONE_ACT_OF_EACH_KIND[kind];
      const outcome = yield* perform(router, act, PANEL);
      assert.deepEqual(ran, [kind], kind);
      assert.notEqual(outcome.status, ACT_OUTCOME_STATUS.UNKNOWN_ACT, kind);
    }
  }),
);

it.effect("a payload the kind's schema refuses never reaches the row", () =>
  Effect.gen(function* () {
    const ran: ActKind[] = [];
    const router = createActRouter(rowsRecording(ran));
    const outcome = yield* perform(
      router,
      // SAFETY: this is the malformed payload under test, which is exactly what
      // a main-process caller could hand the router past the window's own read.
      { kind: ACT_KIND.WINDOW_COPY_TEXT, payload: { words: 3 } } as unknown as Act,
      PANEL,
    );
    assert.deepEqual(outcome, {
      status: ACT_OUTCOME_STATUS.REFUSED,
      reason: ACT[ACT_KIND.WINDOW_COPY_TEXT].refusal,
    });
    assert.deepEqual(ran, []);
  }),
);

it.effect("a kind this build does not know is answered as unknown and reaches nothing", () =>
  Effect.gen(function* () {
    const ran: ActKind[] = [];
    const router = createActRouter(rowsRecording(ran));
    // SAFETY: an unnamed kind is what a window of another build would send.
    const outcome = yield* perform(router, { kind: "session.reopen" } as unknown as Act, PANEL);
    assert.deepEqual(outcome, { status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
    assert.deepEqual(ran, []);
  }),
);

it.effect(
  "a row's own refusal is answered with its sentence; every other throw with the kind's",
  () =>
    Effect.gen(function* () {
      const ran: ActKind[] = [];
      const router = createActRouter(
        rowsRecording(ran, {
          [ACT_KIND.WINDOW_QUIT]: () => {
            throw new ActRefused({ message: "A quit is held while the update installs." });
          },
          [ACT_KIND.CALENDAR_REFRESH]: () => {
            throw new Error("EPIPE writing to the helper");
          },
        }),
      );
      assert.deepEqual(yield* perform(router, { kind: ACT_KIND.WINDOW_QUIT }, PANEL), {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: "A quit is held while the update installs.",
      });
      // Nothing an exception carried reaches the window: the kind's own sentence does.
      assert.deepEqual(yield* perform(router, { kind: ACT_KIND.CALENDAR_REFRESH }, PANEL), {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.CALENDAR_REFRESH].refusal,
      });
    }),
);

it.effect("an answer the kind's own guard refuses is a refusal rather than a value drawn", () =>
  Effect.gen(function* () {
    const router = createActRouter(
      rowsRecording([], {
        // SAFETY: this is the wrong-shaped answer under test.
        [ACT_KIND.SESSION_SEND_MESSAGE]: () => ({ runId: "run-1" }) as never,
      }),
    );
    assert.deepEqual(
      yield* perform(router, ONE_ACT_OF_EACH_KIND[ACT_KIND.SESSION_SEND_MESSAGE], PANEL),
      {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.SESSION_SEND_MESSAGE].refusal,
      },
    );
  }),
);

it.effect(
  "a row that answers an effect is run by the router, and its failure is the kind's refusal",
  () =>
    Effect.gen(function* () {
      const ran: ActKind[] = [];
      const router = createActRouter(
        rowsRecording(ran, {
          [ACT_KIND.WINDOW_SET_EXPANDED]: () =>
            Effect.sync(() => {
              ran.push(ACT_KIND.WINDOW_SET_EXPANDED);
              return "expanded";
            }),
          [ACT_KIND.CALENDAR_REFRESH]: () =>
            Effect.fail(new HostUnreachableRefusal({ message: "the transport closed" })),
          [ACT_KIND.WINDOW_QUIT]: () =>
            Effect.fail(new ActRefused({ message: "A quit is held while the update installs." })),
        }),
      );
      assert.deepEqual(
        yield* perform(
          router,
          { kind: ACT_KIND.WINDOW_SET_EXPANDED, payload: { expanded: true } },
          PANEL,
        ),
        { status: ACT_OUTCOME_STATUS.DONE, value: "expanded" },
      );
      assert.deepEqual(ran, [ACT_KIND.WINDOW_SET_EXPANDED]);
      assert.deepEqual(yield* perform(router, { kind: ACT_KIND.CALENDAR_REFRESH }, PANEL), {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.CALENDAR_REFRESH].refusal,
      });
      assert.deepEqual(yield* perform(router, { kind: ACT_KIND.WINDOW_QUIT }, PANEL), {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: "A quit is held while the update installs.",
      });
    }),
);

it.effect("a row is handed the sender's standing, which no payload can claim", () =>
  Effect.gen(function* () {
    const seen: ActSender[] = [];
    const router = createActRouter(
      rowsRecording([], {
        [ACT_KIND.WINDOW_FOCUS_PANEL]: (_payload, sender) => {
          seen.push(sender);
        },
      }),
    );
    const voice: ActSender = { sender: SENDER, panel: false, voice: true, introduction: false };
    yield* perform(router, { kind: ACT_KIND.WINDOW_FOCUS_PANEL }, PANEL);
    yield* perform(router, { kind: ACT_KIND.WINDOW_FOCUS_PANEL }, voice);
    assert.deepEqual(seen, [PANEL, voice]);
  }),
);

it.effect("a row's answer rides the outcome as its own value", () =>
  Effect.gen(function* () {
    const router = createActRouter(
      rowsRecording([], { [ACT_KIND.WINDOW_SET_EXPANDED]: () => "expanded" }),
    );
    assert.deepEqual(
      yield* perform(
        router,
        { kind: ACT_KIND.WINDOW_SET_EXPANDED, payload: { expanded: true } },
        PANEL,
      ),
      { status: ACT_OUTCOME_STATUS.DONE, value: "expanded" },
    );
  }),
);
