import assert from "node:assert/strict";
import type { SessionRowActions } from "@sidecar/host";
import type { SessionIdentity } from "@sidecar/session";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import type { WebContents } from "electron";
import { test } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS } from "#shared/messages/acts";
import { ActRefused, type ActSender, createActRouter } from "../act-router";
import { ROW_WRITE_REFUSAL, sessionActRows, WRITE_REFUSAL } from "./session-acts";

// SAFETY: the router reads the sender by identity alone; one inert object is one window.
const SENDER = {} as WebContents;

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, introduction: false };
const VOICE: ActSender = { sender: SENDER, panel: false, voice: true, introduction: false };
const INTRODUCTION: ActSender = { sender: SENDER, panel: true, voice: false, introduction: true };

const IDENTITY: SessionIdentity = { providerId: "conductor", providerSessionId: "chat-1" };

interface Asked {
  messages: { identity: SessionIdentity; text: string }[];
  controls: { identity: SessionIdentity; controlId: string }[];
}

/** The host's row writes as this process reaches them, recording what crossed and answering as told. */
function fixture(answer: () => Promise<Awaited<ReturnType<SessionRowActions["sendMessage"]>>>) {
  const asked: Asked = { messages: [], controls: [] };
  const writes: SessionRowActions = {
    sendMessage: async (identity, text) => {
      asked.messages.push({ identity, text });
      return answer();
    },
    executeControl: async (identity, controlId) => {
      asked.controls.push({ identity, controlId });
      return answer();
    },
  };
  const unreachable = async () => {
    throw new Error("a write never opens anything");
  };
  const rows = sessionActRows({
    performer: {
      openSession: unreachable,
      openSessionApplication: unreachable,
      openSessionChange: unreachable,
    },
    writes,
  });
  return { rows, asked };
}

test("a row's send and press cross to the host's writes with the identity and words the row named", async () => {
  const f = fixture(async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }));
  const sent = await f.rows[ACT_KIND.SESSION_SEND_MESSAGE](
    { identity: IDENTITY, text: "please add a test" },
    PANEL,
  );
  const pressed = await f.rows[ACT_KIND.SESSION_EXECUTE_CONTROL](
    { identity: IDENTITY, controlId: "cancel-run" },
    PANEL,
  );
  assert.deepEqual(sent, { status: ACTION_RESULT_STATUS.ACCEPTED });
  assert.deepEqual(pressed, { status: ACTION_RESULT_STATUS.ACCEPTED });
  assert.deepEqual(f.asked.messages, [{ identity: IDENTITY, text: "please add a test" }]);
  assert.deepEqual(f.asked.controls, [{ identity: IDENTITY, controlId: "cancel-run" }]);
});

test("the host's refusal is the row's answer, never a throw", async () => {
  const refusal = { status: ACTION_RESULT_STATUS.REJECTED, reason: "No such session." } as const;
  const f = fixture(async () => refusal);
  assert.deepEqual(
    await f.rows[ACT_KIND.SESSION_SEND_MESSAGE]({ identity: IDENTITY, text: "hi" }, PANEL),
    refusal,
  );
});

test("a host that could not be asked answers the row with this build's own sentence", async () => {
  const f = fixture(async () => {
    throw new Error("the transport closed");
  });
  assert.deepEqual(
    await f.rows[ACT_KIND.SESSION_SEND_MESSAGE]({ identity: IDENTITY, text: "hi" }, PANEL),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: WRITE_REFUSAL.MESSAGE },
  );
  assert.deepEqual(
    await f.rows[ACT_KIND.SESSION_EXECUTE_CONTROL](
      { identity: IDENTITY, controlId: "cancel-run" },
      PANEL,
    ),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: WRITE_REFUSAL.CONTROL },
  );
});

test("only a panel's row may write: the voice window and the introduction are refused before the host", async () => {
  const f = fixture(async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }));
  for (const sender of [VOICE, INTRODUCTION]) {
    await assert.rejects(
      async () => f.rows[ACT_KIND.SESSION_SEND_MESSAGE]({ identity: IDENTITY, text: "hi" }, sender),
      ActRefused,
    );
    await assert.rejects(
      async () =>
        f.rows[ACT_KIND.SESSION_EXECUTE_CONTROL](
          { identity: IDENTITY, controlId: "cancel-run" },
          sender,
        ),
      ActRefused,
    );
  }
  assert.deepEqual(f.asked.messages, []);
  assert.deepEqual(f.asked.controls, []);
});

test("through the router, a refused sender reads as the row's own refusal and an answer keeps its shape", async () => {
  const f = fixture(async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }));
  // SAFETY: the router dispatches on the kind alone; the other kinds are never reached here.
  const router = createActRouter(f.rows as Parameters<typeof createActRouter>[0]);
  const refused = await router.performAct(
    { kind: ACT_KIND.SESSION_SEND_MESSAGE, payload: { identity: IDENTITY, text: "hi" } },
    VOICE,
  );
  assert.deepEqual(refused, { status: ACT_OUTCOME_STATUS.REFUSED, reason: ROW_WRITE_REFUSAL });
  const done = await router.performAct(
    { kind: ACT_KIND.SESSION_SEND_MESSAGE, payload: { identity: IDENTITY, text: "hi" } },
    PANEL,
  );
  assert.deepEqual(done, {
    status: ACT_OUTCOME_STATUS.DONE,
    value: { status: ACTION_RESULT_STATUS.ACCEPTED },
  });
});
