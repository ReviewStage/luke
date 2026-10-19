import assert from "node:assert/strict";
import { test } from "vitest";
import { chatMentionsIn, chatWordsForAgents } from "./chat-mentions.js";
import { encodeMention, MENTION_KIND } from "./mention-link.js";

/**
 * chat-mentions.test.ts -- whom a chat message's words name, as links and as handles, and the words an agent reads back.
 */

const PLACE = { workspace: "acme", repository: null } as const;
const USER = "user-1";
const AGENT = "11111111-2222-4333-8444-555555555555";
const TASK = "66666666-7777-4888-9999-aaaaaaaaaaaa";

const person = `[@Ada Lovelace](${encodeMention({ kind: MENTION_KIND.PERSON, userId: USER }, PLACE)})`;
const agent = `[@Invite emails](${encodeMention({ kind: MENTION_KIND.AGENT, agentId: AGENT }, PLACE)})`;
const luke = `[@Luke](${encodeMention({ kind: MENTION_KIND.LUKE, taskId: TASK }, PLACE)})`;
const task = `[@Teammate invitations](${encodeMention({ kind: MENTION_KIND.TASK, taskId: TASK }, PLACE)})`;

test("a message names the people, agents, and Lukes its links write, and the handles typed outside any link, never a link's label read as a handle", () => {
  const read = chatMentionsIn(`${person} and ${agent}, ask ${luke} and @maria about ${task}`);
  assert.deepEqual(
    read.members.map(({ mention, label }) => [mention.kind, label]),
    [
      [MENTION_KIND.PERSON, "@Ada Lovelace"],
      [MENTION_KIND.AGENT, "@Invite emails"],
      [MENTION_KIND.LUKE, "@Luke"],
    ],
  );
  assert.deepEqual(read.handles, ["maria"]);
});

test("an agent reads each member's link as its @handle, a link to no member as its label, and any other link as written", () => {
  const words = chatWordsForAgents(`${person}, ${agent}, ${luke}: see ${task}`, (mention) =>
    mention.kind === MENTION_KIND.AGENT
      ? "agent-2"
      : mention.kind === MENTION_KIND.LUKE
        ? "luke"
        : undefined,
  );
  assert.equal(words, `@Ada Lovelace, @agent-2, @luke: see ${task}`);
});

test("a member named after many references is still read, however many references come first", () => {
  const references = Array.from({ length: 25 }, () => task).join(" ");
  const read = chatMentionsIn(`${references} and ${person}`);
  assert.deepEqual(
    read.members.map(({ mention }) => mention.kind),
    [MENTION_KIND.PERSON],
  );
  assert.equal(
    chatWordsForAgents(`${references} and ${person}`, () => "ada"),
    `${references} and @ada`,
  );
});
