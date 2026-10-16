import {
  CHANNEL_KIND,
  CHAT_BOUNDS,
  GENERAL_CHANNEL,
  MEMBER_KIND,
  PLANNER_HANDLE,
} from "@luke/features/chat-wire";
import { and, asc, eq, isNull, max, ne, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Result, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { organization, user } from "../schemas/auth.js";
import { chatChannel, chatMember } from "../schemas/chat.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { task } from "../schemas/plan.js";
import { InstantColumnSchema } from "./columns.js";
import { isWorkspaceMember, taskReachableBy } from "./workspace-store.js";

/**
 * chat-store.ts -- a workspace's chat as the store keeps it: its members and its channels.
 *
 * Every function is an effect over the ambient database, gated on the
 * account acting: a person in the workspace, or the account that started
 * the coding agent or the plan acting, which must be in the workspace too.
 * A workspace that account is not in reads as nothing. A member is minted
 * once under the workspace's lock, the `organization` row held for the
 * transaction, so two mints at once take turns over the handles and
 * ordinals standing and never mint one twice; a channel a name is picked
 * for is made under the same lock. A person's handle is a slug of their
 * name with `-2`, `-3`, … on a clash, and never `luke` or an agent's
 * `agent-N`, which are spoken for. A channel is found or made by what names
 * it, the general one by its name, a plan's by its plan, a DM by its pair,
 * so asking twice answers the same row.
 */

/** What a chat store effect answers: an effect over the ambient database. */
export type ChatStoreEffect<A> = Effect.Effect<
  A,
  QueryError | Schema.SchemaError,
  DatabaseServices
>;

/** Why a topic channel was not opened. */
export const CHAT_REFUSAL = {
  /** The account is not in the workspace, or the member opening it is not of it. */
  NOT_FOUND: "not-found",
  /** A channel of another kind, or an archived one, already stands under the name. */
  NAME_TAKEN: "name-taken",
  /** The workspace keeps as many topic channels open as it may. */
  TOO_MANY_TOPICS: "too-many-topics",
} as const;

export type ChatRefusal = (typeof CHAT_REFUSAL)[keyof typeof CHAT_REFUSAL];

/** Who a member stands for: a person in the workspace, a coding agent on one of its plans, or one of its plans' planner. */
export type ChatMemberSubject =
  | { readonly kind: typeof MEMBER_KIND.HUMAN; readonly userId: string }
  | { readonly kind: typeof MEMBER_KIND.AGENT; readonly agentId: string }
  | { readonly kind: typeof MEMBER_KIND.PLANNER; readonly planId: string };

/** The longest a person's handle is spelled before a clash's suffix. */
const MAX_HANDLE_STEM_CHARS = 32;

/** The handle a person's name spells nothing of. */
const FALLBACK_HANDLE = "member";

/** The handles no person is minted: every planner's, and the shape of an agent's. */
const SPOKEN_FOR = /^(luke|agent-\d+)$/u;

const ChatMemberRowSchema = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  kind: Schema.Literals(Object.values(MEMBER_KIND)),
  userId: Schema.NullOr(Schema.String),
  agentId: Schema.NullOr(Schema.String),
  planId: Schema.NullOr(Schema.String),
  handle: Schema.String,
  ordinal: Schema.Number,
  readSeq: Schema.Number,
  noticeSeq: Schema.NullOr(Schema.Number),
  joinedAt: InstantColumnSchema,
  leftAt: Schema.NullOr(InstantColumnSchema),
});

/** One member as the store keeps it. */
export type ChatMemberRow = typeof ChatMemberRowSchema.Type;

const ChatChannelRowSchema = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  kind: Schema.Literals(Object.values(CHANNEL_KIND)),
  name: Schema.NullOr(Schema.String),
  planId: Schema.NullOr(Schema.String),
  dmAMemberId: Schema.NullOr(Schema.String),
  dmBMemberId: Schema.NullOr(Schema.String),
  createdByMemberId: Schema.NullOr(Schema.String),
  createdAt: InstantColumnSchema,
  archivedAt: Schema.NullOr(InstantColumnSchema),
});

/** One channel as the store keeps it. */
export type ChatChannelRow = typeof ChatChannelRowSchema.Type;

