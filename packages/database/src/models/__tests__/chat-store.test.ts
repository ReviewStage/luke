import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  ASK_STATUS,
  CHANNEL_KIND,
  CHAT_ASK,
  CHAT_BLOCK,
  CHAT_BOUNDS,
  CHAT_IMAGE_TYPE,
  CHAT_REPLY,
  MEMBER_KIND,
} from "@luke/features/chat-wire";
import { and, eq } from "drizzle-orm";
import { DateTime, Effect, Option, Result } from "effect";
import { Database } from "../../core/query.js";
import { attachment } from "../../schemas/attachment.js";
import { member, organization, user } from "../../schemas/auth.js";
import { chatAttachment, chatMessage, workspaceChat } from "../../schemas/chat.js";
import { codingAgent } from "../../schemas/coding-agent.js";
import { getTestDB } from "../../testing/index.js";
import {
  agentWorkspace,
  answerAsk,
  attachMessageImages,
  CHAT_REFUSAL,
  type ChatImageWrite,
  type ChatMemberRow,
  type ChatPost,
  channelNamed,
  channelOf,
  channelReads,
  channelsOf,
  chatHead,
  chatPast,
  ensureGeneral,
  ensureMember,
  ensureTaskChannel,
  findOrMakeDm,
  history,
  leave,
  markNoticed,
  memberNamed,
  messageAt,
  moveTaskChat,
  openAsksOf,
  openTopicChannel,
  peekUnread,
  postAsk,
  postMessage,
  readAllTo,
  readAttachment,
  readThrough,
  readTo,
  releaseNotice,
  resolveAsk,
  roster,
  seqsOf,
  threadAuthors,
  unreadCounts,
  unreadFor,
  waitingOn,
  waitingStamps,
  withdrawAnswer,
} from "../chat-store.js";
import { createCodingAgent } from "../coding-agent-store.js";
import { createTask, updateTask } from "../task-store.js";

/**
 * A workspace's chat members and channels, over a real dialect: a member
 * minted once under its workspace's lock with a handle it keeps, a channel
 * found or made by what names it, and nothing of a workspace the account
 * is not in.
 *
 * Synthetic accounts, workspaces, plans, and agents throughout.
 */

const openAccount = (name = "Test User") =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id, name, email: `${id}@luke.test` });
    return id;
  });

/** A workspace the account owns, as the organization plugin would leave the rows. */
const openWorkspace = (ownerId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const organizationId = randomUUID();
    const now = yield* DateTime.nowAsDate;
    yield* db.insert(organization).values({
      id: organizationId,
      name: "Test Workspace",
      slug: `workspace-${organizationId}`,
      createdAt: now,
    });
    yield* joinWorkspace(organizationId, ownerId, "owner");
    return organizationId;
  });

const joinWorkspace = (organizationId: string, userId: string, role = "member") =>
  Effect.gen(function* () {
    const db = yield* Database;
    const now = yield* DateTime.nowAsDate;
    yield* db
      .insert(member)
      .values({ id: randomUUID(), organizationId, userId, role, createdAt: now });
  });

const openTask = (userId: string, organizationId: string, name = "Billing export") =>
  Effect.map(
    createTask(userId, { organizationId, name, repository: "acme/api" }),
    (made) => made.id,
  );

const openAgent = (userId: string, taskId: string) =>
  Effect.gen(function* () {
    const started = yield* createCodingAgent(userId, {
      taskId,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      planSnapshot: "# Billing export\n",
      prompt: null,
      repository: "acme/api",
    });
    return Option.getOrThrow(started).agent.id;
  });

