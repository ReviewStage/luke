import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { BRAIN_RUN_EVENT, BRAIN_TURN_ORIGIN, BRAIN_TURN_TRIGGER } from "@luke/features/brain";
import {
  CHECK_SUMMARY,
  CODING_AGENT_ARCHIVER,
  CODING_AGENT_AUTHOR,
  PULL_REQUEST_STATE,
  type PullRequestState,
} from "@luke/features/coding-agent-wire";
import { GITHUB_ACCESS, type GitHubAccess } from "@luke/features/github-repositories-wire";
import { sessionKey } from "@luke/runtime/vocabulary";
import {
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TURN_ORIGIN,
  TURN_STATUS,
} from "@luke/wire";
import { eq } from "drizzle-orm";
import { Clock, DateTime, Effect, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { agentPin } from "../../schemas/agent-pin.js";
import { member, organization, user } from "../../schemas/auth.js";
import { codingAgent } from "../../schemas/coding-agent.js";
import { conversations, messages, turns } from "../../schemas/storage.js";
import { task } from "../../schemas/task.js";
import { CONVERSATION_KIND, MESSAGE_SENDER } from "../../storage-vocabulary.js";
import { getTestDB, joinWorkspace, linearIssueLink } from "../../testing/index.js";
import {
  archiveCodingAgent,
  archiveIdleCodingAgent,
  archiveUnmovedCodingAgent,
  type CodingAgent,
  type CodingAgentLine,
  codingAgentLineOf,
  continuationsOf,
  createCodingAgent,
  delegationsOf,
  IDLE_ARCHIVE,
  linePlacesOf,
  lineSendersOf,
  listCodingAgentLines,
  listCodingAgentsOnPullRequest,
  listPublishedCodingAgents,
  listPublishedCodingAgentsById,
  listTasklessCodingAgents,
  listWorkspaceCodingAgentLines,
  listWorkspaceCodingAgents,
  listWorldCodingAgents,
  pinCodingAgent,
  readCodingAgent,
  readCodingAgentPublished,
  recordCodingAgentAuthor,
  recordCodingAgentPublished,
  recordTurnFastRefused,
  renameCodingAgent,
  settleCodingAgentAuthor,
  taskNamesOf,
  turnUsagesOf,
  unarchiveCodingAgentFrom,
  writeDelegation,
} from "../coding-agent-store.js";
import { sentLineId } from "../ids.js";
import { readMessageByClientId } from "../message-reads.js";
import { conversationReachableBy } from "../recorded-session.js";
import { createTask } from "../task-store.js";
import { type LineSender, storeWriter } from "../writer.js";

/**
 * The workers a coding agent's conversation delegated to, over a real
 * dialect: every delegation its conversation recorded by a kept call, oldest
 * first, each on the pair it recorded, and none of another account's. And
 * a turn Anthropic refused Fast for, as its usage reads it. And an agent
 * with no task, which its workspace's members reach and no one else does,
 * and the workspace's agents listed for its members alone. And what sent
 * each of the developer's lines to an agent, read by the agent's account.
 * And where in a turn under way each line arrived, as the turn took it in.
 * And who an agent writes as on GitHub, settled once by its first session.
 * And an agent's pin, which is its reader's own, as a plan's is.
 *
 * Synthetic accounts and conversations throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

const openConversation = (
  userId: string,
  kind: (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND],
  parentConversationId?: string,
  createdAt?: Date,
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    yield* db.insert(conversations).values({
      id,
      userId,
      kind,
      ...(parentConversationId === undefined ? undefined : { parentConversationId }),
      ...(createdAt === undefined ? undefined : { createdAt }),
    });
    return id;
  });

it.layer(getTestDB())("the coding-agent store's delegations", (it) => {
  it.effect(
    "a conversation's delegations are listed oldest first on the pair each recorded, and another account's conversation reads none of them",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const other = yield* openAccount;
        const agent = yield* openConversation(owner, CONVERSATION_KIND.CODING_AGENT);
        const later = yield* openConversation(
          owner,
          CONVERSATION_KIND.CHILD,
          agent,
          new Date("2026-10-13T12:00:02Z"),
        );
        const first = yield* openConversation(
          owner,
          CONVERSATION_KIND.CHILD,
          agent,
          new Date("2026-10-13T12:00:01Z"),
        );
        yield* writeDelegation(later, "call-2", { model: "openai/gpt-6.1-sol", effort: "low" });
        yield* writeDelegation(first, "call-1", {
          model: "anthropic/claude-opus-5.5",
          effort: "high",
        });

        const listed = yield* delegationsOf({ userId: owner, conversationId: agent });
        assert.deepEqual(
          listed.map((each) => [each.callId, each.childConversationId, each.model, each.effort]),
          [
            ["call-1", first, "anthropic/claude-opus-5.5", "high"],
            ["call-2", later, "openai/gpt-6.1-sol", "low"],
          ],
        );
        assert.deepEqual(yield* delegationsOf({ userId: other, conversationId: agent }), []);
      }),
  );
});

it.layer(getTestDB())("the coding-agent store's line senders", (it) => {
  it.effect(
    "each line names what sent it, a member by the name their account holds now and none once it is gone, an agent by the model it ran on and itself where it stands, a line written with no sender names nothing, and another account reads none",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const teammate = yield* openAccount;
        const db = yield* Database;
        yield* db.update(user).set({ name: "Charles Pan" }).where(eq(user.id, teammate));
        const target = {
          userId: owner,
          conversationId: yield* openConversation(owner, CONVERSATION_KIND.CODING_AGENT),
        };
        const writer = yield* storeWriter({ tools: {} });
        /** The line written as a send lands, answering its row's id. */
        const line = (clientKey: string, sender: LineSender) =>
          Effect.gen(function* () {
            yield* writer.writeAwaitingLine(
              target,
              { text: clientKey, clientKey, sender },
              Effect.succeed(true),
            );
            const read = yield* readMessageByClientId(
              owner,
              target.conversationId,
              {},
              sentLineId(clientKey),
            );
            assert.ok(read.ok);
            return read.value[0]?.id ?? "";
          });
        const byTeammate = yield* line("teammate", {
          kind: MESSAGE_SENDER.MEMBER,
          userId: teammate,
        });
        const byLuke = yield* line("luke", { kind: MESSAGE_SENDER.LUKE });
        const byAutomation = yield* line("automation", {
          kind: MESSAGE_SENDER.AUTOMATION,
          name: "Nightly triage",
        });
        const byGitHub = yield* line("github", { kind: MESSAGE_SENDER.GITHUB, login: "octocat" });
        // The sending agent is the teammate's, on no task, which the owner's line still names.
        const sender = yield* tasklessAgent(teammate, yield* openWorkspace(teammate));
        const byAgent = yield* line("agent", {
          kind: MESSAGE_SENDER.AGENT,
          agentId: sender.agentId,
          name: "Invite expiry",
          model: "anthropic/claude-opus-5.5",
        });
        // A line that kept the agent but no model names none, never the model the agent runs on now.
        const byChatAgent = yield* line("chat-agent", {
          kind: MESSAGE_SENDER.AGENT,
          agentId: sender.agentId,
          name: "agent-1",
        });
        // A line whose agent is gone keeps the model it was sent under, and names no agent.
        const byGoneAgent = yield* line("gone-agent", {
          kind: MESSAGE_SENDER.AGENT,
          agentId: randomUUID(),
          name: "Old agent",
          model: "openai/gpt-6.1-sol",
        });
        // A line as a build before senders were kept wrote it.
        const [earlier] = yield* db
          .insert(messages)
          .values({
            userId: owner,
            conversationId: target.conversationId,
            seq: 100,
            clientId: "earlier",
            role: MESSAGE_ROLE.USER,
            parts: [{ type: "text", text: "earlier" }],
            metadata: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED },
            placedAt: new Date(),
          })
          .returning({ id: messages.id });
        const ids = [
          byTeammate,
          byLuke,
          byAutomation,
          byGitHub,
          byAgent,
          byChatAgent,
          byGoneAgent,
          earlier?.id ?? "",
        ];

        const senders = yield* lineSendersOf(target, ids);
        assert.deepEqual(
          ids.map((id) => senders.get(id)),
          [
            { kind: MESSAGE_SENDER.MEMBER, member: { userId: teammate, name: "Charles Pan" } },
            { kind: MESSAGE_SENDER.LUKE },
            { kind: MESSAGE_SENDER.AUTOMATION, name: "Nightly triage" },
            { kind: MESSAGE_SENDER.GITHUB, login: "octocat" },
            {
              kind: MESSAGE_SENDER.AGENT,
              name: "Invite expiry",
              model: "anthropic/claude-opus-5.5",
              agent: { id: sender.agentId, taskId: undefined },
            },
            {
              kind: MESSAGE_SENDER.AGENT,
              name: "agent-1",
              model: undefined,
              agent: { id: sender.agentId, taskId: undefined },
            },
            {
              kind: MESSAGE_SENDER.AGENT,
              name: "Old agent",
              model: "openai/gpt-6.1-sol",
              agent: undefined,
            },
            undefined,
          ],
        );
        assert.equal(
          (yield* lineSendersOf({ userId: teammate, conversationId: target.conversationId }, ids))
            .size,
          0,
        );

        yield* db.delete(user).where(eq(user.id, teammate));
        assert.deepEqual((yield* lineSendersOf(target, [byTeammate])).get(byTeammate), {
          kind: MESSAGE_SENDER.MEMBER,
          member: undefined,
        });
      }),
  );
});

