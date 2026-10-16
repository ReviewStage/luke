import assert from "node:assert/strict";
import { CHAT_TARGET_SIGIL } from "@luke/features/chat-wire";
import { test } from "vitest";
import { type ChatTarget, chatMentionAt, chooseTarget, matchingTargets } from "./chat-mention";

const TARGETS: readonly ChatTarget[] = [
  { sigil: CHAT_TARGET_SIGIL.MEMBER, name: "maria", detail: undefined },
  { sigil: CHAT_TARGET_SIGIL.MEMBER, name: "agent-1", detail: "Add teammate invitations" },
  { sigil: CHAT_TARGET_SIGIL.MEMBER, name: "luke", detail: "Luke" },
  { sigil: CHAT_TARGET_SIGIL.MEMBER, name: "agent-2", detail: "Invite emails" },
  {
    sigil: CHAT_TARGET_SIGIL.CHANNEL,
    name: "teammate-invitations",
    detail: "Teammate invitations",
  },
  { sigil: CHAT_TARGET_SIGIL.CHANNEL, name: "general", detail: undefined },
];

/** What the composer opens on with the caret at the end of the words: the sigil and the letters after it, or nothing. */
function openedAt(text: string): string | undefined {
  const mention = chatMentionAt(text, text.length);
  return mention === undefined ? undefined : `${mention.sigil}${mention.query}@${mention.start}`;
}

test("an @ or a # opens the list only where it starts a word outside code, a dot read as a channel's and never a handle's", () => {
  assert.deepEqual(
    [
      "@",
      "ask @age",
      "see #gen",
      "see #v1.2",
      "ask @a.b",
      "dev@example.com",
      "a#b",
      "`@agent`",
      "```\n@agent",
      "@agent-1 done",
    ].map(openedAt),
    [
      "@@0",
      "@age@4",
      "#gen@4",
      "#v1.2@4",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ],
  );
});

test("the list stays shut on a word longer than a handle or a channel's name may be", () => {
  const handle = "a".repeat(40);
  const name = "b".repeat(80);
  assert.deepEqual(
    [`@${handle}`, `@${handle}a`, `#${name}`, `#${name}b`].map(
      (text) => openedAt(text) !== undefined,
    ),
    [true, false, true, false],
  );
});

test("the list offers the sigil's targets whose name starts with what is typed first, then whose name holds it, then whose detail does", () => {
  const offered = (text: string) => {
    const mention = chatMentionAt(text, text.length);
    assert.ok(mention, `no mention in ${text}`);
    return matchingTargets(TARGETS, mention).map((target) => target.name);
  };
  assert.deepEqual(offered("@"), ["maria", "agent-1", "luke", "agent-2"]);
  assert.deepEqual(offered("@a"), ["agent-1", "agent-2", "maria"]);
  assert.deepEqual(offered("@email"), ["agent-2"]);
  assert.deepEqual(offered("#invit"), ["teammate-invitations"]);
});

test("choosing a target writes it over the word typed, with a space after it and the caret past the space", () => {
  const text = "ask @ag about it";
  const mention = chatMentionAt(text, 7);
  assert.ok(mention);
  assert.deepEqual(chooseTarget(text, mention, "agent-2"), {
    text: "ask @agent-2 about it",
    caret: 13,
  });
  const end = chatMentionAt("see #te", 7);
  assert.ok(end);
  assert.deepEqual(chooseTarget("see #te", end, "teammate-invitations"), {
    text: "see #teammate-invitations ",
    caret: 26,
  });
});