it.layer(getTestDB())("the chat store's members and channels", (it) => {
  it.effect(
    "a member is minted once and keeps its handle: a person by their name, a clash or a spoken-for handle stepped past, an agent as agent-N, every task's Luke as luke, and concurrent mints of one subject one member",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount("Ada Lovelace");
        const namesake = yield* openAccount("Ada  Lovelace!");
        const luke = yield* openAccount("Luke");
        const numbered = yield* openAccount("Agent 1");
        const nameless = yield* openAccount("42 ✨");
        const workspace = yield* openWorkspace(owner);
        for (const teammate of [namesake, luke, numbered, nameless]) {
          yield* joinWorkspace(workspace, teammate);
        }
        const task = yield* openTask(owner, workspace);
        const otherTask = yield* openTask(owner, workspace, "Invites");
        const first = yield* openAgent(owner, task);
        const second = yield* openAgent(owner, task);
        const mint = (subject: Parameters<typeof ensureMember>[2]) =>
          Effect.map(ensureMember(owner, workspace, subject), Option.getOrThrow);

        // One agent minted five times at once is one member; two agents at once are two.
        const racing = yield* Effect.all(
          [
            ...Array.from({ length: 5 }, () => mint({ kind: MEMBER_KIND.AGENT, agentId: first })),
            mint({ kind: MEMBER_KIND.AGENT, agentId: second }),
          ],
          { concurrency: "unbounded" },
        );
        assert.equal(new Set(racing.slice(0, 5).map((row) => row.id)).size, 1);
        assert.deepEqual(
          racing.map((row) => row.handle).toSorted(),
          ["agent-1", "agent-1", "agent-1", "agent-1", "agent-1", "agent-2"].toSorted(),
        );

        const people = yield* Effect.forEach(
          [owner, namesake, luke, numbered, nameless],
          (userId) => mint({ kind: MEMBER_KIND.HUMAN, userId }),
        );
        assert.deepEqual(
          people.map((row) => row.handle),
          ["ada-lovelace", "ada-lovelace-2", "luke-2", "agent-1-2", "member"],
        );
        const lukes = yield* Effect.forEach([task, otherTask], (taskId) =>
          mint({ kind: MEMBER_KIND.LUKE, taskId }),
        );
        assert.deepEqual(
          lukes.map((row) => row.handle),
          ["luke", "luke"],
        );
        assert.notEqual(lukes[0]?.id, lukes[1]?.id);

        // Asked again, every member answers as it was minted.
        const again = yield* mint({ kind: MEMBER_KIND.HUMAN, userId: namesake });
        assert.deepEqual([again.id, again.handle], [people[1]?.id, "ada-lovelace-2"]);
        assert.equal((yield* roster(namesake, workspace)).length, 9);
      }),
  );

  it.effect(
    "a plan's channel is one per plan, named from the plan past any name already held, and the general channel one per workspace",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount();
        const workspace = yield* openWorkspace(owner);
        const billing = yield* openTask(owner, workspace, "Billing export");
        const again = yield* openTask(owner, workspace, "Billing  Export");
        const general = yield* openTask(owner, workspace, "General");
        const unnamed = yield* openTask(owner, workspace, "✨");

        const channel = (taskId: string) =>
          Effect.map(ensureTaskChannel(owner, taskId), Option.getOrThrow);
        const first = yield* channel(billing);
        assert.equal((yield* channel(billing)).id, first.id);
        const names = yield* Effect.forEach([billing, again, general, unnamed], (taskId) =>
          Effect.map(channel(taskId), (row) => [row.kind, row.name, row.taskId]),
        );
        assert.deepEqual(names, [
          [CHANNEL_KIND.TASK, "billing-export", billing],
          [CHANNEL_KIND.TASK, "billing-export-2", again],
          [CHANNEL_KIND.TASK, "general-2", general],
          [CHANNEL_KIND.TASK, "plan", unnamed],
        ]);

        const room = Option.getOrThrow(yield* ensureGeneral(owner, workspace));
        assert.equal(Option.getOrThrow(yield* ensureGeneral(owner, workspace)).id, room.id);
        assert.deepEqual([room.kind, room.name], [CHANNEL_KIND.GENERAL, "general"]);
        assert.equal((yield* channelsOf(owner, workspace)).length, 5);
      }),
  );

  it.effect(
    "a DM is found by its pair whichever member asks, and a member with itself or with a member of another workspace has none",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount();
        const teammate = yield* openAccount();
        const workspace = yield* openWorkspace(owner);
        const elsewhere = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate);
        const task = yield* openTask(owner, workspace);
        const agent = Option.getOrThrow(
          yield* ensureMember(owner, workspace, {
            kind: MEMBER_KIND.AGENT,
            agentId: yield* openAgent(owner, task),
          }),
        );
        const person = Option.getOrThrow(
          yield* ensureMember(owner, workspace, { kind: MEMBER_KIND.HUMAN, userId: teammate }),
        );
        const outsider = Option.getOrThrow(
          yield* ensureMember(owner, elsewhere, { kind: MEMBER_KIND.HUMAN, userId: owner }),
        );

        const dm = Option.getOrThrow(yield* findOrMakeDm(owner, workspace, agent.id, person.id));
        const back = Option.getOrThrow(
          yield* findOrMakeDm(teammate, workspace, person.id, agent.id),
        );
        assert.equal(back.id, dm.id);
        assert.equal(dm.kind, CHANNEL_KIND.DM);
        assert.deepEqual([dm.dmAMemberId, dm.dmBMemberId], [agent.id, person.id].toSorted());
        assert.deepEqual(yield* findOrMakeDm(owner, workspace, agent.id, agent.id), Option.none());
        assert.deepEqual(
          yield* findOrMakeDm(owner, workspace, agent.id, outsider.id),
          Option.none(),
        );
      }),
  );

  it.effect(
    "a topic channel is opened once under its name, a name another kind holds is refused, and no more open than the bound",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount();
        const workspace = yield* openWorkspace(owner);
        const opener = Option.getOrThrow(
          yield* ensureMember(owner, workspace, { kind: MEMBER_KIND.HUMAN, userId: owner }),
        );
        yield* ensureGeneral(owner, workspace);
        const open = (name: string) => openTopicChannel(owner, workspace, name, opener.id);

        const contracts = yield* open("api-contracts");
        assert.ok(Result.isSuccess(contracts));
        assert.equal(contracts.success.createdByMemberId, opener.id);
        assert.deepEqual(yield* open("api-contracts"), contracts);
        assert.deepEqual(yield* open("general"), Result.fail(CHAT_REFUSAL.NAME_TAKEN));
        for (let topic = 1; topic < CHAT_BOUNDS.MAX_TOPIC_CHANNELS; topic += 1) {
          assert.ok(Result.isSuccess(yield* open(`topic-${topic}`)));
        }
        assert.deepEqual(yield* open("one-too-many"), Result.fail(CHAT_REFUSAL.TOO_MANY_TOPICS));
      }),
  );

  it.effect(
    "an account not in the workspace reads and makes nothing of it, and a second workspace's roster holds none of the first's members",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount();
        const stranger = yield* openAccount();
        const workspace = yield* openWorkspace(owner);
        const second = yield* openWorkspace(stranger);
        const task = yield* openTask(owner, workspace);
        const agentId = yield* openAgent(owner, task);
        const person = Option.getOrThrow(
          yield* ensureMember(owner, workspace, { kind: MEMBER_KIND.HUMAN, userId: owner }),
        );
        yield* ensureTaskChannel(owner, task);

        assert.deepEqual(yield* roster(stranger, workspace), []);
        assert.deepEqual(yield* channelsOf(stranger, workspace), []);
        assert.deepEqual(yield* ensureTaskChannel(stranger, task), Option.none());
        assert.deepEqual(yield* ensureGeneral(stranger, workspace), Option.none());
        assert.deepEqual(
          yield* ensureMember(stranger, workspace, { kind: MEMBER_KIND.HUMAN, userId: stranger }),
          Option.none(),
        );
        // A workspace's own member cannot mint into it what belongs to another workspace.
        assert.deepEqual(
          yield* ensureMember(stranger, second, { kind: MEMBER_KIND.AGENT, agentId }),
          Option.none(),
        );
        assert.deepEqual(
          yield* ensureMember(owner, workspace, { kind: MEMBER_KIND.HUMAN, userId: stranger }),
          Option.none(),
        );
        assert.equal(yield* leave(stranger, workspace, person.id), false);
        yield* ensureMember(stranger, second, { kind: MEMBER_KIND.HUMAN, userId: stranger });
        assert.deepEqual(
          (yield* roster(stranger, second)).map((row) => row.userId),
          [stranger],
        );
      }),
  );

  it.effect("a member is stamped as having left once, and stays on the roster", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount();
      const workspace = yield* openWorkspace(owner);
      const task = yield* openTask(owner, workspace);
      const agent = Option.getOrThrow(
        yield* ensureMember(owner, workspace, {
          kind: MEMBER_KIND.AGENT,
          agentId: yield* openAgent(owner, task),
        }),
      );
      assert.equal(yield* leave(owner, workspace, agent.id), true);
      assert.equal(yield* leave(owner, workspace, agent.id), false);
      const [listed] = yield* roster(owner, workspace);
      assert.equal(listed?.id, agent.id);
      assert.notEqual(listed?.leftAt, null);
    }),
  );

  it.effect(
    "the general channel's name is never a topic's, a person who left the workspace is no member, a person is never stamped as having left, and an account acts as no other person's member",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount();
        const teammate = yield* openAccount();
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate);
        const mint = (userId: string) =>
          Effect.map(
            ensureMember(owner, workspace, { kind: MEMBER_KIND.HUMAN, userId }),
            Option.getOrThrow,
          );
        const ada = yield* mint(owner);
        const grace = yield* mint(teammate);

        assert.deepEqual(
          yield* openTopicChannel(owner, workspace, "general", ada.id),
          Result.fail(CHAT_REFUSAL.NAME_TAKEN),
        );
        const room = Option.getOrThrow(yield* ensureGeneral(owner, workspace));
        assert.equal(room.kind, CHANNEL_KIND.GENERAL);

        assert.deepEqual(
          yield* openTopicChannel(teammate, workspace, "launch", ada.id),
          Result.fail(CHAT_REFUSAL.NOT_FOUND),
        );
        assert.deepEqual(yield* findOrMakeDm(teammate, workspace, ada.id, grace.id), Option.none());
        assert.equal(yield* leave(owner, workspace, grace.id), false);

        const db = yield* Database;
        yield* db
          .delete(member)
          .where(and(eq(member.organizationId, workspace), eq(member.userId, teammate)));
        assert.deepEqual(
          yield* ensureMember(owner, workspace, { kind: MEMBER_KIND.HUMAN, userId: teammate }),
          Option.none(),
        );
        assert.deepEqual(
          (yield* roster(owner, workspace)).map((row) => row.id),
          [ada.id, grace.id],
        );
      }),
  );

  it.effect(
    "a plan's channel is archived with its plan and opened again when the plan comes back, and one made for an archived plan is made archived",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount("Ada Lovelace");
        const workspace = yield* openWorkspace(owner);
        const task = yield* openTask(owner, workspace);
        const channel = () =>
          Effect.map(ensureTaskChannel(owner, task), (row) => Option.getOrThrow(row).archivedAt);
        assert.equal(yield* channel(), null);
        yield* updateTask(owner, task, { archived: true });
        assert.notEqual(yield* channel(), null);
        yield* updateTask(owner, task, { archived: false });
        assert.equal(yield* channel(), null);

        const shelved = yield* openTask(owner, workspace, "Old export");
        yield* updateTask(owner, shelved, { archived: true });
        const made = Option.getOrThrow(yield* ensureTaskChannel(owner, shelved));
        assert.notEqual(made.archivedAt, null);
      }),
  );

  it.effect("no DM is opened with a member that left, from either side", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount("Ada Lovelace");
      const workspace = yield* openWorkspace(owner);
      const task = yield* openTask(owner, workspace);
      const mint = (subject: Parameters<typeof ensureMember>[2]) =>
        Effect.map(ensureMember(owner, workspace, subject), Option.getOrThrow);
      const ada = yield* mint({ kind: MEMBER_KIND.HUMAN, userId: owner });
      const agent = yield* mint({
        kind: MEMBER_KIND.AGENT,
        agentId: yield* openAgent(owner, task),
      });
      assert.ok(Option.isSome(yield* findOrMakeDm(owner, workspace, ada.id, agent.id)));
      const gone = yield* mint({ kind: MEMBER_KIND.AGENT, agentId: yield* openAgent(owner, task) });
      yield* leave(owner, workspace, gone.id);
      assert.deepEqual(yield* findOrMakeDm(owner, workspace, ada.id, gone.id), Option.none());
      assert.deepEqual(yield* findOrMakeDm(owner, workspace, gone.id, ada.id), Option.none());
    }),
  );
});

/** A post's words as one Markdown block. */
const words = (text: string) => [{ type: CHAT_BLOCK.MARKDOWN, text }] as const;

/**
 * A workspace with its owner, a teammate, a plan with two agents, and their
 * members, each minted as the chat mints them, and the plan's channel.
 */
const openRoom = Effect.gen(function* () {
  const owner = yield* openAccount("Ada Lovelace");
  const teammate = yield* openAccount("Grace Hopper");
  const workspace = yield* openWorkspace(owner);
  yield* joinWorkspace(workspace, teammate);
  const task = yield* openTask(owner, workspace);
  const mint = (subject: Parameters<typeof ensureMember>[2]) =>
    Effect.map(ensureMember(owner, workspace, subject), Option.getOrThrow);
  const ada = yield* mint({ kind: MEMBER_KIND.HUMAN, userId: owner });
  const grace = yield* mint({ kind: MEMBER_KIND.HUMAN, userId: teammate });
  const first = yield* mint({ kind: MEMBER_KIND.AGENT, agentId: yield* openAgent(owner, task) });
  const second = yield* mint({ kind: MEMBER_KIND.AGENT, agentId: yield* openAgent(owner, task) });
  const channel = Option.getOrThrow(yield* ensureTaskChannel(owner, task));
  /** A post by the member given, into the channel or thread given, as the account given. */
  const post = (
    author: ChatMemberRow,
    text: string,
    to: ChatPost["to"] = { channelId: channel.id },
    as = owner,
  ) =>
    postMessage(as, workspace, {
      authorMemberId: author.id,
      to,
      blocks: words(text),
      mentions: [...text.matchAll(/@([a-z][a-z0-9-]*)/gu)].map((match) => match[1] ?? ""),
      clientKey: randomUUID(),
    });
  const posted = (...args: Parameters<typeof post>) =>
    Effect.map(post(...args), (result) => Result.getOrThrow(result).message);
  return {
    owner,
    teammate,
    workspace,
    plan: task,
    ada,
    grace,
    first,
    second,
    channel,
    post,
    posted,
  };
});

/** The words of each message, in order. */
const textsOf = (messages: readonly { readonly blocks: readonly unknown[] }[]) =>
  messages.map((message) => JSON.stringify(message.blocks));