it.layer(getTestDB())("the coding-agent store's line places", (it) => {
  it.effect(
    "a line a turn took in after its second step reads as arriving after that step of the turn's journal, the line that opened the turn names no place, and another account reads none",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const other = yield* openAccount;
        const target = {
          userId: owner,
          conversationId: yield* openConversation(owner, CONVERSATION_KIND.CODING_AGENT),
        };
        const writer = yield* storeWriter({ tools: {} });
        const turnId = randomUUID();
        const turn = { conversationId: sessionKey(target.conversationId), turnId };
        /** A line sent and then taken in by the turn, answering its row's id. */
        const taken = (text: string) =>
          Effect.gen(function* () {
            const sender: LineSender = { kind: MESSAGE_SENDER.GITHUB, login: "octocat" };
            yield* writer.writeAwaitingLine(
              target,
              { text, clientKey: text, sender },
              Effect.succeed(true),
            );
            assert.deepEqual(
              Result.map(
                yield* writer.takeAwaitingLine(target, { text, turnId }),
                (ids) => ids.length,
              ),
              Result.succeed(1),
            );
            const read = yield* readMessageByClientId(
              owner,
              target.conversationId,
              {},
              sentLineId(text),
            );
            assert.ok(read.ok);
            return read.value[0]?.id ?? "";
          });
        yield* writer.enqueueTurn(target, {
          turnId,
          origin: TURN_ORIGIN.TYPED,
          eveTurnId: "turn_0",
        });
        yield* writer.consume(target, {
          ...turn,
          kind: BRAIN_RUN_EVENT.TURN_STARTED,
          sequence: 1,
          origin: BRAIN_TURN_ORIGIN.TYPED,
          trigger: BRAIN_TURN_TRIGGER.ASK,
          at: 0,
        });
        const opening = yield* taken("Fix the tile.");
        for (const step of [1, 2]) {
          yield* writer.consume(target, {
            ...turn,
            kind: BRAIN_RUN_EVENT.STEP_STARTED,
            sequence: step + 1,
            step,
          });
        }
        const reviewed = yield* taken("@octocat reviewed your pull request #12.");
        const journal = yield* readMessageByClientId(owner, target.conversationId, {}, turnId);
        assert.ok(journal.ok);

        const places = yield* linePlacesOf(target, [opening, reviewed]);
        assert.deepEqual(
          [opening, reviewed].map((id) => places.get(id)),
          [undefined, { journalId: journal.value[0]?.id, afterStep: 2 }],
        );
        assert.equal(
          (yield* linePlacesOf({ userId: other, conversationId: target.conversationId }, [
            reviewed,
          ])).size,
          0,
        );
      }),
  );
});

/** A settled turn of the conversation, with usage recorded, as the relay leaves one. */
const settledTurn = (userId: string, conversationId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    yield* db.insert(turns).values({
      id,
      userId,
      conversationId,
      origin: TURN_ORIGIN.TYPED,
      status: TURN_STATUS.SETTLED,
      model: "anthropic/claude-opus-5.5-fast",
      usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0, reasoningTokens: 0 },
    });
    return id;
  });

it.layer(getTestDB())("the coding-agent store's Fast refusals", (it) => {
  it.effect(
    "a turn marked refused Fast reads so beside its usage, and another account's mark writes nothing",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const other = yield* openAccount;
        const agent = yield* openConversation(owner, CONVERSATION_KIND.CODING_AGENT);
        const refused = yield* settledTurn(owner, agent);
        yield* settledTurn(owner, agent);

        yield* recordTurnFastRefused(other, refused);
        const unmarked = yield* turnUsagesOf(owner, agent);
        assert.deepEqual(
          unmarked.map((turn) => turn.fastRefused),
          [false, false],
        );

        yield* recordTurnFastRefused(owner, refused);
        const marked = yield* turnUsagesOf(owner, agent);
        assert.deepEqual(marked.map((turn) => turn.fastRefused).sort(), [false, true]);
      }),
  );
});

/** A workspace the account is a member of, as the organization plugin would leave the rows. */
const openWorkspace = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    const now = yield* DateTime.nowAsDate;
    yield* db
      .insert(organization)
      .values({ id, name: "Test Workspace", slug: `workspace-${id}`, createdAt: now });
    yield* db
      .insert(member)
      .values({ id: randomUUID(), organizationId: id, userId, role: "owner", createdAt: now });
    return id;
  });

