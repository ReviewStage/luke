import assert from "node:assert/strict";
import { test } from "vitest";
import { FAILURE_FACT } from "./failure-facts.js";
import {
  FAILURE_CONDITION,
  FAILURE_KIND,
  FAILURE_SURFACE,
  type ShownFailureSentry,
  sendShownFailure,
} from "./shown-failure.js";

const SIGNED_IN = "signed-in";

test.each([
  {
    shown: "offline",
    state: { online: false, account: SIGNED_IN },
    cause: FAILURE_CONDITION.UNREAD,
    line: "A failure was shown on home_tasks.read: unread",
  },
  {
    shown: "online, of a call that ended in a network fault",
    state: { online: true, account: SIGNED_IN },
    cause: {
      failure: "unanswered",
      cause: { _tag: FAILURE_FACT.HOSTED_UNANSWERED, fault: "network", errorName: "TypeError" },
    },
    line: "A failure was shown on home_tasks.read: unanswered",
  },
  {
    shown: "online, of a call that ran past its deadline",
    state: { online: true, account: SIGNED_IN },
    cause: {
      failure: "unanswered",
      cause: { _tag: FAILURE_FACT.HOSTED_UNANSWERED, errorName: "TimeoutError" },
    },
    line: "A failure was shown on home_tasks.read: unanswered",
  },
])(
  "an unexpected failure shown $shown sends a warning line and opens no issue",
  ({ state, cause, line }) => {
    const warned: string[] = [];
    const errored: string[] = [];
    const captured: Error[] = [];
    const recording: ShownFailureSentry = {
      captureException: (error) => {
        captured.push(error);
        return "event-fixture";
      },
      logger: { warn: (said) => warned.push(said), error: (said) => errored.push(said) },
      getActiveSpan: () => undefined,
      getCurrentScope: () => ({ getPropagationContext: () => ({ traceId: "trace-fixture" }) }),
    };

    const sent = sendShownFailure(recording, {
      surface: FAILURE_SURFACE.HOME_TASKS_READ,
      kind: FAILURE_KIND.UNEXPECTED,
      cause,
      about: {},
      state,
    });

    assert.deepEqual(warned, [line]);
    assert.deepEqual(errored, []);
    assert.deepEqual(captured, []);
    assert.deepEqual(sent, { traceId: "trace-fixture" });
  },
);
