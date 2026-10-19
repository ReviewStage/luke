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
import { hostActRows } from "./host-act-rows.js";
import { createHostActRouter, type HostActDependencies, type PlatformActRows } from "./index.js";
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

// SAFETY: no act the assembly tests send reaches a dependency of the host's
// rows: the one host kind they send is refused at the row's own sender check,
// and building the rows reads none of them.
const UNREACHED = {
  account: {},
  settings: {},
  tasks: {},
  codingAgents: {},
} as unknown as HostActDependencies<unknown>;

/** A platform table of every kind the host's rows leave, each recording that it ran. */
function platformRecording(ran: ActKind[]): PlatformActRows<unknown> {
  const hosts = new Set(Object.keys(hostActRows(UNREACHED)));
  // SAFETY: the kinds are exactly those the host's rows leave, each once, and
  // a row answering nothing is what every kind's own guard admits.
  return recording(
    ran,
    KINDS.filter((kind) => !hosts.has(kind)),
  ) as unknown as PlatformActRows<unknown>;
}

it.effect(
  "the assembled table answers the host's kinds by the host's rows and every other by the platform's",
  () =>
    Effect.gen(function* () {
      const ran: ActKind[] = [];
      const router = createHostActRouter(UNREACHED, platformRecording(ran));
      const voice: ActSender = { ...PANEL, panel: false, voice: true };
      const refresh = yield* perform(router, { kind: ACT_KIND.TASKS_REFRESH }, voice);
      yield* perform(router, { kind: ACT_KIND.UPDATE_CHECK }, PANEL);
      assert.deepEqual(refresh, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.TASKS_REFRESH].refusal,
      });
      assert.deepEqual(ran, [ACT_KIND.UPDATE_CHECK]);
    }),
);

it.effect(
  "a platform table carrying a row for one of the host's kinds does not build, and the host's row answers it anyway",
  () =>
    Effect.gen(function* () {
      const ran: ActKind[] = [];
      const overlapping = {
        ...platformRecording(ran),
        [ACT_KIND.TASKS_REFRESH]: () => {
          ran.push(ACT_KIND.TASKS_REFRESH);
        },
      };
      // @ts-expect-error -- tasks.refresh is the host's to answer, so a platform row for it is refused.
      const platform: PlatformActRows<unknown> = overlapping;
      const router = createHostActRouter(UNREACHED, platform);
      const voice: ActSender = { ...PANEL, panel: false, voice: true };
      const refresh = yield* perform(router, { kind: ACT_KIND.TASKS_REFRESH }, voice);
      assert.deepEqual(refresh, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.TASKS_REFRESH].refusal,
      });
      assert.deepEqual(ran, []);
    }),
);

it.effect("a platform table missing a kind the host leaves it does not build", () =>
  Effect.gen(function* () {
    const { [ACT_KIND.UPDATE_CHECK]: _unanswered, ...partial } = platformRecording([]);
    // @ts-expect-error -- update.check is the platform's to answer, and this table has no row for it.
    const platform: PlatformActRows<unknown> = partial;
    const router = createHostActRouter(UNREACHED, platform);
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