/** An agent of the workspace, on no plan as an automation's run leaves one unless a plan is given, on the repository and at the instant given where they are. */
const tasklessAgent = (
  userId: string,
  organizationId: string,
  patch: {
    readonly repository?: string;
    readonly createdAt?: Date;
    readonly taskId?: string;
  } = {},
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    const conversationId = yield* openConversation(userId, CONVERSATION_KIND.CODING_AGENT);
    yield* db.insert(codingAgent).values({
      id,
      organizationId,
      userId,
      conversationId,
      ...(patch.taskId === undefined ? undefined : { taskId: patch.taskId }),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      prompt: "Sweep the flaky tests.",
      repository: patch.repository ?? "acme/api",
      repositories: [patch.repository ?? "acme/api"],
      idempotencyKey: randomUUID(),
      ...(patch.createdAt === undefined ? undefined : { createdAt: patch.createdAt }),
      ...(patch.taskId === undefined ? undefined : { planId: patch.taskId }),
    });
    return { agentId: id, conversationId };
  });

it.layer(getTestDB())("the coding-agent store's agents with no plan", (it) => {
  it.effect(
    "an agent with no plan and its conversation read under its workspace for its starter and a member who did not start it, and as none for an account outside the workspace",
    () =>
      Effect.gen(function* () {
        const starter = yield* openAccount;
        const teammate = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(starter);
        yield* Effect.flatMap(Database, (db) =>
          db.insert(member).values({
            id: randomUUID(),
            organizationId: workspace,
            userId: teammate,
            role: "member",
            createdAt: new Date("2026-10-14T12:00:00Z"),
          }),
        );
        yield* openWorkspace(outsider);
        const { agentId, conversationId } = yield* tasklessAgent(starter, workspace);

        const read = Option.getOrThrow(yield* readCodingAgent(teammate, agentId));
        assert.deepEqual(
          [read.taskId, read.organizationId, read.userId],
          [null, workspace, starter],
        );
        assert.ok(Option.isNone(yield* readCodingAgent(outsider, agentId)));
        assert.deepEqual(
          [
            yield* conversationReachableBy(starter, conversationId),
            yield* conversationReachableBy(teammate, conversationId),
            yield* conversationReachableBy(outsider, conversationId),
          ],
          [true, true, false],
          "the agent's conversation is its workspace's, as its sessions are admitted",
        );
      }),
  );
});

it.layer(getTestDB())("the coding-agent store's agents read by id", (it) => {
  it.effect(
    "agents named by id are read for any member of their workspace, an archived one among them, and as none for an account outside it",
    () =>
      Effect.gen(function* () {
        const starter = yield* openAccount;
        const teammate = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(starter);
        yield* joinWorkspace(workspace, teammate);
        yield* openWorkspace(outsider);
        const first = yield* tasklessAgent(starter, workspace);
        const second = yield* tasklessAgent(starter, workspace);
        yield* archiveCodingAgent(starter, second.agentId, true);

        const read = yield* listPublishedCodingAgentsById(teammate, [
          first.agentId,
          second.agentId,
          randomUUID(),
        ]);
        assert.deepEqual(
          read.map(({ agent, published }) => [agent.id, agent.archivedAt !== null, published]),
          [
            [first.agentId, false, null],
            [second.agentId, true, null],
          ],
        );
        assert.deepEqual(
          yield* listPublishedCodingAgentsById(outsider, [first.agentId, second.agentId]),
          [],
          "another workspace's agents are none of an outsider's",
        );
      }),
  );
});

it.layer(getTestDB())("the coding-agent store's archive of an agent left as it was read", (it) => {
  it.effect(
    "an agent whose conversation's lines moved on since it was read stands, and one whose did not is archived, once",
    () =>
      Effect.gen(function* () {
        const starter = yield* openAccount;
        const workspace = yield* openWorkspace(starter);
        const { agentId, conversationId } = yield* tasklessAgent(starter, workspace);
        const db = yield* Database;
        const [read] = yield* db
          .select({ seq: conversations.nextMessageSeq })
          .from(conversations)
          .where(eq(conversations.id, conversationId));
        assert.ok(read);
        // A message landed after the read, as a developer waking the agent would leave it.
        yield* db
          .update(conversations)
          .set({ nextMessageSeq: read.seq + 1 })
          .where(eq(conversations.id, conversationId));

        const stale = yield* archiveUnmovedCodingAgent(starter, agentId, read.seq);
        const current = yield* archiveUnmovedCodingAgent(starter, agentId, read.seq + 1);
        const again = yield* archiveUnmovedCodingAgent(starter, agentId, read.seq + 1);

        assert.deepEqual([stale, current, again], [false, true, false]);
        assert.ok(Option.getOrThrow(yield* readCodingAgent(starter, agentId)).archivedAt !== null);
      }),
  );
});

it.layer(getTestDB())("the coding-agent store's record of who archived an agent", (it) => {
  it.effect(
    "a member's archive records the member, an idle agent's archive made for a member records who made it and why once, a working one stands, and an unarchive clears only the archive its reader saw",
    () =>
      Effect.gen(function* () {
        const starter = yield* openAccount;
        const teammate = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(starter);
        yield* joinWorkspace(workspace, teammate);
        yield* openWorkspace(outsider);
        const { agentId } = yield* tasklessAgent(starter, workspace);
        const byAgent = {
          by: CODING_AGENT_ARCHIVER.AGENT,
          userId: teammate,
          agentId: randomUUID(),
          agentName: "Billing helper",
          reason: "Its pull request merged.",
        };
        const idle = () => Effect.succeed(true);

        const byMember = yield* archiveCodingAgent(teammate, agentId, true);
        assert.deepEqual(Option.getOrThrow(byMember).archivedBy, {
          by: CODING_AGENT_ARCHIVER.MEMBER,
          userId: teammate,
        });
        const seen = Option.getOrThrow(byMember).archivedAt;
        assert.ok(seen !== null);
        assert.equal(yield* unarchiveCodingAgentFrom(teammate, agentId, seen), true);
        // The archive made again is made later, as any archive after a read of the last one is.
        yield* TestClock.adjust("1 second");
        assert.equal(
          yield* archiveIdleCodingAgent(teammate, agentId, byAgent, () => Effect.succeed(false)),
          IDLE_ARCHIVE.WORKING,
        );
        assert.equal(
          yield* archiveIdleCodingAgent(teammate, agentId, byAgent, idle),
          IDLE_ARCHIVE.ARCHIVED,
        );
        assert.equal(
          yield* archiveIdleCodingAgent(starter, agentId, { ...byAgent, reason: "Again." }, idle),
          IDLE_ARCHIVE.ALREADY,
        );
        const archived = Option.getOrThrow(yield* readCodingAgent(starter, agentId));
        assert.deepEqual(archived.archivedBy, byAgent);
        assert.equal(
          yield* archiveIdleCodingAgent(outsider, agentId, byAgent, idle),
          IDLE_ARCHIVE.NOT_FOUND,
        );
        // An unarchive from the archive a reader saw before it was made again takes nothing.
        assert.equal(yield* unarchiveCodingAgentFrom(starter, agentId, seen), false);
        assert.ok(Option.getOrThrow(yield* readCodingAgent(starter, agentId)).archivedAt !== null);
        const back = Option.getOrThrow(yield* archiveCodingAgent(starter, agentId, false));
        assert.deepEqual([back.archivedAt, back.archivedBy], [null, null]);
      }),
  );
});