it.layer(getTestDB())("the chat store's messages, sequence, and cursors", (it) => {
  it.effect(
    "posts landing at once take contiguous places in the workspace's sequence, and one repeated under its key takes none",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const posts = yield* Effect.all(
          Array.from({ length: 10 }, (_, at) =>
            room.posted(at % 2 === 0 ? room.first : room.second, `Step ${at}.`),
          ),
          { concurrency: "unbounded" },
        );
        assert.deepEqual(
          posts.map((message) => message.seq).toSorted((a, b) => a - b),
          Array.from({ length: 10 }, (_, at) => at + 1),
        );
        assert.ok(posts.every((message) => message.touchedSeq === message.seq));

        const once = {
          authorMemberId: room.first.id,
          to: { channelId: room.channel.id },
          blocks: words("Taking the invite table."),
          mentions: [],
          clientKey: "call-1",
        };
        const sent = Result.getOrThrow(yield* postMessage(room.owner, room.workspace, once));
        const again = Result.getOrThrow(yield* postMessage(room.owner, room.workspace, once));
        assert.deepEqual([sent.message.seq, sent.repeated], [11, false]);
        assert.deepEqual([again.message.id, again.repeated], [sent.message.id, true]);
        assert.equal((yield* room.posted(room.second, "Next.")).seq, 12);
      }),
  );

  it.effect(
    "a member's unread is what others posted past its cursor, bounded, and reading moves the cursor past it",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        yield* room.posted(room.first, "One.");
        yield* room.posted(room.second, "My own.");
        yield* room.posted(room.first, "Two.");
        yield* room.posted(room.first, "Three.");
        const unread = (limit?: number) =>
          Effect.map(
            unreadFor(room.owner, room.workspace, room.second.id, { limit }),
            Option.getOrThrow,
          );

        const firstRead = yield* unread(2);
        assert.deepEqual(
          textsOf(firstRead.messages),
          textsOf([{ blocks: words("One.") }, { blocks: words("Two.") }]),
        );
        assert.equal(firstRead.more, true);
        const rest = yield* unread();
        assert.deepEqual(textsOf(rest.messages), textsOf([{ blocks: words("Three.") }]));
        assert.equal(rest.more, false);
        assert.deepEqual(yield* unread(), { messages: [], more: false });

        yield* room.posted(room.first, "Four.");
        assert.deepEqual(
          textsOf((yield* unread()).messages),
          textsOf([{ blocks: words("Four.") }]),
        );
      }),
  );

  it.effect(
    "a peek at a member's unread moves nothing, and reading through the place it named passes what it answered and nothing posted since",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        yield* room.posted(room.first, "One.");
        yield* room.posted(room.first, "Two.");
        const peek = () =>
          Effect.map(peekUnread(room.owner, room.workspace, room.second.id), Option.getOrThrow);

        const seen = yield* peek();
        assert.deepEqual(
          textsOf(seen.messages),
          textsOf([{ blocks: words("One.") }, { blocks: words("Two.") }]),
        );
        assert.deepEqual(textsOf((yield* peek()).messages), textsOf(seen.messages));

        yield* room.posted(room.first, "Three.");
        assert.equal(
          yield* readThrough(room.owner, room.workspace, room.second.id, seen.through),
          true,
        );
        assert.deepEqual(textsOf((yield* peek()).messages), textsOf([{ blocks: words("Three.") }]));
        // The cursor never moves back.
        yield* readThrough(room.owner, room.workspace, room.second.id, 0);
        assert.deepEqual(textsOf((yield* peek()).messages), textsOf([{ blocks: words("Three.") }]));

        const stranger = yield* openAccount("Stranger");
        assert.equal(
          yield* readThrough(stranger, room.workspace, room.second.id, seen.through),
          false,
        );
        assert.deepEqual(
          yield* peekUnread(stranger, room.workspace, room.second.id),
          Option.none(),
        );
      }),
  );

  it.effect(
    "a reply attaches to its thread's root, a reply to a reply included, in the root's channel, and a thread reads as its root and replies",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const root = yield* room.posted(room.first, "Who owns the invite table?");
        yield* room.posted(room.second, "Unrelated.");
        const reply = yield* room.posted(room.second, "I do.", { replyTo: root.seq });
        const nested = yield* room.posted(room.first, "Thanks.", { replyTo: reply.seq });
        assert.deepEqual(
          [reply.parentId, nested.parentId, nested.channelId],
          [root.id, root.id, room.channel.id],
        );
        const thread = Option.getOrThrow(
          yield* history(room.owner, room.workspace, room.ada.id, { thread: root.seq }),
        );
        assert.deepEqual(
          thread.map((message) => message.id),
          [root.id, reply.id, nested.id],
        );
        assert.deepEqual(
          yield* room.post(room.first, "Into nothing.", { replyTo: 999 }),
          Result.fail(CHAT_REFUSAL.NOT_FOUND),
        );
        const page = Option.getOrThrow(
          yield* history(room.owner, room.workspace, room.ada.id, {
            channelId: room.channel.id,
            before: nested.seq,
            limit: 2,
          }),
        );
        assert.deepEqual(
          page.map((message) => message.seq),
          [root.seq + 1, reply.seq],
        );
      }),
  );

  it.effect(
    "a window's read answers what was posted or changed past its cursor and the cursor to read on from, which a change moves past",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const past = (after: number) =>
          Effect.map(chatPast(room.owner, room.workspace, room.ada.id, after), Option.getOrThrow);
        const empty = yield* past(0);
        assert.deepEqual(empty, { messages: [], cursor: 0 });
        const asked = yield* room.posted(room.first, "Which expiry?");
        yield* room.posted(room.second, "Seven days.");
        const read = yield* past(empty.cursor);
        assert.equal(read.messages.length, 2);
        assert.equal(read.cursor, 2);
        assert.deepEqual(yield* past(read.cursor), { messages: [], cursor: 2 });

        // A change moves its message to the next place, as an ask's re-post does: a reader past it reads it again.
        const db = yield* Database;
        yield* db
          .update(workspaceChat)
          .set({ nextSeq: 4 })
          .where(eq(workspaceChat.organizationId, room.workspace));
        yield* db.update(chatMessage).set({ touchedSeq: 3 }).where(eq(chatMessage.id, asked.id));
        const moved = yield* past(read.cursor);
        assert.deepEqual(
          [moved.messages.map((message) => message.id), moved.cursor],
          [[asked.id], 3],
        );
      }),
  );

  it.effect(
    "mentions resolve to members as a post lands, @luke to the task's Luke, and a handle naming no one is answered",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const sent = Result.getOrThrow(
          yield* room.post(
            room.first,
            "@agent-2 and @luke: the table is mine. cc @nobody @agent-2",
          ),
        );
        const luke = Option.getOrThrow(
          yield* memberNamed(room.owner, room.workspace, "luke", room.plan),
        );
        assert.deepEqual(sent.message.mentions, [room.second.id, luke.id]);
        assert.deepEqual(sent.unresolved, ["nobody"]);
        assert.equal(luke.kind, MEMBER_KIND.LUKE);
        assert.equal(
          Option.getOrThrow(
            yield* channelNamed(room.owner, room.workspace, room.channel.name ?? ""),
          ).id,
          room.channel.id,
        );
      }),
  );

  it.effect(
    "members named by what they are resolve as a post lands: a person and a task's Luke minted where they are not yet, an agent only where it is a member, and one naming no one answered by its label",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const unminted = yield* openAgent(room.owner, room.plan);
        const sent = Result.getOrThrow(
          yield* postMessage(room.owner, room.workspace, {
            authorMemberId: room.ada.id,
            to: { channelId: room.channel.id },
            blocks: words("Over to you."),
            mentions: [],
            subjects: [
              {
                subject: { kind: MEMBER_KIND.HUMAN, userId: room.teammate },
                label: "@Grace Hopper",
              },
              {
                subject: { kind: MEMBER_KIND.AGENT, agentId: room.second.agentId ?? "" },
                label: "@Two",
              },
              { subject: { kind: MEMBER_KIND.LUKE, taskId: room.plan }, label: "@Luke" },
              { subject: { kind: MEMBER_KIND.AGENT, agentId: unminted }, label: "@Unminted" },
            ],
            clientKey: randomUUID(),
          }),
        );
        const luke = Option.getOrThrow(
          yield* memberNamed(room.owner, room.workspace, "luke", room.plan),
        );
        assert.deepEqual(sent.message.mentions, [room.grace.id, room.second.id, luke.id]);
        assert.deepEqual(sent.unresolved, ["@Unminted"]);
      }),
  );

  it.effect(
    "every person reads every DM, one with a person in it included, an agent reads only its own, and only a DM's pair posts in it",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const third = Option.getOrThrow(
          yield* ensureMember(room.owner, room.workspace, {
            kind: MEMBER_KIND.AGENT,
            agentId: yield* openAgent(room.owner, room.plan),
          }),
        );
        const dm = (a: ChatMemberRow, b: ChatMemberRow) =>
          Effect.map(findOrMakeDm(room.owner, room.workspace, a.id, b.id), Option.getOrThrow);
        const personal = yield* dm(room.ada, room.first);
        const between = yield* dm(room.first, room.second);
        const toAda = yield* room.posted(room.first, "For Ada.", { channelId: personal.id });
        const toSecond = yield* room.posted(room.first, "For agent-2.", { channelId: between.id });
        const seen = (reader: ChatMemberRow) =>
          Effect.map(chatPast(room.owner, room.workspace, reader.id, 0), (read) =>
            Option.getOrThrow(read).messages.map((message) => message.id),
          );

        assert.deepEqual(yield* seen(room.ada), [toAda.id, toSecond.id]);
        assert.deepEqual(yield* seen(room.grace), [toAda.id, toSecond.id]);
        assert.deepEqual(yield* seen(room.second), [toSecond.id]);
        assert.deepEqual(yield* seen(third), []);
        assert.deepEqual(
          yield* room.post(room.grace, "Butting in.", { channelId: personal.id }, room.teammate),
          Result.fail(CHAT_REFUSAL.NOT_FOUND),
        );
        assert.deepEqual(
          yield* room.post(room.grace, "Steering them.", { channelId: between.id }, room.teammate),
          Result.fail(CHAT_REFUSAL.NOT_FOUND),
        );
      }),
  );

  it.effect(
    "a member is told one notice until its cursor passes it, and one who left posts nothing",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const notice = (seq: number) =>
          markNoticed(room.owner, room.workspace, room.second.id, room.channel.id, seq);
        const told = yield* room.posted(room.first, "@agent-2 ping.");
        assert.equal(yield* notice(told.seq), true);
        const again = yield* room.posted(room.first, "@agent-2 ping again.");
        assert.equal(yield* notice(again.seq), false);
        yield* unreadFor(room.owner, room.workspace, room.second.id);
        assert.equal(
          yield* notice((yield* room.posted(room.first, "@agent-2 and now?")).seq),
          true,
        );

        yield* leave(room.owner, room.workspace, room.first.id);
        assert.deepEqual(
          yield* room.post(room.first, "Still here?"),
          Result.fail(CHAT_REFUSAL.AUTHOR_LEFT),
        );
      }),
  );

  it.effect(
    "a message is read at its place by a reader who sees it, and a person's cursor moves on to a place, never back or past the head, letting go of the notice it passes",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const posted = yield* room.posted(room.first, "In the channel.");
        const dm = Option.getOrThrow(
          yield* findOrMakeDm(room.owner, room.workspace, room.first.id, room.ada.id),
        );
        const private_ = yield* room.posted(room.first, "To Ada alone.", { channelId: dm.id });
        const at = (reader: ChatMemberRow, seq: number) =>
          Effect.map(
            messageAt(room.owner, room.workspace, reader.id, seq),
            Option.map((message) => message.id),
          );
        assert.deepEqual(yield* at(room.ada, posted.seq), Option.some(posted.id));
        assert.deepEqual(yield* at(room.ada, private_.seq), Option.some(private_.id));
        assert.deepEqual(yield* at(room.second, private_.seq), Option.none());
        assert.deepEqual(yield* at(room.ada, 999), Option.none());

        assert.equal(
          yield* markNoticed(room.owner, room.workspace, room.ada.id, room.channel.id, posted.seq),
          true,
        );
        assert.deepEqual(
          yield* readAllTo(room.owner, room.workspace, room.ada.id, posted.seq),
          Option.some(posted.seq),
        );
        // The notice it passed is let go, so the next one is told.
        assert.equal(
          yield* markNoticed(room.owner, room.workspace, room.ada.id, dm.id, private_.seq),
          true,
        );
        assert.deepEqual(
          yield* readAllTo(room.owner, room.workspace, room.ada.id, 0),
          Option.some(posted.seq),
        );
        assert.deepEqual(
          yield* readAllTo(room.owner, room.workspace, room.ada.id, 999),
          Option.some(private_.seq),
        );
        // A person moves no other person's cursor.
        assert.deepEqual(
          yield* readAllTo(room.teammate, room.workspace, room.ada.id, private_.seq),
          Option.none(),
        );
        assert.deepEqual(
          yield* readAllTo(yield* openAccount(), room.workspace, room.ada.id, 1),
          Option.none(),
        );
      }),
  );

  it.effect(
    "an account not in the workspace posts, reads, and is told nothing of it, and one in it posts as no other person",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const stranger = yield* openAccount();
        yield* room.posted(room.first, "Inside.");
        assert.deepEqual(
          yield* room.post(room.first, "From outside.", undefined, stranger),
          Result.fail(CHAT_REFUSAL.NOT_FOUND),
        );
        assert.deepEqual(
          yield* room.post(room.ada, "As Ada, by Grace.", undefined, room.teammate),
          Result.fail(CHAT_REFUSAL.NOT_FOUND),
        );
        assert.deepEqual(yield* unreadFor(stranger, room.workspace, room.ada.id), Option.none());
        assert.deepEqual(yield* chatPast(stranger, room.workspace, room.ada.id, 0), Option.none());
        assert.deepEqual(yield* history(stranger, room.workspace, room.ada.id, {}), Option.none());
        assert.equal(
          yield* markNoticed(stranger, room.workspace, room.second.id, room.channel.id, 1),
          false,
        );
        assert.deepEqual(yield* memberNamed(stranger, room.workspace, "agent-1"), Option.none());
      }),
  );

  it.effect(
    "two sends of one post racing land once and take one place, and a key another member's message holds is refused",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const once = {
          authorMemberId: room.first.id,
          to: { channelId: room.channel.id },
          blocks: words("Taking the table."),
          mentions: [],
          clientKey: "call-7",
        };
        const [a, b] = yield* Effect.all(
          [
            postMessage(room.owner, room.workspace, once),
            postMessage(room.owner, room.workspace, once),
          ],
          { concurrency: "unbounded" },
        );
        const both = [Result.getOrThrow(a), Result.getOrThrow(b)];
        assert.equal(both[0]?.message.id, both[1]?.message.id);
        assert.deepEqual(both.map((each) => each.repeated).toSorted(), [false, true]);
        assert.equal((yield* room.posted(room.second, "Next.")).seq, 2);
        assert.deepEqual(
          yield* postMessage(room.owner, room.workspace, {
            ...once,
            authorMemberId: room.second.id,
          }),
          Result.fail(CHAT_REFUSAL.KEY_TAKEN),
        );
      }),
  );

  it.effect(
    "a read's page is held between one and the bound and says more only where more waits, and a notice of what was read already is none",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const first = yield* room.posted(room.first, "One.");
        yield* room.posted(room.first, "Two.");
        const unread = (limit: number) =>
          Effect.map(
            unreadFor(room.owner, room.workspace, room.second.id, { limit }),
            Option.getOrThrow,
          );
        const none = yield* unread(0);
        assert.deepEqual([none.messages.length, none.more], [1, true]);
        const last = yield* unread(1);
        assert.deepEqual([last.messages.length, last.more], [1, false]);
        assert.equal(
          yield* markNoticed(
            room.owner,
            room.workspace,
            room.second.id,
            room.channel.id,
            first.seq,
          ),
          false,
        );

        for (let at = 0; at < CHAT_BOUNDS.MAX_READ + 1; at += 1) {
          yield* room.posted(room.first, `Line ${at}.`);
        }
        const page = Option.getOrThrow(
          yield* history(room.owner, room.workspace, room.ada.id, { limit: 1_000 }),
        );
        assert.equal(page.length, CHAT_BOUNDS.MAX_READ);
      }),
  );

  it.effect(
    "an agent that works no task names no Luke: its @luke outside a task's channel answers to no one",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const db = yield* Database;
        const agentId = room.first.agentId ?? "";
        yield* db.update(codingAgent).set({ taskId: null }).where(eq(codingAgent.id, agentId));
        const general = Option.getOrThrow(yield* ensureGeneral(room.owner, room.workspace));
        const sent = Result.getOrThrow(
          yield* room.post(room.first, "@luke, anyone?", { channelId: general.id }),
        );
        assert.deepEqual([sent.message.mentions, sent.unresolved], [[], ["luke"]]);
      }),
  );

  it.effect(
    "a member joins at the workspace's head: what was said before is history, not unread",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const before = yield* room.posted(room.first, "Before you joined.");
        const late = Option.getOrThrow(
          yield* ensureMember(room.owner, room.workspace, {
            kind: MEMBER_KIND.AGENT,
            agentId: yield* openAgent(room.owner, room.plan),
          }),
        );
        assert.equal(late.readSeq, before.seq);
        const after = yield* room.posted(room.first, "After.");
        const unread = Option.getOrThrow(yield* unreadFor(room.owner, room.workspace, late.id));
        assert.deepEqual(
          unread.messages.map((message) => message.id),
          [after.id],
        );
        const past = Option.getOrThrow(yield* history(room.owner, room.workspace, late.id, {}));
        assert.deepEqual(
          past.map((message) => message.id),
          [before.id, after.id],
        );
      }),
  );

  it.effect(
    "a person's account deleted takes their messages with it, while the replies others wrote to them stay",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const root = yield* room.posted(
          room.grace,
          "Who takes the invite table?",
          undefined,
          room.teammate,
        );
        const reply = yield* room.posted(room.first, "I do.", { replyTo: root.seq });
        const db = yield* Database;
        yield* db.delete(user).where(eq(user.id, room.teammate));

        const left = Option.getOrThrow(yield* chatPast(room.owner, room.workspace, room.ada.id, 0));
        assert.deepEqual(
          left.messages.map((message) => message.id),
          [reply.id],
        );
      }),
  );
});

