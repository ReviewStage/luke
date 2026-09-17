import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { SessionIdentity, SessionWriteResult } from "@sidecar/session";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { ACT_KIND, ACT_OUTCOME_STATUS } from "#shared/messages/acts";
import { ActRefused, type ActSender, createActRouter } from "../act-router";
import { sessionActRows } from "./session-acts";

// SAFETY: the router reads the sender by identity alone; one inert object is one window.
const SENDER = {} as WebContents;

/** These rows answer effects; running one is what the router does with it. */
function answered(
  answer:
    | SessionWriteResult
    | Promise<SessionWriteResult>
    | Effect.Effect<SessionWriteResult, Error>,
): Effect.Effect<SessionWriteResult, Error> {
  // SAFETY: every row under test answers an effect, which is what the row's
  // own type says of the three shapes a row may answer.
  return answer as Effect.Effect<SessionWriteResult, Error>;
}

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, introduction: false };
const VOICE: ActSender = { sender: SENDER, panel: false, voice: true, introduction: false };
const INTRODUCTION: ActSender = { sender: SENDER, panel: true, voice: false, introduction: true };

const IDENTITY: SessionIdentity = { providerId: "conductor", providerSessionId: "chat-1" };

interface Asked {
  messages: { identity: SessionIdentity; text: string }[];
  controls: { identity: SessionIdentity; controlId: string }[];
}

/** The host's row writes as this process reaches them, recording what crossed and answering as told. */
function fixture(answer: () => Effect.Effect<SessionWriteResult>) {
  const asked: Asked = { messages: [], controls: [] };
  const writes: Parameters<typeof sessionActRows>[0]["writes"] = {
    sendMessage: (identity, text) =>
      Effect.suspend(() => {
        asked.messages.push({ identity, text });
        return answer();
      }),
    executeControl: (identity, controlId) =>
      Effect.suspend(() => {
        asked.controls.push({ identity, controlId });
        return answer();
      }),
  };
  const unreachable = () => Effect.die(new Error("a write never opens anything"));
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

it.effect(
  "a row's send and press cross to the host's writes with the identity and words the row named",
  () =>
    Effect.gen(function* () {
      const f = fixture(() => Effect.succeed({ status: ACTION_RESULT_STATUS.ACCEPTED }));
      const sent = yield* answered(
        f.rows[ACT_KIND.SESSION_SEND_MESSAGE](
          { identity: IDENTITY, text: "please add a test" },
          PANEL,
        ),
      );
      const pressed = yield* answered(
        f.rows[ACT_KIND.SESSION_EXECUTE_CONTROL](
          { identity: IDENTITY, controlId: "cancel-run" },
          PANEL,
        ),
      );
      assert.deepEqual(sent, { status: ACTION_RESULT_STATUS.ACCEPTED });
      assert.deepEqual(pressed, { status: ACTION_RESULT_STATUS.ACCEPTED });
      assert.deepEqual(f.asked.messages, [{ identity: IDENTITY, text: "please add a test" }]);
      assert.deepEqual(f.asked.controls, [{ identity: IDENTITY, controlId: "cancel-run" }]);
    }),
);

it.effect("the host's refusal is the row's answer, never a throw", () =>
  Effect.gen(function* () {
    const refusal = { status: ACTION_RESULT_STATUS.REJECTED, reason: "No such session." } as const;
    const f = fixture(() => Effect.succeed(refusal));
    assert.deepEqual(
      yield* answered(
        f.rows[ACT_KIND.SESSION_SEND_MESSAGE]({ identity: IDENTITY, text: "hi" }, PANEL),
      ),
      refusal,
    );
  }),
);

it.effect("a host that could not be asked answers the row with this build's own sentence", () =>
  Effect.gen(function* () {
    const f = fixture(() => Effect.die(new Error("the transport closed")));
    assert.deepEqual(
      yield* answered(
        f.rows[ACT_KIND.SESSION_SEND_MESSAGE]({ identity: IDENTITY, text: "hi" }, PANEL),
      ),
      { status: ACTION_RESULT_STATUS.REJECTED, reason: "That message could not be sent." },
    );
    assert.deepEqual(
      yield* answered(
        f.rows[ACT_KIND.SESSION_EXECUTE_CONTROL](
          { identity: IDENTITY, controlId: "cancel-run" },
          PANEL,
        ),
      ),
      { status: ACTION_RESULT_STATUS.REJECTED, reason: "That control could not be run." },
    );
  }),
);

it.effect(
  "only a panel's row may write: the voice window and the introduction are refused before the host",
  () =>
    Effect.gen(function* () {
      const f = fixture(() => Effect.succeed({ status: ACTION_RESULT_STATUS.ACCEPTED }));
      for (const sender of [VOICE, INTRODUCTION]) {
        assert.throws(
          () => f.rows[ACT_KIND.SESSION_SEND_MESSAGE]({ identity: IDENTITY, text: "hi" }, sender),
          ActRefused,
        );
        assert.throws(
          () =>
            f.rows[ACT_KIND.SESSION_EXECUTE_CONTROL](
              { identity: IDENTITY, controlId: "cancel-run" },
              sender,
            ),
          ActRefused,
        );
      }
      assert.deepEqual(f.asked.messages, []);
      assert.deepEqual(f.asked.controls, []);
    }),
);

it.effect(
  "through the router, a refused sender reads as the row's own refusal and an answer keeps its shape",
  () =>
    Effect.gen(function* () {
      const f = fixture(() => Effect.succeed({ status: ACTION_RESULT_STATUS.ACCEPTED }));
      // SAFETY: the router dispatches on the kind alone; the other kinds are never reached here.
      const router = createActRouter(f.rows as Parameters<typeof createActRouter>[0]);
      const refused = yield* router.performAct(
        { kind: ACT_KIND.SESSION_SEND_MESSAGE, payload: { identity: IDENTITY, text: "hi" } },
        VOICE,
      );
      assert.deepEqual(refused, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: "Only a session row on the panel can send that.",
      });
      const done = yield* router.performAct(
        { kind: ACT_KIND.SESSION_SEND_MESSAGE, payload: { identity: IDENTITY, text: "hi" } },
        PANEL,
      );
      assert.deepEqual(done, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { status: ACTION_RESULT_STATUS.ACCEPTED },
      });
    }),
);
