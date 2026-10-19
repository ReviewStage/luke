import assert from "node:assert/strict";
import { CHAT_TARGET_SIGIL } from "@luke/features/chat-wire";
import { test } from "vitest";
import {
  type ChatTarget,
  chatMentionAt,
  chatRows,
  chooseTarget,
  matchingTargets,
} from "./chat-mention.js";

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
  const member = CHAT_TARGET_SIGIL.MEMBER;
  assert.deepEqual(
    chooseTarget(text, mention, { sigil: member, name: "agent-2", detail: undefined }),
    {
      text: "ask @agent-2 about it",
      caret: 13,
    },
  );
  const end = chatMentionAt("see #te", 7);
  assert.ok(end);
  const channel = {
    sigil: CHAT_TARGET_SIGIL.CHANNEL,
    name: "teammate-invitations",
    detail: undefined,
  };
  assert.deepEqual(chooseTarget("see #te", end, channel), {
    text: "see #teammate-invitations ",
    caret: 26,
  });
});

/** Monday, October 19, 2026, at noon in UTC. */
const MONDAY_NOON = Date.parse("2026-10-19T12:00:00Z");

/** What an `@` word reported with `query` lists, each row's name and detail. */
function listedFor(query: string): string[] {
  const mention = { sigil: CHAT_TARGET_SIGIL.MEMBER, start: 0, query };
  return chatRows([], mention, MONDAY_NOON, "UTC").map((row) => `${row.name} | ${row.detail}`);
}

test("words after an @ that read as a date list it, across words, and prose after a handle lists nothing", () => {
  assert.deepEqual(
    [
      "tomorrow",
      "next fri",
      "oct 20 to 24",
      "Tomorrow",
      "agent-1 please look",
      "agent-1 tomorrow",
      "to",
    ].map(listedFor),
    [
      ["Tomorrow | Oct 20, 2026"],
      ["Oct 30 | Oct 30, 2026"],
      ["Tomorrow → Saturday | Oct 20, 2026 → Oct 24, 2026"],
      ["Tomorrow | Oct 20, 2026"],
      [],
      [],
      [],
    ],
  );
});

test("an @ word that reads as a date lists the date first, then the members it matches as before", () => {
  const listed = (text: string) => {
    const mention = chatMentionAt(text, text.length);
    assert.ok(mention, `no mention in ${text}`);
    const frida = { sigil: CHAT_TARGET_SIGIL.MEMBER, name: "frida", detail: undefined };
    return chatRows([...TARGETS, frida], mention, MONDAY_NOON, "UTC").map((target) => target.name);
  };
  assert.deepEqual(listed("@fri"), ["Friday", "frida"]);
  assert.deepEqual(listed("@a"), ["agent-1", "agent-2", "maria", "frida"]);
  assert.deepEqual(listed("#tomorrow"), []);
});

test("choosing a date writes its link with the date in full over the words typed, a space after it and the caret past the space", () => {
  const text = "out @tomorrow sorry";
  const mention = chatMentionAt(text, 13);
  assert.ok(mention);
  const [date] = chatRows([], mention, MONDAY_NOON, "UTC");
  assert.ok(date);
  const written = "[@Oct 20, 2026](luke://date/2026-10-20)";
  assert.deepEqual(chooseTarget(text, mention, date), {
    text: `out ${written} sorry`,
    caret: 4 + written.length + 1,
  });
});