/** A choice between two expiries, as an agent asks it. */
const EXPIRY = {
  title: "Invite expiry",
  response: {
    type: CHAT_ASK.CHOICE,
    options: [{ label: "Seven days" }, { label: "Five days" }],
  },
} as const;

/** The room `openRoom` opens. */
type Room = Effect.Success<typeof openRoom>;

it.layer(getTestDB())("the chat store's asks", (it) => {
  /** An ask posted by the member given under the key given, in the plan's channel or where named. */
  const ask = (
    room: Room,
    author: ChatMemberRow,
    key: string,
    text: string,
    channelId = room.channel.id,
  ) =>
    Effect.map(
      postAsk(room.owner, room.workspace, {
        authorMemberId: author.id,
        to: { channelId },
        blocks: words(text),
        mentions: [],
        clientKey: randomUUID(),
        key,
        ask: EXPIRY,
      }),
      Result.getOrThrow,
    );

  /** An answer by the member given at the revision given, under the key given. */
  const answer = (
    room: Room,
    answerer: ChatMemberRow,
    seq: number,
    revision: number,
    clientKey: string = randomUUID(),
    as = room.owner,
  ) =>
    answerAsk(as, room.workspace, {
      answererMemberId: answerer.id,
      seq,
      revision,
      reply: { reply: CHAT_REPLY.CHOSE, choices: ["Seven days"], note: "Match the plan." },
      clientKey,
    });

  it.effect(
    "an ask posted twice under its key is one message, written again in place at the next revision and place, and opened again",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const first = yield* ask(room, room.first, "invite-expiry", "Which expiry?");
        assert.deepEqual(
          [first.created, first.message.askRevision, first.message.askStatus],
          [true, 1, ASK_STATUS.OPEN],
        );
        Result.getOrThrow(yield* answer(room, room.ada, first.message.seq, 1));
        yield* room.posted(room.second, "Meanwhile.");
        const again = yield* ask(
          room,
          room.first,
          "invite-expiry",
          "Which expiry, given the audit?",
        );
        assert.equal(again.message.id, first.message.id);
        assert.deepEqual(
          [again.created, again.message.askRevision, again.message.askStatus, again.message.answer],
          [false, 2, ASK_STATUS.OPEN, null],
        );
        assert.ok(again.message.touchedSeq > first.message.touchedSeq);
        assert.equal(again.message.seq, first.message.seq);
        assert.deepEqual(
          textsOf([again.message]),
          textsOf([{ blocks: words("Which expiry, given the audit?") }]),
        );
        // Another author's ask under the same key is its own.
        const other = yield* ask(room, room.second, "invite-expiry", "Mine too.");
        assert.notEqual(other.message.id, first.message.id);
      }),
  );

  it.effect(
    "an answer is taken at the revision it names, as a reply in the ask's thread, once under its key, and refused at a revision the author moved past",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const posted = yield* ask(room, room.first, "invite-expiry", "Which expiry?");
        yield* ask(room, room.first, "invite-expiry", "Which expiry, now?");
        const stale = Result.getOrThrow(yield* answer(room, room.ada, posted.message.seq, 1));
        assert.deepEqual(
          [stale.taken, stale.ask.askStatus, stale.reply],
          [false, ASK_STATUS.OPEN, Option.none()],
        );

        const key = randomUUID();
        const taken = Result.getOrThrow(yield* answer(room, room.ada, posted.message.seq, 2, key));
        const reply = Option.getOrThrow(taken.reply);
        assert.deepEqual(
          [taken.taken, taken.ask.askStatus, taken.ask.answeredByMemberId, taken.ask.touchedSeq],
          [true, ASK_STATUS.ANSWERED, room.ada.id, reply.seq],
        );
        assert.deepEqual([reply.parentId, reply.authorMemberId], [posted.message.id, room.ada.id]);
        assert.deepEqual(
          textsOf([reply]),
          textsOf([{ blocks: words('Chose "Seven days".\n\nMatch the plan.') }]),
        );
        const repeated = Result.getOrThrow(
          yield* answer(room, room.ada, posted.message.seq, 2, key),
        );
        assert.deepEqual([repeated.taken, Option.getOrThrow(repeated.reply).id], [true, reply.id]);
        const late = Result.getOrThrow(
          yield* answer(room, room.grace, posted.message.seq, 2, undefined, room.teammate),
        );
        assert.equal(late.taken, false);
        assert.deepEqual(
          yield* answer(room, room.ada, 999, 1),
          Result.fail(CHAT_REFUSAL.NOT_FOUND),
        );
      }),
  );

  it.effect(
    "an answer withdrawn under its key opens the ask again, once, and an ask resolved is closed with why at the next revision",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const posted = yield* ask(room, room.first, "invite-expiry", "Which expiry?");
        const key = randomUUID();
        yield* answer(room, room.ada, posted.message.seq, 1, key);
        assert.deepEqual(
          yield* withdrawAnswer(
            room.teammate,
            room.workspace,
            room.grace.id,
            posted.message.seq,
            key,
          ),
          Option.none(),
        );
        const reopened = Option.getOrThrow(
          yield* withdrawAnswer(room.owner, room.workspace, room.ada.id, posted.message.seq, key),
        );
        assert.deepEqual(
          [reopened.askStatus, reopened.answer, reopened.answerKey, reopened.askRevision],
          [ASK_STATUS.OPEN, null, null, 1],
        );
        assert.deepEqual(
          yield* withdrawAnswer(room.owner, room.workspace, room.ada.id, posted.message.seq, key),
          Option.none(),
        );

        const closed = Option.getOrThrow(
          yield* resolveAsk(
            room.owner,
            room.workspace,
            room.first.id,
            "invite-expiry",
            "Settled in the plan.",
          ),
        );
        assert.deepEqual(
          [closed.askStatus, closed.closedReason, closed.askRevision],
          [ASK_STATUS.CLOSED, "Settled in the plan.", 2],
        );
        assert.deepEqual(
          yield* resolveAsk(room.owner, room.workspace, room.first.id, "no-such-key", "Gone."),
          Option.none(),
        );
        assert.deepEqual(
          yield* resolveAsk(
            room.teammate,
            room.workspace,
            room.ada.id,
            "invite-expiry",
            "Not mine.",
          ),
          Option.none(),
        );
      }),
  );

  it.effect(
    "an author's or a channel's asks read every open one, then the latest settled up to the limit, each run the latest changed first",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const older = yield* ask(room, room.first, "older", "Older?");
        const newer = yield* ask(room, room.first, "newer", "Newer?");
        const settledFirst = yield* ask(room, room.first, "settled-first", "Done?");
        const settledLast = yield* ask(room, room.first, "settled-last", "Done too?");
        yield* resolveAsk(room.owner, room.workspace, room.first.id, "settled-first", "Done.");
        yield* resolveAsk(room.owner, room.workspace, room.first.id, "settled-last", "Done.");
        yield* ask(room, room.second, "someone-else", "Not agent-1's.");
        const ids = (rows: readonly { readonly id: string }[]) => rows.map((row) => row.id);

        assert.deepEqual(
          ids(yield* openAsksOf(room.owner, room.workspace, { authorMemberId: room.first.id }, 1)),
          [newer.message.id, older.message.id, settledLast.message.id],
        );
        assert.deepEqual(
          ids(yield* openAsksOf(room.owner, room.workspace, { authorMemberId: room.first.id })),
          [newer.message.id, older.message.id],
        );
        assert.equal(
          (yield* openAsksOf(room.owner, room.workspace, { channelId: room.channel.id }, 10))
            .length,
          5,
        );
        assert.deepEqual(
          ids(yield* openAsksOf(room.owner, room.workspace, { authorMemberId: room.first.id }, 10)),
          [newer.message.id, older.message.id, settledLast.message.id, settledFirst.message.id],
        );
      }),
  );

  it.effect(
    "what waits on a person is the open asks of others they may answer: not their own, not an agents' DM, not on an archived plan, and a DM to them included",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const inChannel = yield* ask(room, room.first, "in-channel", "Which expiry?");
        yield* ask(room, room.ada, "adas-own", "My own question.");
        const toAda = Option.getOrThrow(
          yield* findOrMakeDm(room.owner, room.workspace, room.second.id, room.ada.id),
        );
        const dmAsk = yield* ask(room, room.second, "to-ada", "Ada, which?", toAda.id);
        const between = Option.getOrThrow(
          yield* findOrMakeDm(room.owner, room.workspace, room.first.id, room.second.id),
        );
        yield* ask(room, room.first, "between-agents", "agent-2, which?", between.id);
        const answered = yield* ask(room, room.second, "answered", "Answered?");
        yield* answer(room, room.grace, answered.message.seq, 1, undefined, room.teammate);

        // Every change in a test lands at one instant, so the sequence orders them, the latest first.
        const waiting = yield* waitingOn(room.owner);
        assert.deepEqual(
          waiting.map((each) => [each.message.id, each.taskId]),
          [
            [dmAsk.message.id, null],
            [inChannel.message.id, room.plan],
          ],
        );
        assert.deepEqual(
          (yield* waitingStamps(room.owner)).map((stamp) => stamp.id),
          waiting.map((each) => each.message.id),
        );

        yield* updateTask(room.owner, room.plan, { archived: true });
        assert.deepEqual(
          (yield* waitingOn(room.owner)).map((each) => each.message.id),
          [dmAsk.message.id],
        );
        const stranger = yield* openAccount();
        assert.deepEqual(yield* waitingOn(stranger), []);
        assert.deepEqual(
          yield* openAsksOf(stranger, room.workspace, { channelId: room.channel.id }),
          [],
        );
      }),
  );

  it.effect(
    "the workspace's head is the last place handed out, which a post, an answer, a withdrawal, and a resolve each move, and an account not in it reads none",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const head = Effect.map(chatHead(room.owner, room.workspace), Option.getOrThrow);
        assert.equal(yield* head, 0);
        const posted = yield* ask(room, room.first, "invite-expiry", "Which expiry?");
        assert.equal(yield* head, posted.message.seq);
        const key = randomUUID();
        Result.getOrThrow(yield* answer(room, room.ada, posted.message.seq, 1, key));
        const answered = yield* head;
        assert.ok(answered > posted.message.seq);
        yield* withdrawAnswer(room.owner, room.workspace, room.ada.id, posted.message.seq, key);
        const withdrawn = yield* head;
        assert.ok(withdrawn > answered);
        yield* resolveAsk(room.owner, room.workspace, room.first.id, "invite-expiry", "Settled.");
        assert.ok((yield* head) > withdrawn);
        assert.deepEqual(yield* chatHead(yield* openAccount(), room.workspace), Option.none());
      }),
  );

  it.effect(
    "two posts of one new ask racing land as one ask at the second revision, an ask stays where it was first posted, and a key a plain message holds is no ask's",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const [a, b] = yield* Effect.all(
          [
            ask(room, room.first, "invite-expiry", "Which?"),
            ask(room, room.first, "invite-expiry", "Which, really?"),
          ],
          { concurrency: "unbounded" },
        );
        assert.equal(a.message.id, b.message.id);
        assert.deepEqual([a.created, b.created].toSorted(), [false, true]);
        assert.deepEqual([a.message.askRevision, b.message.askRevision].toSorted(), [1, 2]);

        const general = Option.getOrThrow(yield* ensureGeneral(room.owner, room.workspace));
        assert.deepEqual(
          yield* postAsk(room.owner, room.workspace, {
            authorMemberId: room.first.id,
            to: { channelId: general.id },
            blocks: words("Moved?"),
            mentions: [],
            clientKey: randomUUID(),
            key: "invite-expiry",
            ask: EXPIRY,
          }),
          Result.fail(CHAT_REFUSAL.ASK_ELSEWHERE),
        );

        yield* postMessage(room.owner, room.workspace, {
          authorMemberId: room.first.id,
          to: { channelId: room.channel.id },
          blocks: words("Plain."),
          mentions: [],
          clientKey: "request-1",
        });
        assert.deepEqual(
          yield* postAsk(room.owner, room.workspace, {
            authorMemberId: room.first.id,
            to: { channelId: room.channel.id },
            blocks: words("Asked under a plain message's key."),
            mentions: [],
            clientKey: "request-1",
            key: "another",
            ask: EXPIRY,
          }),
          Result.fail(CHAT_REFUSAL.KEY_TAKEN),
        );
      }),
  );

  it.effect("a form filled to its bounds is answered in as many blocks as its words take", () =>
    Effect.gen(function* () {
      const room = yield* openRoom;
      const fields = Array.from({ length: CHAT_BOUNDS.MAX_FIELDS }, (_, at) => ({
        type: "text" as const,
        label: `Field ${at}`,
      }));
      const posted = Result.getOrThrow(
        yield* postAsk(room.owner, room.workspace, {
          authorMemberId: room.first.id,
          to: { channelId: room.channel.id },
          blocks: words("Fill these in."),
          mentions: [],
          clientKey: randomUUID(),
          key: "the-form",
          ask: { response: { type: CHAT_ASK.FORM, fields } },
        }),
      );
      const answered = Result.getOrThrow(
        yield* answerAsk(room.owner, room.workspace, {
          answererMemberId: room.ada.id,
          seq: posted.message.seq,
          revision: 1,
          reply: {
            reply: CHAT_REPLY.SUBMITTED,
            values: fields.map((field) => ({
              label: field.label,
              value: "v".repeat(CHAT_BOUNDS.MAX_FIELD_VALUE_CHARS),
            })),
            note: "n".repeat(CHAT_BOUNDS.MAX_NOTE_CHARS),
          },
          clientKey: randomUUID(),
        }),
      );
      assert.equal(answered.taken, true);
      assert.equal(Option.getOrThrow(answered.reply).blocks.length, 2);
    }),
  );
  it.effect(
    "an answer cut across blocks never splits a character, and one withdrawn and sent again under its key takes its reply again",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const fields = Array.from({ length: CHAT_BOUNDS.MAX_FIELDS }, (_, at) => ({
          type: "text" as const,
          label: `Field ${at}`,
        }));
        const posted = Result.getOrThrow(
          yield* postAsk(room.owner, room.workspace, {
            authorMemberId: room.first.id,
            to: { channelId: room.channel.id },
            blocks: words("Fill these in."),
            mentions: [],
            clientKey: randomUUID(),
            key: "long-form",
            ask: { response: { type: CHAT_ASK.FORM, fields } },
          }),
        );
        // Every field but the last full, and the last's words run so a smile straddles the first block's bound.
        const full = "v".repeat(CHAT_BOUNDS.MAX_FIELD_VALUE_CHARS);
        const before = [
          "Filled in the form.",
          "",
          ...fields.slice(0, -1).map((field) => `- ${field.label}: ${full}`),
          `- Field ${CHAT_BOUNDS.MAX_FIELDS - 1}: `,
        ].join("\n").length;
        const last = `${"v".repeat(CHAT_BOUNDS.MAX_MARKDOWN_CHARS - 1 - before)}😀 and more`;
        const reply = {
          reply: CHAT_REPLY.SUBMITTED,
          values: fields.map((field, at) => ({
            label: field.label,
            value: at === fields.length - 1 ? last : full,
          })),
        } as const;
        const key = randomUUID();
        const answer = () =>
          answerAsk(room.owner, room.workspace, {
            answererMemberId: room.ada.id,
            seq: posted.message.seq,
            revision: 1,
            reply,
            clientKey: key,
          });
        const answered = Result.getOrThrow(yield* answer());
        const blocks = Option.getOrThrow(answered.reply).blocks;
        assert.equal(blocks.length, 2);
        assert.ok(JSON.stringify(blocks[1]).startsWith('{"type":"markdown","text":"😀'));

        yield* withdrawAnswer(room.owner, room.workspace, room.ada.id, posted.message.seq, key);
        const again = Result.getOrThrow(yield* answer());
        assert.deepEqual(
          [again.taken, again.ask.askStatus, Option.getOrThrow(again.reply).id],
          [true, ASK_STATUS.ANSWERED, Option.getOrThrow(answered.reply).id],
        );
      }),
  );

  it.effect(
    "an answer under a key a message outside the ask's thread holds is refused, and an answer whose answerer is gone is withdrawn by no one else",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const posted = yield* ask(room, room.first, "expiry", "Which expiry?");
        yield* postMessage(room.owner, room.workspace, {
          authorMemberId: room.ada.id,
          to: { channelId: room.channel.id },
          blocks: words("Unrelated."),
          mentions: [],
          clientKey: "shared-key",
        });
        assert.deepEqual(
          yield* answer(room, room.ada, posted.message.seq, 1, "shared-key"),
          Result.fail(CHAT_REFUSAL.KEY_TAKEN),
        );

        const key = randomUUID();
        yield* answer(room, room.grace, posted.message.seq, 1, key, room.teammate);
        // The answerer's account goes, and its member with it.
        const db = yield* Database;
        yield* db.delete(user).where(eq(user.id, room.teammate));
        assert.deepEqual(
          yield* withdrawAnswer(room.owner, room.workspace, room.ada.id, posted.message.seq, key),
          Option.none(),
        );
      }),
  );

  it.effect(
    "a key says one answer by one member: another member's retry under it, or a different answer sent again under it after a withdrawal, is refused; and an author that left resolves nothing",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const posted = yield* ask(room, room.first, "invite-expiry", "Which expiry?");
        const key = randomUUID();
        Result.getOrThrow(yield* answer(room, room.ada, posted.message.seq, 1, key));
        assert.deepEqual(
          yield* answer(room, room.grace, posted.message.seq, 1, key, room.teammate),
          Result.fail(CHAT_REFUSAL.KEY_TAKEN),
        );

        yield* withdrawAnswer(room.owner, room.workspace, room.ada.id, posted.message.seq, key);
        assert.deepEqual(
          yield* answerAsk(room.owner, room.workspace, {
            answererMemberId: room.ada.id,
            seq: posted.message.seq,
            revision: 1,
            reply: { reply: CHAT_REPLY.CHOSE, choices: ["Five days"] },
            clientKey: key,
          }),
          Result.fail(CHAT_REFUSAL.KEY_TAKEN),
        );
        const again = Result.getOrThrow(yield* answer(room, room.ada, posted.message.seq, 1, key));
        assert.equal(again.taken, true);

        yield* ask(room, room.second, "branch-rules", "Require a review?");
        yield* leave(room.owner, room.workspace, room.second.id);
        assert.deepEqual(
          yield* resolveAsk(room.owner, room.workspace, room.second.id, "branch-rules", "Done."),
          Option.none(),
        );
      }),
  );
});

