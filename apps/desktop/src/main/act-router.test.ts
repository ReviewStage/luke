import assert from "node:assert/strict";
import type { WebContents } from "electron";
import { test } from "vitest";
import { ACT, ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActKind } from "#shared/messages/acts";
import { ONE_ACT_OF_EACH_KIND } from "../testing/acts";
import { ActRefused, type ActRows, type ActSender, createActRouter } from "./act-router";

// SAFETY: the router reads the sender by identity alone; one inert object is one window.
const SENDER = {} as WebContents;

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, introduction: false };

const KINDS: readonly ActKind[] = Object.values(ACT_KIND);

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

test("every kind reaches its own row, and only its own", async () => {
  const ran: ActKind[] = [];
  const router = createActRouter(rowsRecording(ran));
  for (const kind of KINDS) {
    ran.length = 0;
    // The kinds that carry a payload are covered by the vocabulary's own
    // table; here the dispatch is what is under test, so the two kinds are
    // driven through the same call with the payload each takes.
    const act = ONE_ACT_OF_EACH_KIND[kind];
    const outcome = await router.performAct(act, PANEL);
    assert.deepEqual(ran, [kind], kind);
    assert.notEqual(outcome.status, ACT_OUTCOME_STATUS.UNKNOWN_ACT, kind);
  }
});

test("a payload the kind's schema refuses never reaches the row", async () => {
  const ran: ActKind[] = [];
  const router = createActRouter(rowsRecording(ran));
  const outcome = await router.performAct(
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
});

test("a kind this build does not know is answered as unknown and reaches nothing", async () => {
  const ran: ActKind[] = [];
  const router = createActRouter(rowsRecording(ran));
  // SAFETY: an unnamed kind is what a window of another build would send.
  const outcome = await router.performAct({ kind: "session.reopen" } as unknown as Act, PANEL);
  assert.deepEqual(outcome, { status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
  assert.deepEqual(ran, []);
});

test("a row's own refusal is answered with its sentence; every other throw with the kind's", async () => {
  const ran: ActKind[] = [];
  const router = createActRouter(
    rowsRecording(ran, {
      [ACT_KIND.WINDOW_QUIT]: () => {
        throw new ActRefused("A quit is held while the update installs.");
      },
      [ACT_KIND.CALENDAR_REFRESH]: () => {
        throw new Error("EPIPE writing to the helper");
      },
    }),
  );
  assert.deepEqual(await router.performAct({ kind: ACT_KIND.WINDOW_QUIT }, PANEL), {
    status: ACT_OUTCOME_STATUS.REFUSED,
    reason: "A quit is held while the update installs.",
  });
  // Nothing an exception carried reaches the window: the kind's own sentence does.
  assert.deepEqual(await router.performAct({ kind: ACT_KIND.CALENDAR_REFRESH }, PANEL), {
    status: ACT_OUTCOME_STATUS.REFUSED,
    reason: ACT[ACT_KIND.CALENDAR_REFRESH].refusal,
  });
});

test("an answer the kind's own guard refuses is a refusal rather than a value drawn", async () => {
  const router = createActRouter(
    rowsRecording([], {
      // SAFETY: this is the wrong-shaped answer under test.
      [ACT_KIND.SUPERSET_DISCONNECT]: () => ({ status: "rejected" }) as never,
    }),
  );
  assert.deepEqual(await router.performAct({ kind: ACT_KIND.SUPERSET_DISCONNECT }, PANEL), {
    status: ACT_OUTCOME_STATUS.REFUSED,
    reason: ACT[ACT_KIND.SUPERSET_DISCONNECT].refusal,
  });
});

test("a row is handed the sender's standing, which no payload can claim", async () => {
  const seen: ActSender[] = [];
  const router = createActRouter(
    rowsRecording([], {
      [ACT_KIND.WINDOW_FOCUS_PANEL]: (_payload, sender) => {
        seen.push(sender);
      },
    }),
  );
  const voice: ActSender = { sender: SENDER, panel: false, voice: true, introduction: false };
  await router.performAct({ kind: ACT_KIND.WINDOW_FOCUS_PANEL }, PANEL);
  await router.performAct({ kind: ACT_KIND.WINDOW_FOCUS_PANEL }, voice);
  assert.deepEqual(seen, [PANEL, voice]);
});

test("a row's answer rides the outcome as its own value", async () => {
  const router = createActRouter(
    rowsRecording([], { [ACT_KIND.WINDOW_SET_EXPANDED]: () => "expanded" }),
  );
  assert.deepEqual(
    await router.performAct(
      { kind: ACT_KIND.WINDOW_SET_EXPANDED, payload: { expanded: true } },
      PANEL,
    ),
    { status: ACT_OUTCOME_STATUS.DONE, value: "expanded" },
  );
});
