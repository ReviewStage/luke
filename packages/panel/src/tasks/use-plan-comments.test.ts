// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  PLAN_COMMENT_ACTION,
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_SCOPE,
  PLAN_COMMENT_STATUS,
  type PlanCommentThread,
} from "@repo/features/plan-comment-wire";
import { TASKS_ACT_KIND } from "@repo/host/contract";
import type { PlanCommentsControl } from "@repo/ui/plan-comments";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { test } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { handHostReads } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { usePlanComments } from "./use-plan-comments.js";

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
  fakeAppBridge({});
  handHostReads({});
  fakeActPort({
    [TASKS_ACT_KIND.TASKS_COMMENT_ACT]: async () => ({
      thread: THREAD,
      unsent: [{ actor: PLAN_COMMENT_ACTOR.AGENT, agentId: "agent-1" }],
    }),
  });
  let control: PlanCommentsControl | undefined;
  const subject = { taskId: PLAN };
  function Probe() {
    control = usePlanComments(subject);
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root.render(onRegistry(AtomRegistry.make(), createElement(Probe))));

  let posted = false;
  await act(async () => {
    posted =
      (await control?.act(THREAD.id, {
        action: PLAN_COMMENT_ACTION.REPLY,
        clientKey: "key-1",
        words: "[@Agent](https://vespin.dev/acme/plan/x/agent/agent-1) take a look",
      })) ?? false;
  });

  assert.equal(posted, true);
  assert.equal(
    control?.notes.get(THREAD.id),
    "That agent isn't running, so it couldn't take the thread.",
  );
  act(() => root.unmount());
});