it.layer(getTestDB())("the chat store's pictures", (it) => {
  /** A message carrying an image block for each id given, as a post that read its pictures lands. */
  const pictured = (room: Room, ids: readonly string[]) =>
    Effect.map(
      postMessage(room.owner, room.workspace, {
        authorMemberId: room.first.id,
        to: { channelId: room.channel.id },
        blocks: ids.map((attachmentId) => ({
          type: CHAT_BLOCK.IMAGE,
          attachmentId,
          alt: "The rendered invite.",
        })),
        mentions: [],
        clientKey: randomUUID(),
      }),
      (posted) => Result.getOrThrow(posted).message,
    );

  it.effect(
    "a message's pictures read back byte for byte, one it no longer keeps is dropped, one it never named is refused, and only its author keeps them",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const png = {
          id: randomUUID(),
          contentType: CHAT_IMAGE_TYPE.PNG,
          bytes: new Uint8Array([137, 80, 78, 71, 0, 255]),
        };
        const webp = {
          id: randomUUID(),
          contentType: CHAT_IMAGE_TYPE.WEBP,
          bytes: new Uint8Array([82, 73, 70, 70]),
        };
        const message = yield* pictured(room, [png.id, webp.id]);
        const keep = (images: readonly ChatImageWrite[], author = room.first.id, as = room.owner) =>
          attachMessageImages(as, room.workspace, author, message.id, images);
        const read = (attachmentId: string, as = room.owner) =>
          readAttachment(as, room.workspace, message.id, attachmentId);

        assert.equal(yield* keep([png, webp]), true);
        const stored = Option.getOrThrow(yield* read(png.id));
        assert.deepEqual(
          [stored.contentType, [...stored.bytes]],
          [png.contentType, [...png.bytes]],
        );

        yield* keep([webp]);
        assert.deepEqual(yield* read(png.id), Option.none());
        assert.equal(Option.getOrThrow(yield* read(webp.id)).contentType, CHAT_IMAGE_TYPE.WEBP);

        const stray = { ...png, id: randomUUID() };
        assert.equal(yield* keep([webp, stray]), false);
        assert.deepEqual(yield* read(stray.id), Option.none());
        assert.equal(yield* keep([png], room.second.id), false);
        assert.equal(yield* keep([png], room.ada.id, room.teammate), false);
      }),
  );

  it.effect("two writes of one message's pictures take turns, and the last one's stand alone", () =>
    Effect.gen(function* () {
      const room = yield* openRoom;
      const a = { id: randomUUID(), contentType: CHAT_IMAGE_TYPE.PNG, bytes: new Uint8Array([1]) };
      const b = { id: randomUUID(), contentType: CHAT_IMAGE_TYPE.PNG, bytes: new Uint8Array([2]) };
      const message = yield* pictured(room, [a.id, b.id]);
      yield* Effect.all(
        [
          attachMessageImages(room.owner, room.workspace, room.first.id, message.id, [a]),
          attachMessageImages(room.owner, room.workspace, room.first.id, message.id, [b]),
        ],
        { concurrency: "unbounded" },
      );
      const kept = yield* Effect.forEach([a, b], (image) =>
        Effect.map(readAttachment(room.owner, room.workspace, message.id, image.id), Option.isSome),
      );
      assert.equal(kept.filter(Boolean).length, 1);
    }),
  );

  it.effect("an account not in the workspace reads none of its pictures", () =>
    Effect.gen(function* () {
      const room = yield* openRoom;
      const stranger = yield* openAccount();
      const png = {
        id: randomUUID(),
        contentType: CHAT_IMAGE_TYPE.PNG,
        bytes: new Uint8Array([1, 2, 3]),
      };
      const message = yield* pictured(room, [png.id]);
      yield* attachMessageImages(room.owner, room.workspace, room.first.id, message.id, [png]);
      assert.deepEqual(
        yield* readAttachment(stranger, room.workspace, message.id, png.id),
        Option.none(),
      );
      assert.equal(
        Option.isSome(yield* readAttachment(room.teammate, room.workspace, message.id, png.id)),
        true,
      );
    }),
  );

  it.effect(
    "the one attachment table keeps the same pictures under the same ids, drops the ones the message drops, and moves them with the task's chat",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const room = yield* openRoom;
        const png = {
          id: randomUUID(),
          contentType: CHAT_IMAGE_TYPE.PNG,
          bytes: new Uint8Array([137, 80, 78, 71]),
        };
        const webp = {
          id: randomUUID(),
          contentType: CHAT_IMAGE_TYPE.WEBP,
          bytes: new Uint8Array([82, 73, 70, 70]),
        };
        const message = yield* pictured(room, [png.id, webp.id]);
        const shared = Effect.map(
          db
            .select({
              id: attachment.id,
              organizationId: attachment.organizationId,
              contentType: attachment.contentType,
              byteCount: attachment.byteCount,
              bytes: attachment.bytes,
            })
            .from(attachment)
            .where(eq(attachment.chatMessageId, message.id)),
          (rows) => rows.toSorted((a, b) => a.id.localeCompare(b.id)),
        );

        yield* attachMessageImages(room.owner, room.workspace, room.first.id, message.id, [
          png,
          webp,
        ]);
        assert.deepEqual(
          (yield* shared).map((row) => [row.id, row.contentType, row.byteCount, [...row.bytes]]),
          [png, webp]
            .toSorted((a, b) => a.id.localeCompare(b.id))
            .map((image) => [
              image.id,
              image.contentType,
              image.bytes.byteLength,
              [...image.bytes],
            ]),
        );

        yield* attachMessageImages(room.owner, room.workspace, room.first.id, message.id, [webp]);
        assert.deepEqual(
          (yield* shared).map((row) => row.id),
          [webp.id],
        );

        const elsewhere = yield* openWorkspace(room.owner);
        yield* moveTaskChat(room.plan, elsewhere);
        assert.deepEqual(
          (yield* shared).map((row) => row.organizationId),
          [elsewhere],
        );
      }),
  );

  it.effect(
    "a picture kept before the one table, written again with other bytes under its id, is copied there as it was first kept",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const room = yield* openRoom;
        const id = randomUUID();
        const message = yield* pictured(room, [id]);
        const first = new Uint8Array([137, 80, 78, 71, 1]);
        yield* db.insert(chatAttachment).values({
          id,
          organizationId: room.workspace,
          messageId: message.id,
          contentType: CHAT_IMAGE_TYPE.PNG,
          byteCount: first.byteLength,
          bytes: first,
          createdAt: yield* DateTime.nowAsDate,
        });

        yield* attachMessageImages(room.owner, room.workspace, room.first.id, message.id, [
          { id, contentType: CHAT_IMAGE_TYPE.PNG, bytes: new Uint8Array([137, 80, 78, 71, 2]) },
        ]);
        const [copied] = yield* db
          .select({ bytes: attachment.bytes })
          .from(attachment)
          .where(eq(attachment.id, id));
        assert.deepEqual([...(copied?.bytes ?? [])], [...first]);
        assert.deepEqual(
          [
            ...Option.getOrThrow(yield* readAttachment(room.owner, room.workspace, message.id, id))
              .bytes,
          ],
          [...first],
        );
      }),
  );
});