const MEMBER_COLUMNS = {
  id: chatMember.id,
  organizationId: chatMember.organizationId,
  kind: chatMember.kind,
  userId: chatMember.userId,
  agentId: chatMember.agentId,
  planId: chatMember.planId,
  handle: chatMember.handle,
  ordinal: chatMember.ordinal,
  readSeq: chatMember.readSeq,
  noticeSeq: chatMember.noticeSeq,
  joinedAt: chatMember.joinedAt,
  leftAt: chatMember.leftAt,
};

const CHANNEL_COLUMNS = {
  id: chatChannel.id,
  organizationId: chatChannel.organizationId,
  kind: chatChannel.kind,
  name: chatChannel.name,
  planId: chatChannel.planId,
  dmAMemberId: chatChannel.dmAMemberId,
  dmBMemberId: chatChannel.dmBMemberId,
  createdByMemberId: chatChannel.createdByMemberId,
  createdAt: chatChannel.createdAt,
  archivedAt: chatChannel.archivedAt,
};

const OrganizationKeySchema = Schema.Struct({ organizationId: Schema.String });

/** The workspace's row, held for the transaction, which is what serializes its mints and its channel names. */
const lockWorkspace = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .for("update"),
    ),
});

const SubjectKeySchema = Schema.Struct({
  organizationId: Schema.String,
  kind: Schema.Literals(Object.values(MEMBER_KIND)),
  subjectId: Schema.String,
});

/** The column a subject of each kind is named by. */
const SUBJECT_COLUMN = {
  [MEMBER_KIND.HUMAN]: chatMember.userId,
  [MEMBER_KIND.AGENT]: chatMember.agentId,
  [MEMBER_KIND.PLANNER]: chatMember.planId,
} as const;

const findMemberOfSubject = SqlSchema.findOneOption({
  Request: SubjectKeySchema,
  Result: ChatMemberRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select(MEMBER_COLUMNS)
        .from(chatMember)
        .where(
          and(
            eq(chatMember.organizationId, key.organizationId),
            eq(SUBJECT_COLUMN[key.kind], key.subjectId),
          ),
        ),
    ),
});

const findMembers = SqlSchema.findAll({
  Request: OrganizationKeySchema,
  Result: ChatMemberRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select(MEMBER_COLUMNS)
        .from(chatMember)
        .where(eq(chatMember.organizationId, key.organizationId))
        .orderBy(asc(chatMember.joinedAt), asc(chatMember.kind), asc(chatMember.ordinal)),
    ),
});

const findLastOrdinal = SqlSchema.findOne({
  Request: Schema.Struct({
    organizationId: Schema.String,
    kind: Schema.Literals(Object.values(MEMBER_KIND)),
  }),
  Result: Schema.Struct({ last: Schema.NullOr(Schema.Number) }),
  execute: (key) =>
    Database.use((db) =>
      db
        .select({ last: max(chatMember.ordinal) })
        .from(chatMember)
        .where(
          and(eq(chatMember.organizationId, key.organizationId), eq(chatMember.kind, key.kind)),
        ),
    ),
});

/** Every handle a person or agent of the workspace holds, which a person's mint must step past. */
const findHandles = SqlSchema.findAll({
  Request: OrganizationKeySchema,
  Result: Schema.Struct({ handle: Schema.String }),
  execute: (key) =>
    Database.use((db) =>
      db
        .select({ handle: chatMember.handle })
        .from(chatMember)
        .where(
          and(
            eq(chatMember.organizationId, key.organizationId),
            ne(chatMember.kind, MEMBER_KIND.PLANNER),
          ),
        ),
    ),
});

const findAccountName = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ name: Schema.String }),
  execute: (userId) =>
    Database.use((db) => db.select({ name: user.name }).from(user).where(eq(user.id, userId))),
});

/** The workspace an agent was started in, which it keeps whether or not it works a plan. */
const findAgentWorkspace = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ organizationId: Schema.NullOr(Schema.String) }),
  execute: (agentId) =>
    Database.use((db) =>
      db
        .select({ organizationId: codingAgent.organizationId })
        .from(codingAgent)
        .where(eq(codingAgent.id, agentId)),
    ),
});

