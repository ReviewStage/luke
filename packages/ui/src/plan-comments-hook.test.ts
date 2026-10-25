// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  PLAN_COMMENT_ACTION,
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_SCOPE,
  PLAN_COMMENT_STATUS,
  type PlanCommentThread,
} from "@luke/features/plan-comment-wire";
import { PLAN_COMMENT_CALL_FAILURE } from "@luke/features/tasks-view";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { test } from "vitest";
import { type CommentsReader, type PlanCommentsControl, usePlanComments } from "./plan-comments.js";

/**
 * A comment whose mention could not hand the thread over: the reply posts,
 * and the thread says who could not take it. Synthetic thread.
 */

const PLAN = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

const THREAD: PlanCommentThread = {
  id: "0f9b5f6e-6a8e-4c51-9a0e-2c1f2f0b7a11",
  scope: PLAN_COMMENT_SCOPE.WORDS,
  quote: "a retry",
  anchor: { from: 20, to: 27 },
  section: "Testing",
  status: PLAN_COMMENT_STATUS.OPEN,
  createdAt: 1,
  updatedAt: 1,
  revision: 1,
  entries: [],
};

test("a reply whose mentioned agent could not take the thread posts, and its thread says the agent is not running", async () => {
  let control: PlanCommentsControl | undefined;
  function Probe() {
    control = usePlanComments({
      planId: PLAN,
      shown: false,
      readComments: async () => ({ threads: [], cursor: "c" }),
      startComment: async () => ({ thread: THREAD }),
      actOnComment: async () => ({
        thread: THREAD,
        unsent: [{ actor: PLAN_COMMENT_ACTOR.AGENT, agentId: "agent-1" }],
      }),
    });
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root.render(createElement(Probe)));

  let posted = false;
  await act(async () => {
    posted =
      (await control?.act(THREAD.id, {
        action: PLAN_COMMENT_ACTION.REPLY,
        clientKey: "key-1",
        words: "[@Agent](https://tryluke.dev/acme/plan/x/agent/agent-1) take a look",
      })) ?? false;
  });

  assert.equal(posted, true);
  assert.equal(
    control?.notes.get(THREAD.id),
    "That agent isn't running, so it couldn't take the thread.",
  );
  act(() => root.unmount());
});

test("a write's answer that lands after a later revision of its thread leaves the later one", async () => {
  let control: PlanCommentsControl | undefined;
  let answered = 0;
  function Probe() {
    control = usePlanComments({
      planId: PLAN,
      shown: false,
      readComments: async () => ({ threads: [], cursor: "c" }),
      startComment: async () => ({ thread: THREAD }),
      actOnComment: async () => {
        answered += 1;
        return { thread: { ...THREAD, revision: answered === 1 ? 3 : 2 } };
      },
    });
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root.render(createElement(Probe)));

  for (const clientKey of ["key-1", "key-2"]) {
    await act(async () => {
      await control?.act(THREAD.id, { action: PLAN_COMMENT_ACTION.REPLY, clientKey, words: "Yes" });
    });
  }

  assert.equal(control?.threads.find((thread) => thread.id === THREAD.id)?.revision, 3);
  act(() => root.unmount());
});

test("a shown plan's comments land, a read that did not answer says so, and Retry reads again at once", async () => {
  let control: PlanCommentsControl | undefined;
  const answers = [
    { threads: [THREAD], cursor: "c1" },
    { failure: PLAN_COMMENT_CALL_FAILURE.UNANSWERED },
    { threads: [], cursor: "c2" },
  ] as const;
  let reads = 0;
  function Probe() {
    control = usePlanComments({
      planId: PLAN,
      shown: true,
      readComments: () => {
        const answer = answers[reads];
        reads += 1;
        return answer === undefined
          ? Promise.withResolvers<never>().promise
          : Promise.resolve(answer);
      },
      startComment: async () => ({ thread: THREAD }),
      actOnComment: async () => ({ thread: THREAD }),
    });
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root.render(createElement(Probe)));

  assert.deepEqual(control?.threads, [THREAD]);
  assert.equal(control?.failed, true);
  assert.equal(reads, 2);

  await act(async () => control?.onRetry());
  assert.equal(control?.failed, false);
  assert.deepEqual(control?.threads, []);
  act(() => root.unmount());
});

test("a read that brings the same threads, or a second read that does not answer, hands on the control it held, and a new revision does not", async () => {
  type Answer = Awaited<ReturnType<CommentsReader>>;
  let control: PlanCommentsControl | undefined;
  const answers = Array.from({ length: 5 }, () => Promise.withResolvers<Answer>());
  let reads = 0;
  function Probe() {
    control = usePlanComments({
      planId: PLAN,
      shown: true,
      readComments: () => {
        const answer = answers[reads];
        reads += 1;
        return answer === undefined ? Promise.withResolvers<never>().promise : answer.promise;
      },
      startComment: async () => ({ thread: THREAD }),
      actOnComment: async () => ({ thread: THREAD }),
    });
    return null;
  }
  const answer = async (read: number, given: Answer) => {
    await act(async () => answers[read]?.resolve(given));
  };
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root.render(createElement(Probe)));
  await answer(0, { threads: [THREAD], cursor: "c1" });
  const first = control;
  assert.deepEqual(first?.threads, [THREAD]);

  await answer(1, { threads: [{ ...THREAD }], cursor: "c2" });
  assert.equal(control, first, "the same threads hand on the same control");

  await answer(2, { failure: PLAN_COMMENT_CALL_FAILURE.UNANSWERED });
  const missed = control;
  assert.equal(missed?.failed, true);
  // Retry reads again at once, rather than after the poll's wait.
  await act(async () => control?.onRetry());
  await answer(3, { failure: PLAN_COMMENT_CALL_FAILURE.UNANSWERED });
  assert.equal(control, missed, "a second miss hands on the same control");

  await act(async () => control?.onRetry());
  await answer(4, { threads: [{ ...THREAD, revision: 2 }], cursor: "c3" });
  assert.notEqual(control, missed);
  assert.equal(control?.threads[0]?.revision, 2);
  assert.equal(control?.failed, false);
  act(() => root.unmount());
});