it.layer(getTestDB())("the coding-agent store's agents of a workspace", (it) => {
  it.effect(
    "a workspace's agents are listed newest first for any member, an archived one left out unless asked for, narrowed to a repository whatever its case, held to the limit, and none for an account outside it",
    () =>
      Effect.gen(function* () {
        const starter = yield* openAccount;
        const teammate = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(starter);
        const elsewhere = yield* openWorkspace(outsider);
        yield* Effect.flatMap(Database, (db) =>
          db.insert(member).values({
            id: randomUUID(),
            organizationId: workspace,
            userId: teammate,
            role: "member",
            createdAt: new Date("2026-10-14T12:00:00Z"),
          }),
        );
        const at = (hour: number) => new Date(`2026-10-14T${String(hour).padStart(2, "0")}:00:00Z`);
        const oldest = yield* tasklessAgent(starter, workspace, { createdAt: at(8) });
        const web = yield* tasklessAgent(teammate, workspace, {
          repository: "Acme/Web",
          createdAt: at(9),
        });
        const archived = yield* tasklessAgent(starter, workspace, { createdAt: at(10) });
        const newest = yield* tasklessAgent(starter, workspace, { createdAt: at(11) });
        yield* tasklessAgent(outsider, elsewhere, { createdAt: at(12) });
        yield* Effect.flatMap(Database, (db) =>
          db
            .update(codingAgent)
            .set({ archivedAt: at(13) })
            .where(eq(codingAgent.id, archived.agentId)),
        );
        const ids = (agents: readonly { readonly id: string }[]) => agents.map((agent) => agent.id);

        assert.deepEqual(
          ids(yield* listWorkspaceCodingAgents(teammate, workspace, { limit: 10 })),
          [newest.agentId, web.agentId, oldest.agentId],
        );
        assert.deepEqual(
          ids(
            yield* listWorkspaceCodingAgents(starter, workspace, {
              repository: "acme/web",
              limit: 10,
            }),
          ),
          [web.agentId],
        );
        assert.deepEqual(
          ids(
            yield* listWorkspaceCodingAgents(teammate, workspace, {
              includeArchived: true,
              limit: 10,
            }),
          ),
          [newest.agentId, archived.agentId, web.agentId, oldest.agentId],
        );
        assert.deepEqual(ids(yield* listWorkspaceCodingAgents(starter, workspace, { limit: 2 })), [
          newest.agentId,
          web.agentId,
        ]);
        assert.deepEqual(yield* listWorkspaceCodingAgents(outsider, workspace, { limit: 10 }), []);

        // An agent on a plan is listed with the rest, and alone where its plan is named.
        const invitations = yield* createTask(teammate, {
          organizationId: workspace,
          name: "Teammate invitations",
        });
        const archivedTask = yield* createTask(starter, { organizationId: workspace, name: "Old" });
        yield* Effect.flatMap(Database, (db) =>
          db
            .update(task)
            .set({ archivedAt: at(14) })
            .where(eq(task.id, archivedTask.id)),
        );
        const onTask = yield* tasklessAgent(teammate, workspace, {
          taskId: invitations.id,
          createdAt: at(15),
        });
        assert.deepEqual(
          ids(
            yield* listWorkspaceCodingAgents(starter, workspace, {
              taskId: invitations.id,
              includeArchived: true,
              limit: 10,
            }),
          ),
          [onTask.agentId],
        );
        assert.equal(
          ids(yield* listWorkspaceCodingAgents(starter, workspace, { limit: 10 }))[0],
          onTask.agentId,
        );
        const elsewhereTask = yield* createTask(outsider, {
          organizationId: elsewhere,
          name: "Elsewhere",
        });
        const names = yield* taskNamesOf(starter, [
          invitations.id,
          archivedTask.id,
          elsewhereTask.id,
          invitations.id,
        ]);
        assert.equal(names.size, 2, "a plan of a workspace the account is not in names nothing");
        assert.deepEqual(names.get(invitations.id), {
          name: "Teammate invitations",
          archived: false,
        });
        assert.deepEqual(names.get(archivedTask.id), { name: "Old", archived: true });
        assert.equal((yield* taskNamesOf(outsider, [invitations.id])).size, 0);
        assert.deepEqual(
          yield* listWorkspaceCodingAgents(outsider, workspace, {
            includeArchived: true,
            limit: 10,
          }),
          [],
        );
      }),
  );
});

it.layer(getTestDB())("the coding-agent store's author of an agent", (it) => {
  it.effect(
    "the first author settled stands against a later settle, a recorded one replaces it, and an account outside the workspace writes nothing",
    () =>
      Effect.gen(function* () {
        const starter = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(starter);
        yield* openWorkspace(outsider);
        const { agentId } = yield* tasklessAgent(starter, workspace);
        const before = Option.getOrThrow(yield* readCodingAgent(starter, agentId)).author;

        const refused = yield* settleCodingAgentAuthor(
          outsider,
          agentId,
          CODING_AGENT_AUTHOR.APP_UNLINKED,
        );
        const first = yield* settleCodingAgentAuthor(
          starter,
          agentId,
          CODING_AGENT_AUTHOR.DEVELOPER,
        );
        const second = yield* settleCodingAgentAuthor(
          starter,
          agentId,
          CODING_AGENT_AUTHOR.APP_UNREAD,
        );

        assert.equal(before, null);
        assert.ok(Option.isNone(refused));
        assert.deepEqual(
          [first, second],
          [Option.some(CODING_AGENT_AUTHOR.DEVELOPER), Option.some(CODING_AGENT_AUTHOR.DEVELOPER)],
        );
        assert.equal(
          Option.getOrThrow(yield* readCodingAgent(starter, agentId)).author,
          CODING_AGENT_AUTHOR.DEVELOPER,
        );

        // Recorded over, as an opening the App made in the developer's place records why; never by an outsider.
        yield* recordCodingAgentAuthor(outsider, agentId, CODING_AGENT_AUTHOR.APP_NO_PUSH);
        yield* recordCodingAgentAuthor(starter, agentId, CODING_AGENT_AUTHOR.APP_UNLINKED);
        assert.equal(
          Option.getOrThrow(yield* readCodingAgent(starter, agentId)).author,
          CODING_AGENT_AUTHOR.APP_UNLINKED,
        );
      }),
  );
});