/** A plan the account reaches, with its workspace and its name. */
const findReachablePlan = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, planId: Schema.String }),
  Result: Schema.Struct({
    organizationId: Schema.String,
    name: Schema.String,
    archivedAt: Schema.NullOr(InstantColumnSchema),
  }),
  execute: ({ userId, planId }) =>
    Database.use((db) =>
      db
        .select({
          organizationId: task.organizationId,
          name: task.name,
          archivedAt: task.archivedAt,
        })
        .from(task)
        .where(and(eq(task.id, planId), taskReachableBy(userId))),
    ),
});

const findPlanWorkspace = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: OrganizationKeySchema,
  execute: (planId) =>
    Database.use((db) =>
      db.select({ organizationId: task.organizationId }).from(task).where(eq(task.id, planId)),
    ),
});

const insertMember = SqlSchema.findOne({
  Request: Schema.Struct({
    organizationId: Schema.String,
    kind: Schema.Literals(Object.values(MEMBER_KIND)),
    userId: Schema.NullOr(Schema.String),
    agentId: Schema.NullOr(Schema.String),
    planId: Schema.NullOr(Schema.String),
    handle: Schema.String,
    ordinal: Schema.Number,
    now: Schema.Date,
  }),
  Result: ChatMemberRowSchema,
  execute: (row) =>
    Database.use((db) =>
      db
        .insert(chatMember)
        .values({
          organizationId: row.organizationId,
          kind: row.kind,
          userId: row.userId,
          agentId: row.agentId,
          planId: row.planId,
          handle: row.handle,
          ordinal: row.ordinal,
          joinedAt: row.now,
        })
        .returning(MEMBER_COLUMNS),
    ),
});

const findMemberInWorkspace = SqlSchema.findOneOption({
  Request: Schema.Struct({ organizationId: Schema.String, memberId: Schema.String }),
  Result: ChatMemberRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select(MEMBER_COLUMNS)
        .from(chatMember)
        .where(
          and(eq(chatMember.organizationId, key.organizationId), eq(chatMember.id, key.memberId)),
        ),
    ),
});

const stampLeft = SqlSchema.findAll({
  Request: Schema.Struct({
    organizationId: Schema.String,
    memberId: Schema.String,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: (key) =>
    Database.use((db) =>
      db
        .update(chatMember)
        .set({ leftAt: key.now })
        .where(
          and(
            eq(chatMember.organizationId, key.organizationId),
            eq(chatMember.id, key.memberId),
            ne(chatMember.kind, MEMBER_KIND.HUMAN),
            isNull(chatMember.leftAt),
          ),
        )
        .returning({ id: chatMember.id }),
    ),
});

const findChannelByName = SqlSchema.findOneOption({
  Request: Schema.Struct({ organizationId: Schema.String, name: Schema.String }),
  Result: ChatChannelRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select(CHANNEL_COLUMNS)
        .from(chatChannel)
        .where(
          and(eq(chatChannel.organizationId, key.organizationId), eq(chatChannel.name, key.name)),
        ),
    ),
});

const findPlanChannel = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: ChatChannelRowSchema,
  execute: (planId) =>
    Database.use((db) =>
      db
        .select(CHANNEL_COLUMNS)
        .from(chatChannel)
        .where(and(eq(chatChannel.planId, planId), eq(chatChannel.kind, CHANNEL_KIND.PLAN))),
    ),
});

const findDm = SqlSchema.findOneOption({
  Request: Schema.Struct({
    organizationId: Schema.String,
    dmAMemberId: Schema.String,
    dmBMemberId: Schema.String,
  }),
  Result: ChatChannelRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select(CHANNEL_COLUMNS)
        .from(chatChannel)
        .where(
          and(
            eq(chatChannel.organizationId, key.organizationId),
            eq(chatChannel.kind, CHANNEL_KIND.DM),
            eq(chatChannel.dmAMemberId, key.dmAMemberId),
            eq(chatChannel.dmBMemberId, key.dmBMemberId),
          ),
        ),
    ),
});

const findChannels = SqlSchema.findAll({
  Request: OrganizationKeySchema,
  Result: ChatChannelRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select(CHANNEL_COLUMNS)
        .from(chatChannel)
        .where(eq(chatChannel.organizationId, key.organizationId))
        .orderBy(asc(chatChannel.createdAt), asc(chatChannel.id)),
    ),
});

