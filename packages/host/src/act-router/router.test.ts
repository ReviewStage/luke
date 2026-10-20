import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import {
  ACT,
  ACT_KIND,
  ACT_OUTCOME_STATUS,
  type Act,
  type ActKind,
  type ActOutcome,
} from "../acts.js";
import { recordingReporter } from "../testing/recording-reporter.js";
import type { PlatformActRows } from "./index.js";
import {
  ActRefused,
  type ActRouter,
  type ActRows,
  type ActSender,
  createActRouter,
} from "./router.js";

// The platform's handle on the window that asked, which no row here reads.
const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, call: false };

// SAFETY: ACT declares exactly the kinds `app:act` carries, which Object.keys erases.
const KINDS = Object.keys(ACT) as ActKind[];

/** The router answers an Effect; every test here runs it to the outcome it settles. */
function perform(router: ActRouter, act: Act, sender: ActSender): Effect.Effect<ActOutcome> {
  return router.performAct(act, sender);
}

/** A row per kind named, each recording that it ran and answering nothing. */
function recording(ran: ActKind[], kinds: readonly ActKind[]): Record<string, () => undefined> {
  return Object.fromEntries(
    kinds.map((kind) => [
      kind,
      () => {
        ran.push(kind);
        return undefined;
      },
    ]),
  );
}

/**
 * A table whose every row records that it ran and answers nothing, over which
 * each test replaces the one row it is about. Total by `ActRows`, so what is
 * exercised is the real dispatch rather than a hand-picked subset.
 */
function rowsRecording(ran: ActKind[], overrides: Partial<ActRows> = {}): ActRows {
  // SAFETY: KINDS enumerates every kind exactly once, so the table is total;
  // a row answering nothing is what every kind's own guard admits, because
  // the structured-clone shape a guard checks admits absence.
  const table = recording(ran, KINDS) as unknown as ActRows;
  return { ...table, ...overrides };
}

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
    const voice: ActSender = { sender: SENDER, panel: false, voice: true, call: false };
    yield* perform(router, { kind: ACT_KIND.WINDOW_FOCUS_PANEL }, PANEL);
    yield* perform(router, { kind: ACT_KIND.WINDOW_FOCUS_PANEL }, voice);
    assert.deepEqual(seen, [PANEL, voice]);
  }),
);

/** A platform table of every kind `app:act` carries, each recording that it ran. */
function platformRecording(ran: ActKind[]): PlatformActRows<unknown> {
  // SAFETY: the kinds are exactly those `app:act` carries, each once, and a
  // row answering nothing is what every kind's own guard admits.
  return recording(ran, KINDS) as unknown as PlatformActRows<unknown>;
}

it.effect("a platform table missing a kind does not build", () =>
  Effect.gen(function* () {
    const { [ACT_KIND.UPDATE_CHECK]: _unanswered, ...partial } = platformRecording([]);
    // @ts-expect-error -- update.check is the platform's to answer, and this table has no row for it.
    const platform: PlatformActRows<unknown> = partial;
    const router = createActRouter(platform);
    const outcome = yield* perform(router, { kind: ACT_KIND.UPDATE_CHECK }, PANEL);
    assert.deepEqual(outcome, {
      status: ACT_OUTCOME_STATUS.REFUSED,
      reason: ACT[ACT_KIND.UPDATE_CHECK].refusal,
    });
  }),
);

it.effect(
  "a row that throws is worded as its kind's refusal and reported to Sentry; a refusal is not",
  () => {
    const sentry = recordingReporter();
    return Effect.gen(function* () {
      const kind = ACT_KIND.WINDOW_FOCUS_PANEL;
      const answering = (row: ActRows[typeof kind]) =>
        perform(createActRouter(rowsRecording([], { [kind]: row })), { kind }, PANEL);
      const threw = yield* answering(() => {
        throw new TypeError("rows[kind] is not a function");
      });
      const died = yield* answering(() => Effect.die(new RangeError("no such window")));
      yield* answering(() => {
        throw new ActRefused({ message: "That window is closed." });
      });
      yield* answering(() => Effect.fail(new ActRefused({ message: "Sign in first." })));
      const refusal = { status: ACT_OUTCOME_STATUS.REFUSED, reason: ACT[kind].refusal };
      assert.deepEqual([threw, died], [refusal, refusal]);
      assert.deepEqual(sentry.reported, ["rows[kind] is not a function", "no such window"]);
    }).pipe(Effect.provide(sentry.layer));
  },
);
