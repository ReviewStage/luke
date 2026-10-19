import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  type CodingAgentTranscriptChanged,
  type CodingAgentTranscriptKey,
  TRANSCRIPT_KIND,
} from "@luke/features/coding-agent-view";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import { type ActRows, type ActSender, createActRouter } from "@luke/host/act-router";
import { ACT, ACT_KIND, ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { Effect } from "effect";
import type { WebContents } from "electron";
import {
  type TranscriptFollowActsDependencies,
  transcriptFollowActRows,
} from "./transcript-follow-acts";

/**
 * A followed transcript as main carries it, over a host that answers from a
 * script: each follow asks the host to follow from the start, each page it
 * tells reaches the panels following that transcript and no other, the
 * transcript is let go at the host once no panel holds a follow of it, a
 * panel's page going lets go of all of its follows, and only a panel is
 * answered. Synthetic ids throughout.
 */

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT: CodingAgentTranscriptKey = { kind: TRANSCRIPT_KIND.AGENT, agentId: AGENT_ID };
const WORKER: CodingAgentTranscriptKey = { ...AGENT, callId: "call-7" };
const TASK_WORKER: CodingAgentTranscriptKey = {
  kind: TRANSCRIPT_KIND.TASK_WORKER,
  taskId: TASK_ID,
  callId: "call-0-0",
};

/** One window, by identity alone. */
function panelOf(): ActSender<WebContents> {
  // SAFETY: the rows read a sender by identity alone; one inert object is one window.
  return { sender: {} as WebContents, panel: true, voice: false, call: false };
}

/** A transcript as the test names it in what the host was asked. */
function named(transcript: CodingAgentTranscriptKey): string {
  return transcript.kind === TRANSCRIPT_KIND.AGENT
    ? `${transcript.agentId}:${transcript.callId ?? "own"}`
    : `${transcript.taskId}:${transcript.callId}`;
}

function fixture() {
  const asked: string[] = [];
  const sent: { sender: WebContents; changed: CodingAgentTranscriptChanged }[] = [];
  const gone = new Map<WebContents, () => void>();
  const pending: Effect.Effect<void>[] = [];
  let told: ((changed: CodingAgentTranscriptChanged) => void) | undefined;
  const host: TranscriptFollowActsDependencies["host"] = {
    transcriptFollow: (transcript) =>
      Effect.sync(() => void asked.push(`follow:${named(transcript)}`)),
    transcriptUnfollow: (transcript) =>
      Effect.sync(() => void asked.push(`unfollow:${named(transcript)}`)),
    onTranscriptChanged: (listener) => {
      told = listener;
      return () => undefined;
    },
  };
  const rows = transcriptFollowActRows({
    host,
    deliver: (sender, changed) => void sent.push({ sender, changed }),
    whenGone: (sender, then) => void gone.set(sender, then),
    run: <A>(effect: Effect.Effect<A>) => {
      pending.push(Effect.asVoid(effect));
      return new Promise<A>(() => undefined);
    },
  });
  // SAFETY: the router dispatches only the follow kinds these tests send.
  const router = createActRouter(rows as ActRows<WebContents>);
  const follow = (transcript: CodingAgentTranscriptKey, sender: ActSender<WebContents>) =>
    router.performAct(
      { kind: ACT_KIND.CODING_AGENTS_TRANSCRIPT_FOLLOW, payload: transcript },
      sender,
    );
  const unfollow = (transcript: CodingAgentTranscriptKey, sender: ActSender<WebContents>) =>
    router.performAct(
      { kind: ACT_KIND.CODING_AGENTS_TRANSCRIPT_UNFOLLOW, payload: transcript },
      sender,
    );
  return {
    follow,
    unfollow,
    asked,
    /** What each window was sent, as the test reads it. */
    sentTo: (sender: ActSender<WebContents>) =>
      sent.flatMap((each) => (each.sender === sender.sender ? [each.changed] : [])),
    /** The host telling a followed transcript's page, as the operator would hand it up. */
    hostSays: (changed: CodingAgentTranscriptChanged) => told?.(changed),
    pageGone: (sender: ActSender<WebContents>) => gone.get(sender.sender)?.(),
    /** What the pages' callbacks handed to the runtime, run now. */
    drain: Effect.suspend(() => Effect.all(pending.splice(0), { discard: true })),
  };
}

/** A page of a transcript, as the host tells one. */
function pageOf(transcript: CodingAgentTranscriptKey, text: string): CodingAgentTranscriptChanged {
  return {
    transcript,
    page: {
      messages: [{ id: `m-${text}`, role: "assistant", parts: [{ type: "text", text }] }],
      cursor: "1:0",
      status: CODING_AGENT_STATUS.RUNNING,
      title: null,
    },
  };
}

it.effect(
  "every follow asks the host from the start, and each page reaches the panels following that transcript alone",
  () =>
    Effect.gen(function* () {
      const { follow, asked, sentTo, hostSays } = fixture();
      const one = panelOf();
      const other = panelOf();
      const elsewhere = panelOf();

      yield* follow(AGENT, one);
      yield* follow(WORKER, elsewhere);
      yield* follow(TASK_WORKER, elsewhere);
      hostSays(pageOf(AGENT, "Reading the invites."));
      yield* follow(AGENT, other);
      hostSays(pageOf(AGENT, "Writing the expiry."));
      hostSays(pageOf(TASK_WORKER, "Compared them."));

      assert.deepEqual(asked, [
        `follow:${AGENT_ID}:own`,
        `follow:${AGENT_ID}:call-7`,
        `follow:${TASK_ID}:call-0-0`,
        `follow:${AGENT_ID}:own`,
      ]);
      assert.deepEqual(sentTo(one), [
        pageOf(AGENT, "Reading the invites."),
        pageOf(AGENT, "Writing the expiry."),
      ]);
      assert.deepEqual(sentTo(other), [pageOf(AGENT, "Writing the expiry.")]);
      assert.deepEqual(sentTo(elsewhere), [pageOf(TASK_WORKER, "Compared them.")]);
    }),
);

it.effect(
  "a transcript is let go at the host once no panel holds a follow of it, a panel's follows counted, and a panel's page going lets go of all of them",
  () =>
    Effect.gen(function* () {
      const { follow, unfollow, asked, pageGone, drain, sentTo, hostSays } = fixture();
      const one = panelOf();
      const other = panelOf();

      // The panel follows the agent from two tabs at once, and lets one go.
      yield* follow(AGENT, one);
      yield* follow(AGENT, one);
      yield* unfollow(AGENT, one);
      assert.deepEqual(asked.slice(2), []);
      yield* unfollow(AGENT, one);
      assert.deepEqual(asked.slice(2), [`unfollow:${AGENT_ID}:own`]);
      hostSays(pageOf(AGENT, "Reading the invites."));
      assert.deepEqual(sentTo(one), []);

      yield* follow(WORKER, other);
      yield* follow(TASK_WORKER, other);
      pageGone(other);
      yield* drain;
      assert.deepEqual(asked.slice(5).toSorted(), [
        `unfollow:${TASK_ID}:call-0-0`,
        `unfollow:${AGENT_ID}:call-7`,
      ]);
    }),
);

it.effect("only a panel is answered", () =>
  Effect.gen(function* () {
    const { follow, asked } = fixture();
    const voice: ActSender<WebContents> = { ...panelOf(), panel: false, voice: true };

    assert.deepEqual(yield* follow(AGENT, voice), {
      status: ACT_OUTCOME_STATUS.REFUSED,
      reason: ACT[ACT_KIND.CODING_AGENTS_TRANSCRIPT_FOLLOW].refusal,
    });
    assert.deepEqual(asked, []);
  }),
);