it.layer(getTestDB())("the coding-agent store's agents with no plan of an account", (it) => {
  it.effect(
    "every agent with no plan in the account's workspaces is listed newest first, by any member, an archived one only where asked for, none on a plan, and none for an account outside them",
    () =>
      Effect.gen(function* () {
        const starter = yield* openAccount;
        const teammate = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(starter);
        const elsewhere = yield* openWorkspace(outsider);
        yield* Effect.flatMap(Database, (db) =>
          db.insert(member).values({
            id: randomUUID(),
            organizationId: workspace,
            userId: teammate,
            role: "member",
            createdAt: new Date("2026-10-14T12:00:00Z"),
          }),
        );
        const at = (hour: number) => new Date(`2026-10-14T${String(hour).padStart(2, "0")}:00:00Z`);
        const task = yield* createTask(starter, { organizationId: workspace, name: "Billing" });
        const oldest = yield* tasklessAgent(starter, workspace, { createdAt: at(8) });
        yield* tasklessAgent(starter, workspace, { createdAt: at(9), taskId: task.id });
        const archived = yield* tasklessAgent(teammate, workspace, { createdAt: at(10) });
        const newest = yield* tasklessAgent(teammate, workspace, { createdAt: at(11) });
        const outside = yield* tasklessAgent(outsider, elsewhere, { createdAt: at(12) });
        yield* Effect.flatMap(Database, (db) =>
          db
            .update(codingAgent)
            .set({ archivedAt: at(13) })
            .where(eq(codingAgent.id, archived.agentId)),
        );
        const ids = (agents: readonly { readonly id: string }[]) => agents.map((agent) => agent.id);

        assert.deepEqual(ids(yield* listTasklessCodingAgents(starter)), [
          newest.agentId,
          oldest.agentId,
        ]);
        assert.deepEqual(
          ids(yield* listTasklessCodingAgents(teammate, { includeArchived: true })),
          [newest.agentId, archived.agentId, oldest.agentId],
        );
        assert.deepEqual(ids(yield* listTasklessCodingAgents(outsider)), [outside.agentId]);
      }),
  );
});

it.layer(getTestDB())("the coding-agent store's kept pull request", (it) => {
  /** The pull request as the wire carries it, which is what the task list reads. */
  const onTheWire = {
    number: 7,
    title: "Expire teammate invitations",
    url: "https://github.com/acme/relay/pull/7",
    state: PULL_REQUEST_STATE.MERGED,
    checks: CHECK_SUMMARY.PASSING,
    additions: 12,
    deletions: 3,
    changedFiles: 2,
  };

  it.effect(
    "a merged pull request is read back whole, its head, merge instant, and areas among it, by a member of the agent's workspace, while the list reads only what the wire carries and an outsider reads none",
    () =>
      Effect.gen(function* () {
        const starter = yield* openAccount;
        const teammate = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(starter);
        yield* joinWorkspace(workspace, teammate);
        yield* openWorkspace(outsider);
        const { agentId } = yield* tasklessAgent(starter, workspace);
        const kept = {
          ...onTheWire,
          headSha: "c0ffee1",
          mergedAt: Date.parse("2026-10-17T09:00:00Z"),
          areas: [
            { path: "packages/service/src/agents", additions: 10, deletions: 2 },
            { path: ".", additions: 2, deletions: 1 },
          ],
        };

        yield* recordCodingAgentPublished(starter, agentId, kept);

        assert.deepEqual(yield* readCodingAgentPublished(teammate, agentId), kept);
        const listed = yield* listPublishedCodingAgentsById(teammate, [agentId]);
        assert.deepEqual(
          listed.map(({ published }) => published),
          [onTheWire],
        );
        assert.equal(yield* readCodingAgentPublished(outsider, agentId), null);
      }),
  );

  it.effect(
    "a row kept before the merge instant and areas were reads back as it was written, and an agent that published nothing reads none",
    () =>
      Effect.gen(function* () {
        const starter = yield* openAccount;
        const workspace = yield* openWorkspace(starter);
        const { agentId } = yield* tasklessAgent(starter, workspace);
        const quiet = yield* tasklessAgent(starter, workspace);
        // Written past the store, as a row from before the keys were kept stands.
        yield* Effect.flatMap(Database, (db) =>
          db.update(codingAgent).set({ published: onTheWire }).where(eq(codingAgent.id, agentId)),
        );

        assert.deepEqual(yield* readCodingAgentPublished(starter, agentId), onTheWire);
        assert.deepEqual(
          (yield* listPublishedCodingAgentsById(starter, [agentId])).map(
            ({ published }) => published,
          ),
          [onTheWire],
        );
        assert.equal(yield* readCodingAgentPublished(starter, quiet.agentId), null);
      }),
  );
});

it.layer(getTestDB())("the coding-agent store's agents of a workspace's world", (it) => {
  /** A pull request as the row keeps it, in the state given, merged at the instant given where it merged. */
  const keptPullRequest = (number: number, state: PullRequestState, mergedAt?: number) => ({
    number,
    title: `Change ${number}`,
    url: `https://github.com/acme/relay/pull/${number}`,
    state,
    checks: CHECK_SUMMARY.PASSING,
    additions: 4,
    deletions: 1,
    changedFiles: 1,
    areas: [{ path: "packages/api", additions: 4, deletions: 1 }],
    ...(mergedAt === undefined ? undefined : { mergedAt }),
  });
  const since = Date.parse("2026-10-11T00:00:00Z");
  const at = (hour: number) => new Date(`2026-10-14T${String(hour).padStart(2, "0")}:00:00Z`);

  it.effect(
    "a member reads every standing agent first, then of the archived those whose pull request is still open or merged within the window, newest started first, each with its pull request whole and its plan's Linear issue, while an account outside the workspace reads none",
    () =>
      Effect.gen(function* () {
        const starter = yield* openAccount;
        const teammate = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(starter);
        yield* joinWorkspace(workspace, teammate);
        yield* openWorkspace(outsider);
        const linked = yield* createTask(starter, {
          organizationId: workspace,
          name: "Invite expiry",
          issueLinks: [
            linearIssueLink({
              identifier: "ENG-7",
              title: "Expire invitations",
              url: "https://linear.app/acme/issue/ENG-7",
            }),
          ],
        });
        const archive = (agentId: string) =>
          Effect.asVoid(archiveCodingAgent(starter, agentId, true));
        const standing = yield* tasklessAgent(starter, workspace, {
          taskId: linked.id,
          createdAt: at(1),
        });
        const open = yield* tasklessAgent(starter, workspace, { createdAt: at(2) });
        yield* recordCodingAgentPublished(
          starter,
          open.agentId,
          keptPullRequest(1, PULL_REQUEST_STATE.OPEN),
        );
        yield* archive(open.agentId);
        const shipped = keptPullRequest(2, PULL_REQUEST_STATE.MERGED, since + 1);
        const recent = yield* tasklessAgent(starter, workspace, { createdAt: at(3) });
        yield* recordCodingAgentPublished(starter, recent.agentId, shipped);
        yield* archive(recent.agentId);
        const old = yield* tasklessAgent(starter, workspace, { createdAt: at(4) });
        yield* recordCodingAgentPublished(
          starter,
          old.agentId,
          keptPullRequest(3, PULL_REQUEST_STATE.MERGED, since - 1),
        );
        yield* archive(old.agentId);
        const idle = yield* tasklessAgent(starter, workspace, { createdAt: at(5) });
        yield* archive(idle.agentId);

        const read = yield* listWorldCodingAgents(teammate, workspace, {
          mergedSince: since,
          limit: 10,
        });

        assert.deepEqual(
          read.map(({ agent, published, linearIssue }) => [agent.id, published, linearIssue]),
          [
            [standing.agentId, null, "ENG-7"],
            [recent.agentId, shipped, null],
            [open.agentId, keptPullRequest(1, PULL_REQUEST_STATE.OPEN), null],
          ],
        );
        assert.deepEqual(
          yield* listWorldCodingAgents(outsider, workspace, { mergedSince: since, limit: 10 }),
          [],
        );
      }),
  );
});