it.layer(getTestDB())("the chat store's reads for telling a message", (it) => {
  it.effect(
    "a thread's authors are its root's then each replier's before a place, once each; a channel reads by its id; and a notice let go lets the next be told",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const root = yield* room.posted(room.first, "Who owns it?");
        yield* room.posted(room.ada, "agent-2.", { replyTo: root.seq });
        yield* room.posted(room.second, "Yes.", { replyTo: root.seq });
        const last = yield* room.posted(room.ada, "Thanks.", { replyTo: root.seq });
        assert.deepEqual(yield* threadAuthors(room.owner, room.workspace, root.id, last.seq), [
          room.first.id,
          room.ada.id,
          room.second.id,
        ]);
        assert.equal(
          Option.getOrThrow(yield* channelOf(room.owner, room.workspace, room.channel.id)).id,
          room.channel.id,
        );

        assert.equal(
          yield* markNoticed(room.owner, room.workspace, room.second.id, room.channel.id, root.seq),
          true,
        );
        assert.equal(
          yield* markNoticed(room.owner, room.workspace, room.second.id, room.channel.id, last.seq),
          false,
        );
        yield* releaseNotice(room.owner, room.workspace, room.second.id, root.seq);
        assert.equal(
          yield* markNoticed(room.owner, room.workspace, room.second.id, room.channel.id, last.seq),
          true,
        );

        const stranger = yield* openAccount();
        assert.deepEqual(yield* threadAuthors(stranger, room.workspace, root.id, last.seq), []);
        assert.deepEqual(
          yield* channelOf(stranger, room.workspace, room.channel.id),
          Option.none(),
        );
      }),
  );

  it.effect(
    "a reply's root is read back by its place, and an account not in the workspace reads no place",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const root = yield* room.posted(room.first, "Who owns it?");
        const reply = yield* room.posted(room.second, "I do.", { replyTo: root.seq });
        assert.ok(reply.parentId !== null);
        const places = yield* seqsOf(room.owner, room.workspace, [reply.parentId, randomUUID()]);
        assert.deepEqual([...places], [[root.id, root.seq]]);

        const stranger = yield* openAccount();
        assert.equal((yield* seqsOf(stranger, room.workspace, [root.id])).size, 0);
      }),
  );

  it.effect("an agent's workspace is read off its own row, for an account in it alone", () =>
    Effect.gen(function* () {
      const room = yield* openRoom;
      const agentId = room.first.agentId ?? "";
      assert.deepEqual(yield* agentWorkspace(room.owner, agentId), Option.some(room.workspace));
      const stranger = yield* openAccount();
      assert.deepEqual(yield* agentWorkspace(stranger, agentId), Option.none());
      assert.deepEqual(yield* agentWorkspace(room.owner, randomUUID()), Option.none());
    }),
  );
});

