import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { CHANNEL_KIND, CHAT_BOUNDS, MEMBER_KIND } from "@luke/features/chat-wire";
import { and, eq } from "drizzle-orm";
import { DateTime, Effect, Option, Result } from "effect";
import { Database } from "../../core/query.js";
import { member, organization, user } from "../../schemas/auth.js";
import { getTestDB } from "../../testing/index.js";
import {
  CHAT_REFUSAL,
  channelsOf,
  ensureGeneral,
  ensureMember,
  ensurePlanChannel,
  findOrMakeDm,
  leave,
  openTopicChannel,
  roster,
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