it.layer(getTestDB())("the coding-agent store's agents by their pull request", (it) => {
  it.effect(
    "a delivery about a repository's pull request finds the agents of any account that published it, newest first, whatever case it spells the repository in, and none that published another or the same number in another repository",
    () =>
      Effect.gen(function* () {
        const dean = yield* openAccount;
        const charles = yield* openAccount;
        const deans = yield* openWorkspace(dean);
        const charless = yield* openWorkspace(charles);
        const pullRequest = (number: number) => ({
          number,
          title: "Invite flow",
          url: `https://github.com/acme/relay/pull/${number}`,
          state: PULL_REQUEST_STATE.OPEN,
          checks: CHECK_SUMMARY.PASSING,
          additions: 1,
          deletions: 0,
          changedFiles: 1,
        });
        const author = yield* tasklessAgent(dean, deans, { createdAt: new Date(1_000) });
        const reviewer = yield* tasklessAgent(charles, charless, { createdAt: new Date(2_000) });
        const other = yield* tasklessAgent(dean, deans);
        const elsewhere = yield* tasklessAgent(dean, deans, { repository: "acme/web" });
        // An agent that published nothing yet is found by no pull request.
        yield* tasklessAgent(dean, deans);
        yield* recordCodingAgentPublished(dean, author.agentId, pullRequest(12));
        yield* recordCodingAgentPublished(charles, reviewer.agentId, pullRequest(12));
        yield* recordCodingAgentPublished(dean, other.agentId, pullRequest(13));
        yield* recordCodingAgentPublished(dean, elsewhere.agentId, pullRequest(12));

        const found = yield* listCodingAgentsOnPullRequest("acme/api", 12, 10);
        assert.deepEqual(
          found.map(({ userId, agent }) => [userId, agent.id]),
          [
            [charles, reviewer.agentId],
            [dean, author.agentId],
          ],
        );
        assert.equal((yield* listCodingAgentsOnPullRequest("acme/api", 12, 1)).length, 1);
        // GitHub may spell the repository in another case than the agent's row does.
        assert.equal((yield* listCodingAgentsOnPullRequest("Acme/API", 12, 10)).length, 2);
        assert.deepEqual(yield* listCodingAgentsOnPullRequest("acme/api", 99, 10), []);
      }),
  );
});

/** Dean's workspace with Charles a member of it, and an agent an automation of Dean's started there with no plan. */
const openSharedAgent = Effect.gen(function* () {
  const dean = yield* openAccount;
  const charles = yield* openAccount;
  const workspace = yield* openWorkspace(dean);
  yield* joinWorkspace(workspace, charles);
  const { agentId } = yield* tasklessAgent(dean, workspace);
  return { dean, charles, agentId };
});

/** The agent's pin as the account's list reads it, archived agents among the rest; none where the list holds no pin of it. */
const pinReadBy = (userId: string, agentId: string) =>
  Effect.map(listTasklessCodingAgents(userId, { includeArchived: true }), (agents) =>
    agents.find(({ id }) => id === agentId)?.pinnedAt?.getTime(),
  );

const pinnedOnes = (agentId: string) =>
  Database.use((db) =>
    db
      .select({ userId: agentPin.userId })
      .from(agentPin)
      .where(eq(agentPin.codingAgentId, agentId)),
  );

it.layer(getTestDB())("an agent's pin", (it) => {
  it.effect("a member's pin of an agent with no plan reads pinned for them alone", () =>
    Effect.gen(function* () {
      const { dean, charles, agentId } = yield* openSharedAgent;
      const pinnedAt = yield* Clock.currentTimeMillis;

      const answered = yield* pinCodingAgent(charles, agentId, true);

      assert.equal(Option.getOrUndefined(answered)?.id, agentId);
      assert.equal(yield* pinReadBy(charles, agentId), pinnedAt);
      assert.equal(yield* pinReadBy(dean, agentId), undefined);
    }),
  );

  it.effect("unpinning takes away only the account's own pin", () =>
    Effect.gen(function* () {
      const { dean, charles, agentId } = yield* openSharedAgent;
      yield* pinCodingAgent(dean, agentId, true);
      yield* TestClock.adjust("1 minute");
      const charlesPinnedAt = yield* Clock.currentTimeMillis;
      yield* pinCodingAgent(charles, agentId, true);

      yield* pinCodingAgent(dean, agentId, false);

      assert.equal(yield* pinReadBy(dean, agentId), undefined);
      assert.equal(yield* pinReadBy(charles, agentId), charlesPinnedAt);
    }),
  );

  it.effect(
    "an agent pinned again keeps its first instant, and an archive and its return leave the pin standing",
    () =>
      Effect.gen(function* () {
        const { dean, agentId } = yield* openSharedAgent;
        const pinnedAt = yield* Clock.currentTimeMillis;
        yield* pinCodingAgent(dean, agentId, true);
        yield* TestClock.adjust("1 minute");

        yield* pinCodingAgent(dean, agentId, true);
        assert.equal(yield* pinReadBy(dean, agentId), pinnedAt);
        yield* archiveCodingAgent(dean, agentId, true);
        assert.equal(yield* pinReadBy(dean, agentId), pinnedAt);
        yield* archiveCodingAgent(dean, agentId, false);
        assert.equal(yield* pinReadBy(dean, agentId), pinnedAt);
      }),
  );

  it.effect(
    "an agent's pin dragged to a position keeps its first instant, and is the dragging member's alone",
    () =>
      Effect.gen(function* () {
        const { dean, charles, agentId } = yield* openSharedAgent;
        const pinnedAt = yield* Clock.currentTimeMillis;
        yield* pinCodingAgent(dean, agentId, true);
        yield* pinCodingAgent(charles, agentId, true);
        yield* TestClock.adjust("1 minute");

        yield* pinCodingAgent(dean, agentId, true, "a1");
        yield* pinCodingAgent(dean, agentId, true, "Zz");
        yield* pinCodingAgent(dean, agentId, true);

        const listed = (agents: readonly { id: string; pinPosition: string | null }[]) =>
          agents.find(({ id }) => id === agentId)?.pinPosition;
        assert.equal(listed(yield* listTasklessCodingAgents(dean)), "Zz");
        assert.equal(yield* pinReadBy(dean, agentId), pinnedAt);
        assert.equal(listed(yield* listTasklessCodingAgents(charles)), null);

        yield* pinCodingAgent(dean, agentId, false);
        yield* pinCodingAgent(dean, agentId, true);
        assert.equal(listed(yield* listTasklessCodingAgents(dean)), null);
      }),
  );

  it.effect("an account outside the workspace can neither pin the agent nor read a pin of it", () =>
    Effect.gen(function* () {
      const { dean, agentId } = yield* openSharedAgent;
      const outsider = yield* openAccount;
      yield* pinCodingAgent(dean, agentId, true);

      assert.ok(Option.isNone(yield* pinCodingAgent(outsider, agentId, true)));
      assert.ok(Option.isNone(yield* pinCodingAgent(outsider, agentId, false)));
      assert.deepEqual(yield* listTasklessCodingAgents(outsider, { includeArchived: true }), []);
      assert.deepEqual(yield* pinnedOnes(agentId), [{ userId: dean }]);
    }),
  );

  it.effect(
    "an agent on a plan is not pinned, since only an agent with no plan stands in the sidebar",
    () =>
      Effect.gen(function* () {
        const dean = yield* openAccount;
        const workspace = yield* openWorkspace(dean);
        const task = yield* createTask(dean, { organizationId: workspace, name: "Billing" });
        const { agentId } = yield* tasklessAgent(dean, workspace, { taskId: task.id });

        assert.ok(Option.isNone(yield* pinCodingAgent(dean, agentId, true)));
        assert.deepEqual(yield* pinnedOnes(agentId), []);
      }),
  );

  it.effect("an agent's pins go with the agent, and an account's with the account", () =>
    Effect.gen(function* () {
      const { dean, charles, agentId } = yield* openSharedAgent;
      yield* pinCodingAgent(dean, agentId, true);
      yield* pinCodingAgent(charles, agentId, true);

      yield* Database.use((db) => db.delete(user).where(eq(user.id, charles)));
      assert.deepEqual(yield* pinnedOnes(agentId), [{ userId: dean }]);
      yield* Database.use((db) => db.delete(codingAgent).where(eq(codingAgent.id, agentId)));
      assert.deepEqual(yield* pinnedOnes(agentId), []);
    }),
  );
});