it.layer(getTestDB())("a plan's chat moving with the plan", (it) => {
  it.effect(
    "a plan moved to another workspace takes its channel, messages, thread, and ask there at the end of that workspace's sequence, its agents minted again, while a DM elsewhere stays and the old workspace reads none of the plan's chat",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const root = yield* room.posted(room.first, "@agent-2 who owns the invite table?");
        const reply = yield* room.posted(room.ada, "agent-2 does.", { replyTo: root.seq });
        const asked = Result.getOrThrow(
          yield* postAsk(room.owner, room.workspace, {
            authorMemberId: room.first.id,
            to: { channelId: room.channel.id },
            blocks: words("Which expiry?"),
            mentions: [],
            clientKey: randomUUID(),
            key: "expiry",
            ask: EXPIRY,
          }),
        );
        yield* answerAsk(room.owner, room.workspace, {
          answererMemberId: room.ada.id,
          seq: asked.message.seq,
          revision: 1,
          reply: { reply: CHAT_REPLY.CHOSE, choices: ["Seven days"] },
          clientKey: randomUUID(),
        });
        const dm = Option.getOrThrow(
          yield* findOrMakeDm(room.owner, room.workspace, room.first.id, room.second.id),
        );
        const stays = yield* room.posted(room.first, "Between us.", { channelId: dm.id });
        const destination = yield* openWorkspace(room.owner);

        yield* updateTask(room.owner, room.plan, { organizationId: destination });

        const there = Option.getOrThrow(
          yield* ensureMember(room.owner, destination, {
            kind: MEMBER_KIND.HUMAN,
            userId: room.owner,
          }),
        );
        const read = Option.getOrThrow(yield* chatPast(room.owner, destination, there.id, 0));
        const moved = read.messages.toSorted((a, b) => a.seq - b.seq);
        assert.deepEqual(
          moved.map((message) => message.seq),
          [1, 2, 3, 4],
        );
        assert.ok(moved.every((message) => message.channelId === room.channel.id));
        assert.equal(moved[1]?.parentId, root.id);
        assert.equal(moved[1]?.id, reply.id);
        const members = new Map(
          (yield* roster(room.owner, destination)).map((row) => [row.id, row]),
        );
        assert.equal(members.get(moved[0]?.authorMemberId ?? "")?.agentId, room.first.agentId);
        assert.deepEqual(
          (moved[0]?.mentions ?? []).map((id) => members.get(id)?.agentId),
          [room.second.agentId],
        );
        const ask = moved.find((message) => message.id === asked.message.id);
        assert.equal(ask?.answeredByMemberId, there.id);
        assert.ok((ask?.touchedSeq ?? 0) > 4);
        assert.ok(
          (yield* channelsOf(room.owner, destination)).some((row) => row.id === room.channel.id),
        );

        const left = Option.getOrThrow(yield* chatPast(room.owner, room.workspace, room.ada.id, 0));
        assert.deepEqual(
          left.messages.map((message) => message.id),
          [stays.id],
        );
        assert.ok(
          !(yield* channelsOf(room.owner, room.workspace)).some(
            (row) => row.id === room.channel.id,
          ),
        );
        const behind = (yield* roster(room.owner, room.workspace)).filter(
          (row) => row.kind === MEMBER_KIND.AGENT,
        );
        assert.ok(behind.every((row) => row.agentId === null && row.leftAt !== null));
      }),
  );

  it.effect(
    "a moved message whose author the move cannot carry, an agent of another plan, is kept by a former member there, so deleting the workspace left erases none of it",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const outsider = Option.getOrThrow(
          yield* ensureMember(room.owner, room.workspace, {
            kind: MEMBER_KIND.AGENT,
            agentId: yield* openAgent(
              room.owner,
              yield* openTask(room.owner, room.workspace, "Other"),
            ),
          }),
        );
        const visiting = yield* room.posted(outsider, "Dropping by from the other plan.");
        const destination = yield* openWorkspace(room.owner);

        yield* updateTask(room.owner, room.plan, { organizationId: destination });
        const db = yield* Database;
        yield* db.delete(organization).where(eq(organization.id, room.workspace));

        const there = Option.getOrThrow(
          yield* ensureMember(room.owner, destination, {
            kind: MEMBER_KIND.HUMAN,
            userId: room.owner,
          }),
        );
        const read = Option.getOrThrow(yield* chatPast(room.owner, destination, there.id, 0));
        const kept = read.messages.find((message) => message.id === visiting.id);
        assert.ok(kept !== undefined);
        const author = (yield* roster(room.owner, destination)).find(
          (row) => row.id === kept.authorMemberId,
        );
        assert.equal(author?.kind, MEMBER_KIND.AGENT);
        assert.equal(author?.agentId, null);
        assert.notEqual(author?.leftAt, null);
      }),
  );
});

