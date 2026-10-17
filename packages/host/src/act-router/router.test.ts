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
import { createHostActRouter, type HostActDependencies, type PlatformActRows } from "./index.js";
import { type ActRouter, type ActRows, type ActSender, createActRouter } from "./router.js";

// The platform's handle on the window that asked, which no row here reads.
const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, call: false };

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

// SAFETY: no act the assembly test sends reaches a dependency of the host's
// rows: the one host kind it sends is refused at the row's own sender check.
const UNREACHED = {
  account: {},
  settings: {},
  tasks: {},
  codingAgents: {},
  integrations: {},
  automations: {},
  issues: {},
} as unknown as HostActDependencies<unknown>;

it.effect(
  "the assembled table answers the host's kinds by the host's rows and leaves the platform the rest",
  () =>
    Effect.gen(function* () {
      const ran: ActKind[] = [];
      // The platform's table carries a row for every kind, the host's among
      // them, and the host's rows still answer theirs.
      const router = createHostActRouter(UNREACHED, rowsRecording(ran));
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

it.effect("a platform table missing a kind the host leaves it does not build", () =>
  Effect.gen(function* () {
    const { [ACT_KIND.UPDATE_CHECK]: _unanswered, ...partial } = rowsRecording([]);
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
