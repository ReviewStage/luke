import assert from "node:assert/strict";
import { normalizeSession, SESSION_STATUS } from "@sidecar/session";
import { test } from "vitest";
import {
  maximumRecentBriefings,
  maximumVoiceContextSessions,
  type RecentBriefing,
  recentBriefingsContextText,
  sessionContextText,
} from "./standing-context.js";
import { maximumBriefingLength } from "./tools/names.js";

const OBSERVED_AT = 1_800_000_000_000;

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

test("the recent briefings read newest last under the bound, name each session by its identity, fold a briefing to one line, and hold still inside an age bucket", () => {
  const minute = 60_000;
  const briefings: RecentBriefing[] = Array.from(
    { length: maximumRecentBriefings + 2 },
    (_unused, index) => ({
      announcedAt: OBSERVED_AT - index * minute,
      session: { providerId: "conductor", providerSessionId: `session-${index}` },
      title: index === 0 ? undefined : `Chat ${index}`,
      words: index === 1 ? "Checkout's agent\nis stuck   on a failing test." : `Briefing ${index}`,
    }),
  );

  const text = recentBriefingsContextText(briefings, OBSERVED_AT + 10 * minute);
  assert.ok(text);
  const lines = text.split("\n");
  // One header, then the newest eight: the two oldest are cut, not the newest.
  assert.equal(lines.length, 1 + maximumRecentBriefings);
  assert.match(lines[0] ?? "", /^Briefings you gave the developer in the last day, newest last\./u);
  assert.equal(
    lines.at(-1),
    `- minutes ago — untitled session [provider_id=conductor provider_session_id=session-0] — "Briefing 0"`,
  );
  assert.equal(
    lines.at(-2),
    `- minutes ago — Chat 1 [provider_id=conductor provider_session_id=session-1] — "Checkout's agent is stuck on a failing test."`,
  );
  assert.equal(
    lines.some((line) => line.includes("session-9")),
    false,
  );

  // Byte-identical across ticks inside one bucket, for the roster's reason.
  assert.equal(
    recentBriefingsContextText(briefings, OBSERVED_AT + 10 * minute),
    recentBriefingsContextText(briefings, OBSERVED_AT + 40 * minute),
  );
  assert.notEqual(
    recentBriefingsContextText(briefings, OBSERVED_AT + 40 * minute),
    recentBriefingsContextText(briefings, OBSERVED_AT + 70 * minute),
  );
});

test("no briefings render no section, and a briefing's words are cut to the bound the tool announces under", () => {
  assert.equal(recentBriefingsContextText([], OBSERVED_AT), undefined);
  const text = recentBriefingsContextText(
    [
      {
        announcedAt: OBSERVED_AT,
        session: { providerId: "conductor", providerSessionId: "s" },
        title: "Long",
        words: "x".repeat(maximumBriefingLength + 40),
      },
    ],
    OBSERVED_AT,
  );
  assert.ok(text);
  assert.ok(text.endsWith(`"${"x".repeat(maximumBriefingLength)}"`));
});