it.layer(getTestDB())("a member's cursor in each channel", (it) => {
  it.effect(
    "reading one channel marks no other read: each channel counts its own unread, a read of every channel reads what is left, and a window reads a channel to a place",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const general = Option.getOrThrow(yield* ensureGeneral(room.owner, room.workspace));
        const inTask = yield* room.posted(room.first, "On the plan.");
        const inGeneral = yield* room.posted(room.first, "For everyone.", {
          channelId: general.id,
        });
        const counts = () =>
          Effect.map(unreadCounts(room.owner, room.workspace, room.second.id), Option.getOrThrow);
        const unread = (channelId?: string) =>
          Effect.map(unreadFor(room.owner, room.workspace, room.second.id, { channelId }), (read) =>
            Option.getOrThrow(read).messages.map((message) => message.id),
          );

        assert.deepEqual(
          new Map((yield* counts()).map((row) => [row.channelId, row.unread])),
          new Map([
            [room.channel.id, 1],
            [general.id, 1],
          ]),
        );
        assert.deepEqual(yield* unread(room.channel.id), [inTask.id]);
        assert.deepEqual(yield* counts(), [{ channelId: general.id, unread: 1 }]);
        assert.deepEqual(yield* unread(), [inGeneral.id]);
        assert.deepEqual(yield* counts(), []);

        const later = yield* room.posted(room.first, "Later, for everyone.", {
          channelId: general.id,
        });
        const last = yield* room.posted(room.first, "Last, for everyone.", {
          channelId: general.id,
        });
        assert.equal(
          yield* readTo(room.owner, room.workspace, room.second.id, general.id, later.seq),
          true,
        );
        assert.deepEqual(yield* counts(), [{ channelId: general.id, unread: 1 }]);
        // A place past the head reads to the head, so what is posted next is still unread.
        assert.equal(
          yield* readTo(room.owner, room.workspace, room.second.id, general.id, last.seq + 50),
          true,
        );
        const next = yield* room.posted(room.first, "Next.", { channelId: general.id });
        assert.deepEqual(yield* unread(general.id), [next.id]);
      }),
  );

  it.effect(
    "a member's own cursor in each channel it read is read back, and an account not in the workspace reads none",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const general = Option.getOrThrow(yield* ensureGeneral(room.owner, room.workspace));
        const posted = yield* room.posted(room.first, "For everyone.", { channelId: general.id });
        assert.deepEqual(yield* channelReads(room.owner, room.workspace, room.second.id), []);
        yield* readTo(room.owner, room.workspace, room.second.id, general.id, posted.seq);
        assert.deepEqual(yield* channelReads(room.owner, room.workspace, room.second.id), [
          { channelId: general.id, readSeq: posted.seq },
        ]);
        // Another member's cursors are its own.
        assert.deepEqual(yield* channelReads(room.owner, room.workspace, room.ada.id), []);
        assert.deepEqual(
          yield* channelReads(yield* openAccount(), room.workspace, room.second.id),
          [],
        );
      }),
  );

  it.effect(
    "an agent reads and marks no DM it is not one of, and an account not in the workspace reads no counts",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const dm = Option.getOrThrow(
          yield* findOrMakeDm(room.owner, room.workspace, room.first.id, room.ada.id),
        );
        yield* room.posted(room.ada, "Just us.", { channelId: dm.id });
        assert.deepEqual(
          yield* unreadFor(room.owner, room.workspace, room.second.id, { channelId: dm.id }),
          Option.none(),
        );
        assert.equal(yield* readTo(room.owner, room.workspace, room.second.id, dm.id, 1), false);
        assert.deepEqual(
          Option.getOrThrow(yield* unreadCounts(room.owner, room.workspace, room.second.id)),
          [],
        );
        assert.deepEqual(
          Option.getOrThrow(yield* unreadCounts(room.owner, room.workspace, room.first.id)),
          [{ channelId: dm.id, unread: 1 }],
        );
        const stranger = yield* openAccount();
        assert.deepEqual(
          yield* unreadCounts(stranger, room.workspace, room.first.id),
          Option.none(),
        );
        assert.equal(
          yield* readTo(stranger, room.workspace, room.first.id, room.channel.id, 1),
          false,
        );
      }),
  );

  it.effect(
    "a notice stands until its own channel is read past it: a read of another channel leaves it, a read of its channel or of every channel lets go of it",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const general = Option.getOrThrow(yield* ensureGeneral(room.owner, room.workspace));
        const notice = (channelId: string, seq: number) =>
          markNoticed(room.owner, room.workspace, room.second.id, channelId, seq);
        const told = yield* room.posted(room.first, "@agent-2 ping.");
        assert.equal(yield* notice(room.channel.id, told.seq), true);
        yield* room.posted(room.first, "Elsewhere.", { channelId: general.id });
        yield* unreadFor(room.owner, room.workspace, room.second.id, { channelId: general.id });
        const held = yield* room.posted(room.first, "@agent-2 again.", { channelId: general.id });
        assert.equal(yield* notice(general.id, held.seq), false);

        yield* unreadFor(room.owner, room.workspace, room.second.id, {
          channelId: room.channel.id,
        });
        const freed = yield* room.posted(room.first, "@agent-2 and now?", {
          channelId: general.id,
        });
        assert.equal(yield* notice(general.id, freed.seq), true);
        // A notice of a channel read past it already is no notice.
        yield* unreadFor(room.owner, room.workspace, room.second.id);
        assert.equal(yield* notice(general.id, freed.seq), false);
        const again = yield* room.posted(room.first, "@agent-2 once more.");
        assert.equal(yield* notice(room.channel.id, again.seq), true);
      }),
  );

  it.effect(
    "a plan's channel moving to another workspace lets go of the notices told in it, so a member left behind is told again",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const elsewhere = Option.getOrThrow(
          yield* ensureMember(room.owner, room.workspace, {
            kind: MEMBER_KIND.AGENT,
            agentId: yield* openAgent(room.owner, yield* openTask(room.owner, room.workspace)),
          }),
        );
        const notice = (channelId: string, seq: number) =>
          markNoticed(room.owner, room.workspace, elsewhere.id, channelId, seq);
        const told = yield* room.posted(room.first, `@${elsewhere.handle} a look?`);
        assert.equal(yield* notice(room.channel.id, told.seq), true);

        yield* updateTask(room.owner, room.plan, {
          organizationId: yield* openWorkspace(room.owner),
        });

        const general = Option.getOrThrow(yield* ensureGeneral(room.owner, room.workspace));
        const after = yield* room.posted(room.ada, `@${elsewhere.handle} still there?`, {
          channelId: general.id,
        });
        assert.equal(yield* notice(general.id, after.seq), true);
      }),
  );
});
