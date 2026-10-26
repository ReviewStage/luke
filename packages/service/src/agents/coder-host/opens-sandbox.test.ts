import assert from "node:assert/strict";
import type { WireRecord } from "@luke/wire";
import { test } from "vitest";
import { stampedEveEvent } from "../../testing/eve-events.js";
import { CODER_TOOL, opensSandbox } from "./tool-set.js";

/** A step's request for one call of the tool given, as eve emits it. */
function requested(toolName: string, input: WireRecord): Parameters<typeof opensSandbox>[0] {
  return stampedEveEvent(
    {
      type: "actions.requested",
      data: {
        turnId: "turn_0",
        sequence: 0,
        stepIndex: 0,
        actions: [{ kind: "tool-call", callId: "call-1", toolName, input }],
      },
    },
    Date.UTC(2026, 9, 14),
  );
}

test("a thread post opens the sandbox only where its body draws a picture from a file there, by a path naming no scheme", () => {
  const post = (body: string) => ({
    key: "landing",
    title: "Does the landing page read right?",
    body,
  });
  const opens = (body: string) => opensSandbox(requested(CODER_TOOL.POST_THREAD, post(body)));
  assert.equal(opens('The hero:\n\n![The landing page](shots/landing.png "Hero")'), true);
  assert.equal(opens("![The form](</workspace/repository/shot one.png>)"), true);
  assert.equal(opens("The hero reads **Plan by voice**."), false);
  assert.equal(opens("![Kept](https://tryluke.dev/acme/plan/p1/inbox/i1/files/f1)"), false);
  assert.equal(opens("Write `![alt](shot.png)` for a picture."), false);
  assert.equal(opens("[a link](shots/landing.png)"), false);
});

test("a browser call opens the sandbox its browser runs in, so a turn of browser calls alone stops it at its end", () => {
  assert.equal(
    opensSandbox(
      requested(CODER_TOOL.BROWSER, {
        actions: [{ action: "open", url: "http://localhost:3000/" }],
      }),
    ),
    true,
  );
});