const countOpenTopics = SqlSchema.findOne({
  Request: OrganizationKeySchema,
  Result: Schema.Struct({ open: Schema.Number }),
  execute: (key) =>
    Database.use((db) =>
      db
        .select({ open: sql<number>`count(*)::int` })
        .from(chatChannel)
        .where(
          and(
            eq(chatChannel.organizationId, key.organizationId),
            eq(chatChannel.kind, CHANNEL_KIND.TOPIC),
            isNull(chatChannel.archivedAt),
          ),
        ),
    ),
});

const insertChannel = SqlSchema.findAll({
  Request: Schema.Struct({
    organizationId: Schema.String,
    kind: Schema.Literals(Object.values(CHANNEL_KIND)),
    name: Schema.NullOr(Schema.String),
    planId: Schema.NullOr(Schema.String),
    dmAMemberId: Schema.NullOr(Schema.String),
    dmBMemberId: Schema.NullOr(Schema.String),
    createdByMemberId: Schema.NullOr(Schema.String),
    archivedAt: Schema.optionalKey(Schema.NullOr(Schema.Date)),
    now: Schema.Date,
  }),
  Result: ChatChannelRowSchema,
  execute: (row) =>
    Database.use((db) =>
      db
        .insert(chatChannel)
        .values({
          archivedAt: row.archivedAt ?? null,
          organizationId: row.organizationId,
          kind: row.kind,
          name: row.name,
          planId: row.planId,
          dmAMemberId: row.dmAMemberId,
          dmBMemberId: row.dmBMemberId,
          createdByMemberId: row.createdByMemberId,
          createdAt: row.now,
        })
        .onConflictDoNothing()
        .returning(CHANNEL_COLUMNS),
    ),
});

/** A name spelled as a slug: lowercase letters and digits, a hyphen between runs of them, bounded. */
function slugOf(name: string, maximumChars: number): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, maximumChars)
    .replace(/-+$/u, "");
}

/** The first of a stem and its `-2`, `-3`, … the predicate does not refuse. */
function firstFree(stem: string, taken: (candidate: string) => boolean): string {
  if (!taken(stem)) return stem;
  let suffix = 2;
  while (taken(`${stem}-${suffix}`)) suffix += 1;
  return `${stem}-${suffix}`;
}

/** A person's handle stem: a slug of their name opening on a letter. */
function personStem(name: string): string {
  const stem = slugOf(name, MAX_HANDLE_STEM_CHARS).replace(/^[^a-z]+/u, "");
  return stem === "" ? FALLBACK_HANDLE : stem;
}

/** The workspace a subject belongs to, where it is the one named; nothing for one of another workspace or none. */
function subjectInWorkspace(
  organizationId: string,
  subject: ChatMemberSubject,
): ChatStoreEffect<boolean> {
  switch (subject.kind) {
    case MEMBER_KIND.HUMAN:
      return isWorkspaceMember(subject.userId, organizationId);
    case MEMBER_KIND.AGENT:
      return Effect.map(findAgentWorkspace(subject.agentId), (found) =>
        Option.exists(found, (row) => row.organizationId === organizationId),
      );
    case MEMBER_KIND.PLANNER:
      return Effect.map(findPlanWorkspace(subject.planId), (found) =>
        Option.exists(found, (row) => row.organizationId === organizationId),
      );
  }
}

/** The id a subject is named by in its kind's column. */
function subjectId(subject: ChatMemberSubject): string {
  switch (subject.kind) {
    case MEMBER_KIND.HUMAN:
      return subject.userId;
    case MEMBER_KIND.AGENT:
      return subject.agentId;
    case MEMBER_KIND.PLANNER:
      return subject.planId;
  }
}

/** The handle a new member of the kind is minted, its ordinal given; a person's steps past every handle held and spoken for. */
function mintHandle(
  organizationId: string,
  subject: ChatMemberSubject,
  ordinal: number,
): ChatStoreEffect<string> {
  return Effect.gen(function* () {
    if (subject.kind === MEMBER_KIND.AGENT) return `agent-${ordinal}`;
    if (subject.kind === MEMBER_KIND.PLANNER) return PLANNER_HANDLE;
    const account = yield* findAccountName(subject.userId);
    const held = new Set((yield* findHandles({ organizationId })).map((row) => row.handle));
    const stem = personStem(Option.match(account, { onNone: () => "", onSome: (row) => row.name }));
    return firstFree(stem, (candidate) => held.has(candidate) || SPOKEN_FOR.test(candidate));
  });
}

