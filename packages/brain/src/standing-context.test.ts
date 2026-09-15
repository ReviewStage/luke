import assert from "node:assert/strict";
import { normalizeSession, SESSION_STATUS } from "@sidecar/session";
import { test } from "vitest";
import {
  CONTEXT_ITEM_KIND,
  contextItemId,
  maximumVoiceContextSessions,
  sessionContextText,
} from "./standing-context.js";

const OBSERVED_AT = 1_800_000_000_000;

test("a context item is named apart from every other", () => {
  const first = contextItemId(CONTEXT_ITEM_KIND.SESSIONS, 1);

  // The sequence rises rather than the name being reused: a delete that failed
  // would otherwise leave the old item sitting under the new one's name.
  assert.notEqual(first, contextItemId(CONTEXT_ITEM_KIND.SESSIONS, 2));
  assert.notEqual(first, contextItemId(CONTEXT_ITEM_KIND.WORKSPACE_PROJECTS, 1));
});

test("the roster text holds still across clock ticks inside one age bucket and moves at its edge", () => {
  const minute = 60_000;
  const lastActivityAt = OBSERVED_AT;
  const session = normalizeSession(
    { id: "claude-code", displayName: "Claude Code" },
    {
      providerSessionId: "session-a",
      title: "Bootstrap the desktop shell",
      status: SESSION_STATUS.WORKING,
      lastActivityAt,
    },
  );

  // Byte-identical, not merely similar: the roster is re-sent only when its
  // text changes, and text that moved with every minute tick would invalidate
  // the conversation's cached prefix with nothing new to say.
  assert.equal(
    sessionContextText([session], lastActivityAt + 10 * minute),
    sessionContextText([session], lastActivityAt + 45 * minute),
  );
  assert.notEqual(
    sessionContextText([session], lastActivityAt + 45 * minute),
    sessionContextText([session], lastActivityAt + 65 * minute),
  );
});

test("session context stays bounded when many sessions are observed", () => {
  const sessions = Array.from({ length: maximumVoiceContextSessions + 5 }, (_unused, index) =>
    normalizeSession(
      { id: "codex", displayName: "Codex" },
      {
        providerSessionId: `session-${index}`,
        title: `Codex: workspace-${index}`,
        status: SESSION_STATUS.WORKING,
        lastActivityAt: OBSERVED_AT,
      },
    ),
  );

  const lines = sessionContextText(sessions).split("\n").slice(1);

  // The bound holds, and what it cut is said: a session past it must read as
  // unlisted, never as nonexistent.
  assert.equal(lines.length, maximumVoiceContextSessions + 1);

  const exactlyAtBound = sessionContextText(sessions.slice(0, maximumVoiceContextSessions))
    .split("\n")
    .slice(1);
  assert.equal(exactlyAtBound.length, maximumVoiceContextSessions);
});
