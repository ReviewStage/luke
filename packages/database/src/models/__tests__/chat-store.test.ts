import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { CHANNEL_KIND, CHAT_BLOCK, CHAT_BOUNDS, MEMBER_KIND } from "@luke/features/chat-wire";
import { and, eq } from "drizzle-orm";
import { DateTime, Effect, Option, Result } from "effect";
import { Database } from "../../core/query.js";
import { member, organization, user } from "../../schemas/auth.js";
import { chatMessage, workspaceChat } from "../../schemas/chat.js";
import { codingAgent } from "../../schemas/coding-agent.js";
import { getTestDB } from "../../testing/index.js";
import {
  CHAT_REFUSAL,
  type ChatMemberRow,
  type ChatPost,
  channelNamed,
  channelsOf,
  chatPast,
  ensureGeneral,
  ensureMember,
  ensurePlanChannel,
  findOrMakeDm,
  history,
  leave,
  markNoticed,
  memberNamed,
  openTopicChannel,
  postMessage,
  roster,
  unreadFor,
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

const openPlan = (userId: string, organizationId: string, name = "Billing export") =>
  Effect.map(
    createTask(userId, { organizationId, name, repository: "acme/api" }),
    (made) => made.id,
  );

const openAgent = (userId: string, planId: string) =>
  Effect.gen(function* () {
    const started = yield* createCodingAgent(userId, {
      taskId: planId,
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
    "a member is minted once and keeps its handle: a person by their name, a clash or a spoken-for handle stepped past, an agent as agent-N, every planner as luke, and concurrent mints of one subject one member",
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
        const plan = yield* openPlan(owner, workspace);
        const otherPlan = yield* openPlan(owner, workspace, "Invites");
        const first = yield* openAgent(owner, plan);
        const second = yield* openAgent(owner, plan);
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
        const planners = yield* Effect.forEach([plan, otherPlan], (planId) =>
          mint({ kind: MEMBER_KIND.PLANNER, planId }),
        );
        assert.deepEqual(
          planners.map((row) => row.handle),
          ["luke", "luke"],
        );
        assert.notEqual(planners[0]?.id, planners[1]?.id);

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
        const billing = yield* openPlan(owner, workspace, "Billing export");
        const again = yield* openPlan(owner, workspace, "Billing  Export");
        const general = yield* openPlan(owner, workspace, "General");
        const unnamed = yield* openPlan(owner, workspace, "✨");

        const channel = (planId: string) =>
          Effect.map(ensurePlanChannel(owner, planId), Option.getOrThrow);
        const first = yield* channel(billing);
        assert.equal((yield* channel(billing)).id, first.id);
        const names = yield* Effect.forEach([billing, again, general, unnamed], (planId) =>
          Effect.map(channel(planId), (row) => [row.kind, row.name, row.planId]),
        );
        assert.deepEqual(names, [
          [CHANNEL_KIND.PLAN, "billing-export", billing],
          [CHANNEL_KIND.PLAN, "billing-export-2", again],
          [CHANNEL_KIND.PLAN, "general-2", general],
          [CHANNEL_KIND.PLAN, "plan", unnamed],
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
        const plan = yield* openPlan(owner, workspace);
        const agent = Option.getOrThrow(
          yield* ensureMember(owner, workspace, {
            kind: MEMBER_KIND.AGENT,
            agentId: yield* openAgent(owner, plan),
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
        const plan = yield* openPlan(owner, workspace);
        const agentId = yield* openAgent(owner, plan);
        const person = Option.getOrThrow(
          yield* ensureMember(owner, workspace, { kind: MEMBER_KIND.HUMAN, userId: owner }),
        );
        yield* ensurePlanChannel(owner, plan);

        assert.deepEqual(yield* roster(stranger, workspace), []);
        assert.deepEqual(yield* channelsOf(stranger, workspace), []);
        assert.deepEqual(yield* ensurePlanChannel(stranger, plan), Option.none());
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
      const plan = yield* openPlan(owner, workspace);
      const agent = Option.getOrThrow(
        yield* ensureMember(owner, workspace, {
          kind: MEMBER_KIND.AGENT,
          agentId: yield* openAgent(owner, plan),
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
        const plan = yield* openPlan(owner, workspace);
        const channel = () =>
          Effect.map(ensurePlanChannel(owner, plan), (row) => Option.getOrThrow(row).archivedAt);
        assert.equal(yield* channel(), null);
        yield* updateTask(owner, plan, { archived: true });
        assert.notEqual(yield* channel(), null);
        yield* updateTask(owner, plan, { archived: false });
        assert.equal(yield* channel(), null);

        const shelved = yield* openPlan(owner, workspace, "Old export");
        yield* updateTask(owner, shelved, { archived: true });
        const made = Option.getOrThrow(yield* ensurePlanChannel(owner, shelved));
        assert.notEqual(made.archivedAt, null);
      }),
  );

  it.effect("no DM is opened with a member that left, from either side", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount("Ada Lovelace");
      const workspace = yield* openWorkspace(owner);
      const plan = yield* openPlan(owner, workspace);
      const mint = (subject: Parameters<typeof ensureMember>[2]) =>
        Effect.map(ensureMember(owner, workspace, subject), Option.getOrThrow);
      const ada = yield* mint({ kind: MEMBER_KIND.HUMAN, userId: owner });
      const agent = yield* mint({
        kind: MEMBER_KIND.AGENT,
        agentId: yield* openAgent(owner, plan),
      });
      assert.ok(Option.isSome(yield* findOrMakeDm(owner, workspace, ada.id, agent.id)));
      const gone = yield* mint({ kind: MEMBER_KIND.AGENT, agentId: yield* openAgent(owner, plan) });
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
  const plan = yield* openPlan(owner, workspace);
  const mint = (subject: Parameters<typeof ensureMember>[2]) =>
    Effect.map(ensureMember(owner, workspace, subject), Option.getOrThrow);
  const ada = yield* mint({ kind: MEMBER_KIND.HUMAN, userId: owner });
  const grace = yield* mint({ kind: MEMBER_KIND.HUMAN, userId: teammate });
  const first = yield* mint({ kind: MEMBER_KIND.AGENT, agentId: yield* openAgent(owner, plan) });
  const second = yield* mint({ kind: MEMBER_KIND.AGENT, agentId: yield* openAgent(owner, plan) });
  const channel = Option.getOrThrow(yield* ensurePlanChannel(owner, plan));
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
  return { owner, teammate, workspace, plan, ada, grace, first, second, channel, post, posted };
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
            unreadFor(room.owner, room.workspace, room.second.id, limit),
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
    "mentions resolve to members as a post lands, @luke to the plan's planner, and a handle naming no one is answered",
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
        assert.equal(luke.kind, MEMBER_KIND.PLANNER);
        assert.equal(
          Option.getOrThrow(
            yield* channelNamed(room.owner, room.workspace, room.channel.name ?? ""),
          ).id,
          room.channel.id,
        );
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
          markNoticed(room.owner, room.workspace, room.second.id, seq);
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
        assert.equal(yield* markNoticed(stranger, room.workspace, room.second.id, 1), false);
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
            unreadFor(room.owner, room.workspace, room.second.id, limit),
            Option.getOrThrow,
          );
        const none = yield* unread(0);
        assert.deepEqual([none.messages.length, none.more], [1, true]);
        const last = yield* unread(1);
        assert.deepEqual([last.messages.length, last.more], [1, false]);
        assert.equal(
          yield* markNoticed(room.owner, room.workspace, room.second.id, first.seq),
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
    "an agent that works no plan names no planner: its @luke outside a plan's channel answers to no one",
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