/**
 * Whether the account may act as the member: a person's member is that
 * person's alone, while an agent's or a planner's is acted as by the
 * service on its behalf, which names it from the agent or plan it runs.
 */
function actsAs(userId: string, member: ChatMemberRow): boolean {
  return member.kind !== MEMBER_KIND.HUMAN || member.userId === userId;
}

/** The workspace's general channel, by its name and its kind. */
function generalOf(organizationId: string): ChatStoreEffect<Option.Option<ChatChannelRow>> {
  return Effect.map(
    findChannelByName({ organizationId, name: GENERAL_CHANNEL }),
    Option.filter((row) => row.kind === CHANNEL_KIND.GENERAL),
  );
}

/** The account's gate on a workspace: whether it is in it, with the workspace's lock taken where it is. */
function lockedFor(userId: string, organizationId: string): ChatStoreEffect<boolean> {
  return Effect.gen(function* () {
    if (!(yield* isWorkspaceMember(userId, organizationId))) return false;
    return Option.isSome(yield* lockWorkspace(organizationId));
  });
}

/** Runs the effect in one transaction on the ambient client. */
function transaction<A>(body: ChatStoreEffect<A>): ChatStoreEffect<A> {
  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(body));
}

/** A channel the insert just made, or the one a racing insert made first under the same name, pair, or plan. */
function madeOrStanding(
  made: readonly ChatChannelRow[],
  standing: ChatStoreEffect<Option.Option<ChatChannelRow>>,
): ChatStoreEffect<Option.Option<ChatChannelRow>> {
  const [row] = made;
  return row === undefined ? standing : Effect.succeed(Option.some(row));
}

/**
 * The workspace's member for the subject, minted the first time it is asked
 * for under the workspace's lock: its ordinal the next of its kind, and its
 * handle as above. Nothing where the account is not in the workspace or the
 * subject is not of it: a person not in it, or an agent or a plan of
 * another workspace.
 */
export function ensureMember(
  userId: string,
  organizationId: string,
  subject: ChatMemberSubject,
): ChatStoreEffect<Option.Option<ChatMemberRow>> {
  return transaction(
    Effect.gen(function* () {
      if (!(yield* lockedFor(userId, organizationId))) return Option.none();
      const key = { organizationId, kind: subject.kind, subjectId: subjectId(subject) };
      // A person is asked of again each time, because one who left the workspace keeps a row for the messages they wrote.
      const standing = yield* findMemberOfSubject(key);
      if (Option.isSome(standing) && subject.kind !== MEMBER_KIND.HUMAN) return standing;
      if (!(yield* subjectInWorkspace(organizationId, subject))) return Option.none();
      if (Option.isSome(standing)) return standing;
      const { last } = yield* findLastOrdinal({ organizationId, kind: subject.kind }).pipe(
        Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
      );
      const ordinal = (last ?? 0) + 1;
      const handle = yield* mintHandle(organizationId, subject, ordinal);
      const now = yield* DateTime.nowAsDate;
      const row = yield* insertMember({
        organizationId,
        kind: subject.kind,
        userId: subject.kind === MEMBER_KIND.HUMAN ? subject.userId : null,
        agentId: subject.kind === MEMBER_KIND.AGENT ? subject.agentId : null,
        planId: subject.kind === MEMBER_KIND.PLANNER ? subject.planId : null,
        handle,
        ordinal,
        now,
      }).pipe(Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)));
      return Option.some(row);
    }),
  );
}

/** Every member of the workspace, the ones who left among them, in the order they joined; none where the account is not in it. */
export function roster(
  userId: string,
  organizationId: string,
): ChatStoreEffect<readonly ChatMemberRow[]> {
  return Effect.gen(function* () {
    if (!(yield* isWorkspaceMember(userId, organizationId))) return [];
    return yield* findMembers({ organizationId });
  });
}