it.layer(getTestDB())("the coding-agent store's agent started from another", (it) => {
  it.effect(
    "an agent started from another keeps that agent, the message it forked at, and its replay's counts, read by a teammate as by its starter, and one started afresh reads from none",
    () =>
      Effect.gen(function* () {
        const starter = yield* openAccount;
        const teammate = yield* openAccount;
        const workspace = yield* openWorkspace(starter);
        yield* joinWorkspace(workspace, teammate);
        const task = yield* createTask(starter, { organizationId: workspace, name: "Billing" });
        const choice = { model: "anthropic/claude-opus-5.5", effort: "high" };
        const source = Option.getOrThrow(
          yield* createCodingAgent(starter, {
            taskId: task.id,
            planSnapshot: "# Billing",
            prompt: null,
            idempotencyKey: randomUUID(),
            ...choice,
            repository: "acme/api",
          }),
        ).agent;
        const startedFrom = {
          agentId: source.id,
          messageId: randomUUID(),
          steps: 12,
          totalSteps: 40,
        };
        const forked = Option.getOrThrow(
          yield* createCodingAgent(teammate, {
            taskId: task.id,
            planSnapshot: "# Billing",
            prompt: null,
            idempotencyKey: randomUUID(),
            ...choice,
            repository: "acme/api",
            startedFrom,
          }),
        ).agent;

        assert.deepEqual(source.startedFrom, null);
        assert.deepEqual(forked.startedFrom, startedFrom);
        assert.deepEqual(
          Option.getOrThrow(yield* readCodingAgent(starter, forked.id)).startedFrom,
          startedFrom,
        );
      }),
  );

  it.effect(
    "an agent's continues and forks are read by its id oldest first, an archived one among them, by a teammate as by its starter, and by no outsider",
    () =>
      Effect.gen(function* () {
        const starter = yield* openAccount;
        const teammate = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(starter);
        yield* joinWorkspace(workspace, teammate);
        const task = yield* createTask(starter, { organizationId: workspace, name: "Billing" });
        const startOn = (
          by: string,
          createdAt: string,
          startedFrom?: { agentId: string; messageId?: string },
        ) =>
          Effect.gen(function* () {
            const { agent } = Option.getOrThrow(
              yield* createCodingAgent(by, {
                taskId: task.id,
                planSnapshot: "# Billing",
                prompt: null,
                idempotencyKey: randomUUID(),
                model: "anthropic/claude-opus-5.5",
                effort: "high",
                repository: "acme/api",
                ...(startedFrom === undefined
                  ? undefined
                  : { startedFrom: { ...startedFrom, steps: 3, totalSteps: 3 } }),
              }),
            );
            yield* Database.use((db) =>
              db
                .update(codingAgent)
                .set({ createdAt: new Date(createdAt) })
                .where(eq(codingAgent.id, agent.id)),
            );
            return agent.id;
          });
        const source = yield* startOn(starter, "2026-10-17T10:00:00Z");
        const messageId = randomUUID();
        const fork = yield* startOn(teammate, "2026-10-17T10:02:00Z", {
          agentId: source,
          messageId,
        });
        const continued = yield* startOn(starter, "2026-10-17T10:01:00Z", { agentId: source });
        const again = yield* startOn(starter, "2026-10-17T10:03:00Z", { agentId: continued });
        yield* archiveCodingAgent(starter, continued, true);

        yield* renameCodingAgent(teammate, fork, "Bill by seat");
        const expected = new Map([
          [
            source,
            [
              { agentId: continued, title: null },
              { agentId: fork, title: "Bill by seat", messageId },
            ],
          ],
          [continued, [{ agentId: again, title: null }]],
        ]);
        const asked = [source, continued, again];
        assert.deepEqual(yield* continuationsOf(starter, asked), expected);
        assert.deepEqual(yield* continuationsOf(teammate, asked), expected);
        assert.deepEqual(yield* continuationsOf(outsider, asked), new Map());
      }),
  );

  it.effect(
    "a source started from more agents than its summary names keeps its oldest twenty, and hides none of another source's, however many it has",
    () =>
      Effect.gen(function* () {
        const starter = yield* openAccount;
        const workspace = yield* openWorkspace(starter);
        const task = yield* createTask(starter, { organizationId: workspace, name: "Billing" });
        const startOn = (createdAt: Date, agentId?: string) =>
          Effect.gen(function* () {
            const { agent } = Option.getOrThrow(
              yield* createCodingAgent(starter, {
                taskId: task.id,
                planSnapshot: "# Billing",
                prompt: null,
                idempotencyKey: randomUUID(),
                model: "anthropic/claude-opus-5.5",
                effort: "high",
                repository: "acme/api",
                ...(agentId === undefined
                  ? undefined
                  : { startedFrom: { agentId, steps: 1, totalSteps: 1 } }),
              }),
            );
            yield* Database.use((db) =>
              db.update(codingAgent).set({ createdAt }).where(eq(codingAgent.id, agent.id)),
            );
            return agent.id;
          });
        const at = (minute: number) => new Date(Date.UTC(2026, 9, 17, 10, minute));
        const busy = yield* startOn(at(0));
        const quiet = yield* startOn(at(0));
        const continues: string[] = [];
        for (let minute = 1; minute <= 41; minute += 1) {
          continues.push(yield* startOn(at(minute), busy));
        }
        const latest = yield* startOn(at(50), quiet);

        const read = yield* continuationsOf(starter, [busy, quiet]);

        assert.deepEqual(
          read.get(busy)?.map((each) => each.agentId),
          continues.slice(0, 20),
        );
        assert.deepEqual(read.get(quiet), [{ agentId: latest, title: null }]);
      }),
  );
});

