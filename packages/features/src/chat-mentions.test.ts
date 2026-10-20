import assert from "node:assert/strict";
import { test } from "vitest";
import { chatMentionsIn, chatTargetMember, withoutMemberLinks } from "./chat-mentions.js";
import { encodeMention, MENTION_KIND } from "./mention-link.js";

/**
 * chat-mentions.test.ts -- whom a chat message's words name as mention links, and the member a post's `to` names.
 */

const PLACE = { workspace: "acme", repository: null } as const;
const USER = "user-1";
const AGENT = "11111111-2222-4333-8444-555555555555";
const TASK = "66666666-7777-4888-9999-aaaaaaaaaaaa";

const person = `[@Ada Lovelace](${encodeMention({ kind: MENTION_KIND.PERSON, userId: USER }, PLACE)})`;
const agent = `[@Invite emails](${encodeMention({ kind: MENTION_KIND.AGENT, agentId: AGENT }, PLACE)})`;
const luke = `[@Luke](${encodeMention({ kind: MENTION_KIND.LUKE, taskId: TASK }, PLACE)})`;
const task = `[@Teammate invitations](${encodeMention({ kind: MENTION_KIND.TASK, taskId: TASK }, PLACE)})`;

test("a message names the people, agents, and Lukes its links write, and an @word outside any link names no one", () => {
  const read = chatMentionsIn(`${person} and ${agent}, ask ${luke} and @maria about ${task}`);
  assert.deepEqual(
    read.members.map(({ mention, label }) => [mention.kind, label]),
    [
      [MENTION_KIND.PERSON, "@Ada Lovelace"],
      [MENTION_KIND.AGENT, "@Invite emails"],
      [MENTION_KIND.LUKE, "@Luke"],
    ],
  );
});

test("a `to` names the member its mention link names, written whole or as its address, and nothing for a channel, a task, or a handle", () => {
  const address = encodeMention({ kind: MENTION_KIND.PERSON, userId: USER }, PLACE);
  assert.deepEqual(chatTargetMember(person), { kind: MENTION_KIND.PERSON, userId: USER });
  assert.deepEqual(chatTargetMember(address), { kind: MENTION_KIND.PERSON, userId: USER });
  assert.deepEqual(chatTargetMember(luke), { kind: MENTION_KIND.LUKE, taskId: TASK });
  assert.equal(chatTargetMember(task), undefined);
  assert.equal(chatTargetMember("#general"), undefined);
  assert.equal(chatTargetMember("@agent-2"), undefined);
  assert.equal(chatTargetMember(`${person} and more`), undefined);
});

test("a member named after many references is still read, however many references come first", () => {
  const references = Array.from({ length: 25 }, () => task).join(" ");
  const read = chatMentionsIn(`${references} and ${person}`);
  assert.deepEqual(
    read.members.map(({ mention }) => mention.kind),
    [MENTION_KIND.PERSON],
  );
});

test("a member's link is written as its name alone, its address written bare too, and a link to anything else stays as written", () => {
  assert.equal(
    withoutMemberLinks(`${person}, ${agent} and ${luke}: see ${task}`),
    `@Ada Lovelace, @Invite emails and @Luke: see ${task}`,
  );
  const bare = encodeMention({ kind: MENTION_KIND.PERSON, userId: USER }, PLACE);
  const plan = encodeMention({ kind: MENTION_KIND.TASK, taskId: TASK }, PLACE);
  assert.equal(withoutMemberLinks(`ask ${bare} about ${plan}`), `ask @Person about ${plan}`);
});