/** Every channel of the workspace, the archived ones among them, in the order they were made; none where the account is not in it. */
export function channelsOf(
  userId: string,
  organizationId: string,
): ChatStoreEffect<readonly ChatChannelRow[]> {
  return Effect.gen(function* () {
    if (!(yield* isWorkspaceMember(userId, organizationId))) return [];
    return yield* findChannels({ organizationId });
  });
}

/** The workspace's general channel, made the first time it is asked for; nothing where the account is not in it. */
export function ensureGeneral(
  userId: string,
  organizationId: string,
): ChatStoreEffect<Option.Option<ChatChannelRow>> {
  return Effect.gen(function* () {
    if (!(yield* isWorkspaceMember(userId, organizationId))) return Option.none();
    const standing = yield* generalOf(organizationId);
    if (Option.isSome(standing)) return standing;
    const now = yield* DateTime.nowAsDate;
    const made = yield* insertChannel({
      organizationId,
      kind: CHANNEL_KIND.GENERAL,
      name: GENERAL_CHANNEL,
      planId: null,
      dmAMemberId: null,
      dmBMemberId: null,
      createdByMemberId: null,
      now,
    });
    return yield* madeOrStanding(made, generalOf(organizationId));
  });
}

/**
 * The plan's own channel, made the first time it is asked for under the
 * workspace's lock and named from the plan, `-2` and on where a channel
 * holds the name already, and `plan` where the name spells nothing; nothing
 * where the account does not reach the plan.
 */
export function ensurePlanChannel(
  userId: string,
  planId: string,
): ChatStoreEffect<Option.Option<ChatChannelRow>> {
  return transaction(
    Effect.gen(function* () {
      const reached = yield* findReachablePlan({ userId, planId });
      if (Option.isNone(reached)) return Option.none();
      const standing = yield* findPlanChannel(planId);
      if (Option.isSome(standing)) return standing;
      const { organizationId } = reached.value;
      yield* lockWorkspace(organizationId);
      const again = yield* findPlanChannel(planId);
      if (Option.isSome(again)) return again;
      const held = new Set(
        (yield* findChannels({ organizationId })).flatMap((row) =>
          row.name === null ? [] : [row.name],
        ),
      );
      const stem = slugOf(reached.value.name, CHAT_BOUNDS.MAX_KEY_CHARS - 4) || "plan";
      const name = firstFree(
        stem,
        (candidate) => held.has(candidate) || candidate === GENERAL_CHANNEL,
      );
      const now = yield* DateTime.nowAsDate;
      const made = yield* insertChannel({
        organizationId,
        kind: CHANNEL_KIND.PLAN,
        name,
        planId,
        dmAMemberId: null,
        dmBMemberId: null,
        createdByMemberId: null,
        // An archived plan's channel is made archived with it, as its archive would have left it.
        archivedAt: reached.value.archivedAt,
        now,
      });
      return yield* madeOrStanding(made, findPlanChannel(planId));
    }),
  );
}

/**
 * A topic channel under the name, opened by the member given: the one
 * standing where an open topic channel holds the name, else made, unless
 * the workspace keeps as many open as it may. A name a channel of another
 * kind or an archived one holds is refused, as is a workspace the account
 * is not in or a member not of it. The name is held to the channel-name
 * grammar by the caller's wire.
 */
export function openTopicChannel(
  userId: string,
  organizationId: string,
  name: string,
  openedBy: string,
): ChatStoreEffect<Result.Result<ChatChannelRow, ChatRefusal>> {
  return transaction(
    Effect.gen(function* () {
      if (!(yield* lockedFor(userId, organizationId))) return Result.fail(CHAT_REFUSAL.NOT_FOUND);
      const opener = yield* findMemberInWorkspace({ organizationId, memberId: openedBy });
      if (Option.isNone(opener) || !actsAs(userId, opener.value)) {
        return Result.fail(CHAT_REFUSAL.NOT_FOUND);
      }
      // Note that the general channel's name is never a topic's, made yet or not, because ensureGeneral finds it by name.
      if (name === GENERAL_CHANNEL) return Result.fail(CHAT_REFUSAL.NAME_TAKEN);
      const standing = yield* findChannelByName({ organizationId, name });
      if (Option.isSome(standing)) {
        const open =
          standing.value.kind === CHANNEL_KIND.TOPIC && standing.value.archivedAt === null;
        return open ? Result.succeed(standing.value) : Result.fail(CHAT_REFUSAL.NAME_TAKEN);
      }
      const { open } = yield* countOpenTopics({ organizationId }).pipe(
        // An aggregate that returned no row is the database breaking its own contract, not an outcome.
        Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
      );
      if (open >= CHAT_BOUNDS.MAX_TOPIC_CHANNELS) return Result.fail(CHAT_REFUSAL.TOO_MANY_TOPICS);
      const now = yield* DateTime.nowAsDate;
      const [made] = yield* insertChannel({
        organizationId,
        kind: CHANNEL_KIND.TOPIC,
        name,
        planId: null,
        dmAMemberId: null,
        dmBMemberId: null,
        createdByMemberId: openedBy,
        now,
      });
      return made === undefined ? Result.fail(CHAT_REFUSAL.NAME_TAKEN) : Result.succeed(made);
    }),
  );
}