it.layer(getTestDB())("the GitHub access a task and an agent recorded", (it) => {
  it.effect(
    "the access a repository was reached through is kept on the task that named it and the agent a Start made, and one that names none is the App's",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const starter = yield* openAccount;
        const workspace = yield* openWorkspace(starter);
        const onToken = yield* createTask(starter, {
          organizationId: workspace,
          repository: "octo-member/side",
          githubAccess: GITHUB_ACCESS.TOKEN,
        });
        const onApp = yield* createTask(starter, {
          organizationId: workspace,
          repository: "acme/api",
        });
        const start = (taskId: string, githubAccess?: typeof GITHUB_ACCESS.TOKEN) =>
          createCodingAgent(starter, {
            taskId,
            planSnapshot: "# Billing",
            prompt: null,
            idempotencyKey: randomUUID(),
            model: "anthropic/claude-opus-5.5",
            effort: "high",
            repository: "octo-member/side",
            ...(githubAccess === undefined ? undefined : { githubAccess }),
          });
        const tokenAgent = Option.getOrThrow(yield* start(onToken.id, GITHUB_ACCESS.TOKEN)).agent;
        const appAgent = Option.getOrThrow(yield* start(onApp.id)).agent;
        const accessOf = (taskId: string) =>
          Effect.map(
            db.select({ access: task.githubAccess }).from(task).where(eq(task.id, taskId)),
            (rows) => rows[0]?.access,
          );

        assert.equal(yield* accessOf(onToken.id), GITHUB_ACCESS.TOKEN);
        assert.equal(yield* accessOf(onApp.id), GITHUB_ACCESS.APP);
        assert.equal(
          Option.getOrThrow(yield* readCodingAgent(starter, tokenAgent.id)).githubAccess,
          GITHUB_ACCESS.TOKEN,
        );
        assert.equal(appAgent.githubAccess, GITHUB_ACCESS.APP);
      }),
  );
});

it.layer(getTestDB())("the coding-agent store's GitHub access", (it) => {
  it.effect(
    "an agent keeps how its repository was reached as it started, read back by its starter, and one started with none named reads as the App's",
    () =>
      Effect.gen(function* () {
        const starter = yield* openAccount;
        const workspace = yield* openWorkspace(starter);
        const task = yield* createTask(starter, { organizationId: workspace, name: "Billing" });
        const startOn = (githubAccess?: GitHubAccess) =>
          Effect.map(
            createCodingAgent(starter, {
              taskId: task.id,
              planSnapshot: "# Billing",
              prompt: null,
              idempotencyKey: randomUUID(),
              model: "anthropic/claude-opus-5.5",
              effort: "high",
              repository: "acme/api",
              ...(githubAccess === undefined ? undefined : { githubAccess }),
            }),
            (started) => Option.getOrThrow(started).agent,
          );

        const onToken = yield* startOn(GITHUB_ACCESS.TOKEN);
        const unnamed = yield* startOn();

        assert.equal(
          Option.getOrThrow(yield* readCodingAgent(starter, onToken.id)).githubAccess,
          GITHUB_ACCESS.TOKEN,
        );
        assert.equal(unnamed.githubAccess, GITHUB_ACCESS.APP);
      }),
  );
});

it.layer(getTestDB())("the coding-agent store's list lines", (it) => {
  /** Text the size of a long plan, which an agent may be handed and no line carries. */
  const largeText = "Any member may invite a teammate by email.\n".repeat(6_000);

  /** What a line says of an agent, and which of the text columns it carries, which should be none. */
  const said = (line: CodingAgentLine) => ({
    id: line.id,
    title: line.title,
    handedPrompt: line.handedPrompt,
    automationName: line.automationName,
    startedFrom: line.startedFrom,
    text: ["planSnapshot", "prompt", "automationOrigin"].filter((column) => column in line),
  });

  /** The agent a Start made, failing the test where it made none. */
  const made = (answer: Option.Option<{ readonly agent: CodingAgent }>) =>
    Option.getOrElse(answer, () => assert.fail("the start made no agent")).agent;

  it.effect(
    "every list reads an agent handed a large plan, a prompt, or an automation's run as its line: its brief, its automation's name, and its source, with none of the text, for a member alone",
    () =>
      Effect.gen(function* () {
        const starter = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(starter);
        const onTask = yield* createTask(starter, { organizationId: workspace, name: "Invites" });
        const asked = {
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          repository: "acme/api",
        };
        const snapshotted = made(
          yield* createCodingAgent(starter, {
            ...asked,
            taskId: onTask.id,
            planSnapshot: largeText,
            prompt: null,
            title: "Invite emails",
            idempotencyKey: randomUUID(),
          }),
        );
        yield* TestClock.adjust("1 minute");
        const source = { agentId: snapshotted.id, steps: 2, totalSteps: 4 };
        const continued = made(
          yield* createCodingAgent(starter, {
            ...asked,
            taskId: onTask.id,
            planSnapshot: null,
            prompt: largeText,
            startedFrom: source,
            idempotencyKey: randomUUID(),
          }),
        );
        yield* TestClock.adjust("1 minute");
        const run = made(
          yield* createCodingAgent(starter, {
            ...asked,
            taskId: null,
            organizationId: workspace,
            planSnapshot: null,
            prompt: largeText,
            automationOrigin: {
              name: "Nightly triage",
              firing: { kind: "webhook", bytes: largeText.length },
              prompt: largeText,
              body: largeText,
            },
            idempotencyKey: randomUUID(),
          }),
        );
        const lines = {
          snapshotted: {
            id: snapshotted.id,
            title: "Invite emails",
            handedPrompt: false,
            automationName: null,
            startedFrom: null,
            text: [],
          },
          continued: {
            id: continued.id,
            title: null,
            handedPrompt: true,
            automationName: null,
            startedFrom: source,
            text: [],
          },
          run: {
            id: run.id,
            title: null,
            handedPrompt: true,
            automationName: "Nightly triage",
            startedFrom: null,
            text: [],
          },
        };

        assert.deepEqual((yield* listCodingAgentLines(starter, onTask.id)).map(said), [
          lines.snapshotted,
          lines.continued,
        ]);
        assert.deepEqual(
          (yield* listPublishedCodingAgents(starter, [onTask.id])).map(({ agent }) => said(agent)),
          [lines.snapshotted, lines.continued],
        );
        assert.deepEqual(
          (yield* listWorkspaceCodingAgentLines(starter, workspace, { limit: 10 })).map(said),
          [lines.run, lines.continued, lines.snapshotted],
        );
        assert.deepEqual((yield* listTasklessCodingAgents(starter)).map(said), [lines.run]);

        // Every other column reads as a whole read reads it, and the line a whole read draws is the listed one.
        const whole = Option.getOrThrow(yield* readCodingAgent(starter, run.id));
        const {
          automationOrigin: _origin,
          planSnapshot: _snapshot,
          prompt: _prompt,
          ...rest
        } = whole;
        const expected = { ...rest, automationName: "Nightly triage", handedPrompt: true };
        const [listed] = yield* listWorkspaceCodingAgentLines(starter, workspace, { limit: 1 });
        assert.deepEqual(listed, expected);
        assert.deepEqual(codingAgentLineOf(whole), expected);

        assert.deepEqual(yield* listCodingAgentLines(outsider, onTask.id), []);
        assert.deepEqual(
          yield* listWorkspaceCodingAgentLines(outsider, workspace, { limit: 10 }),
          [],
        );
      }),
  );
});