/**
 * The DM between two members of the workspace, made the first time it is
 * asked for, by the first member; one pair is one channel whichever of the
 * two asks. Nothing where the account is not in the workspace, either
 * member is not of it, or the two are one.
 */
export function findOrMakeDm(
  userId: string,
  organizationId: string,
  fromMemberId: string,
  toMemberId: string,
): ChatStoreEffect<Option.Option<ChatChannelRow>> {
  return Effect.gen(function* () {
    if (fromMemberId === toMemberId) return Option.none();
    if (!(yield* isWorkspaceMember(userId, organizationId))) return Option.none();
    const from = yield* findMemberInWorkspace({ organizationId, memberId: fromMemberId });
    if (Option.isNone(from) || !actsAs(userId, from.value)) return Option.none();
    const to = yield* findMemberInWorkspace({ organizationId, memberId: toMemberId });
    // A member that left hears nothing more, so no DM is opened with it on either side.
    if (Option.isNone(to) || from.value.leftAt !== null || to.value.leftAt !== null) {
      return Option.none();
    }
    // Note that the pair is stored in uuid order, because that is what makes one pair one row.
    const [dmAMemberId, dmBMemberId] = [fromMemberId, toMemberId].toSorted();
    if (dmAMemberId === undefined || dmBMemberId === undefined) return Option.none();
    const pair = { organizationId, dmAMemberId, dmBMemberId };
    const standing = yield* findDm(pair);
    if (Option.isSome(standing)) return standing;
    const now = yield* DateTime.nowAsDate;
    const made = yield* insertChannel({
      ...pair,
      kind: CHANNEL_KIND.DM,
      name: null,
      planId: null,
      createdByMemberId: fromMemberId,
      now,
    });
    return yield* madeOrStanding(made, findDm(pair));
  });
}

const stampPlanChannelArchive = SqlSchema.void({
  Request: Schema.Struct({ planId: Schema.String, archivedAt: Schema.NullOr(Schema.Date) }),
  execute: ({ planId, archivedAt }) =>
    Database.use((db) =>
      db
        .update(chatChannel)
        .set({ archivedAt })
        .where(and(eq(chatChannel.planId, planId), eq(chatChannel.kind, CHANNEL_KIND.PLAN))),
    ),
});

/**
 * Archives a plan's channel as its plan is archived, or opens it again as
 * its plan is brought back: what the plan's own archive calls, under the
 * plan's lock, so an archived plan's channel takes no post until the plan
 * returns. Nothing where the plan has no channel.
 */
export function followPlanArchive(planId: string, archivedAt: Date | null): ChatStoreEffect<void> {
  return stampPlanChannelArchive({ planId, archivedAt });
}

/**
 * Stamps the member as having left, an archived agent or plan, once: it
 * stays on the roster and in every message it wrote, and hears nothing
 * more. A person is never stamped: their membership is the workspace's
 * own. Answers whether this call stamped it, which a second does not.
 */
export function leave(
  userId: string,
  organizationId: string,
  memberId: string,
): ChatStoreEffect<boolean> {
  return Effect.gen(function* () {
    if (!(yield* isWorkspaceMember(userId, organizationId))) return false;
    const now = yield* DateTime.nowAsDate;
    const stamped = yield* stampLeft({ organizationId, memberId, now });
    return stamped.length > 0;
  });
}
