import type { PlanSectionWriter } from "@sidecar/hosted/plan-document";
import { DEFAULT_PLAN_TEMPLATE } from "@sidecar/hosted/plan-document-template";
import { type PlanAgentEdit, planAgentEditSchema } from "@sidecar/hosted/plan-template";
import {
  PLAN_ACTOR,
  type Plan,
  type PlanLastEdit,
  type PlanSectionEdit,
  type PlanSummary,
  type Rollout,
  rolloutSchema,
} from "@sidecar/hosted/plan-wire";
import { and, desc, eq, exists, inArray, isNotNull, isNull } from "drizzle-orm";
import { Data, DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { plan } from "../schemas/plan.js";
import { conversations } from "../schemas/storage.js";
import { voiceSessions } from "../schemas/voice.js";
import { CONVERSATION_KIND } from "../storage-vocabulary.js";
import { readPlanTemplate } from "./account-store.js";
import { InstantColumnSchema } from "./columns.js";
import { readLastEdit, readSectionWriters, UNKNOWN_AGENT_LABEL } from "./plan-revisions.js";
import { readTemplateAt } from "./plan-template-revisions.js";
import { planReachableBy, reachablePlan } from "./workspace-store.js";

/**
 * plan-store.ts -- the named plans of an account's workspaces, and the one document each holds.
 *
 * A plan is read and written by every member of the workspace it names,
 * whichever of them started it. Every statement here names the account it
 * runs for beside the plan and gates on that account's membership
 * (`workspace-store.ts`), so a plan of a workspace the account is not in
 * reads, saves, changes, and deletes exactly as an id that names nothing: as
 * no plan. A pin and an archive are stamps on the row, so they are the
 * workspace's and read alike for every member on every Mac. A plan's repository is kept here as
 * handed and confirmed nowhere here: whether the account reaches it through
 * the Luke GitHub App is the route's to settle before it calls, on the
 * service that reads GitHub (`github/github-app.ts`), and so is whether the
 * account is a member of the workspace a plan starts in. A save is one `update` over the row that
 * stands and never an insert, so a plan deleted before a save lands stays
 * deleted, and a save that fails leaves the document as it was. A plan's
 * conversation is a `plan` conversation of the member who opened it, opened
 * once and named on the row, and it goes with the plan: deleting the plan stamps it
 * `deleted_at`, and the conversations of the plan's coding agents with it,
 * so the purge takes their words thirty days on. Every function is an effect over the ambient `SqlClient` and names
 * no database of its own.
 */

export type PlanStoreFailure = QueryError | Schema.SchemaError;

/** What a plan store operation answers: an effect over the ambient client, composed into whatever called it. */
export type PlanStoreEffect<A> = Effect.Effect<A, PlanStoreFailure, DatabaseServices>;

/** The plan is archived, so it takes the write asked of it only once it is brought back; nothing was written. */
export class PlanArchived extends Data.TaggedError("PlanArchived") {}

/** A coding agent stands on the plan that its delete was not told was stopped: one started while the delete stopped the others. */
export class PlanAgentUnstopped extends Data.TaggedError("PlanAgentUnstopped") {}

/** What a delete that stopped the plan's agents first tells it. */
export interface PlanDeleteGuard<R> {
  /** The agents the caller stopped; any other standing refuses the delete. */
  readonly stoppedAgentIds: ReadonlySet<string>;
  /** Run under the plan's lock before anything is deleted, given the plan's conversation and each agent's. */
  readonly beforeDelete: (
    conversationIds: readonly string[],
  ) => Effect.Effect<void, QueryError | Schema.SchemaError, R>;
}

/** One save a coding agent made, with the agent named as its row names it now. */
export interface LabelledAgentEdit extends PlanAgentEdit {
  readonly label: string;
}

/**
 * A plan as the service holds it: what the window reads, its text, the saves
 * coding agents made with their notes, and the conversation it resumes in, if
 * one is attached.
 */
export interface StoredPlan {
  readonly plan: Plan;
  /** The plan's whole text. */
  readonly text: string;
  readonly agentEdits: readonly LabelledAgentEdit[];
  readonly conversationId: string | undefined;
  /** Whether the text was ever saved since the plan started: false while nobody has written it. */
  readonly saved: boolean;
  /** Who last changed each section, by heading, as its revisions read (`readSectionWriters`). */
  readonly sectionWriters: readonly PlanSectionWriter[];
}

/** A plan to start: the workspace it starts in, its name, and the repository it is about where one is chosen. */
export interface NewPlan {
  readonly organizationId: string;
  readonly name: string;
  readonly repository?: string | null;
}

/** What a change to a plan names: a new name, a repository or null to clear it, pinned or not, archived or not, or any of them at once. */
export interface PlanChanges {
  readonly name?: string;
  readonly repository?: string | null;
  readonly pinned?: boolean;
  readonly archived?: boolean;
}

/**
 * The columns a line of the list reads: none of the document. Note that the
 * list projects these alone, because a migration that reshapes the document
 * lands before the build that reads the new shape is live, and a list that
 * decoded the document would then refuse every plan rather than just the one
 * opened.
 */
const PLAN_SUMMARY_COLUMNS = {
  id: plan.id,
  organizationId: plan.organizationId,
  name: plan.name,
  repository: plan.repository,
  pinnedAt: plan.pinnedAt,
  archivedAt: plan.archivedAt,
  createdAt: plan.createdAt,
  updatedAt: plan.updatedAt,
};

/** The columns every other read and every `returning` projects, so a row decodes one way whatever wrote it. */
const PLAN_COLUMNS = {
  ...PLAN_SUMMARY_COLUMNS,
  userId: plan.userId,
  agentEdits: plan.agentEdits,
  document: plan.document,
  rollout: plan.rollout,
  conversationId: plan.conversationId,
};

const PlanSummaryRowSchema = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  name: Schema.String,
  repository: Schema.NullOr(Schema.String),
  pinnedAt: Schema.NullOr(InstantColumnSchema),
  archivedAt: Schema.NullOr(InstantColumnSchema),
  createdAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
});

type PlanSummaryRow = typeof PlanSummaryRowSchema.Type;

const PlanRowSchema = Schema.Struct({
  ...PlanSummaryRowSchema.fields,
  userId: Schema.String,
  agentEdits: Schema.Array(planAgentEditSchema),
  // Every plan is one document since the backfill, so a row with none is the store breaking its own contract.
  document: Schema.String,
  rollout: rolloutSchema,
  conversationId: Schema.NullOr(Schema.String),
});

type PlanRow = typeof PlanRowSchema.Type;

const PlanKeySchema = Schema.Struct({ userId: Schema.String, planId: Schema.String });

const PlanIdRowSchema = Schema.Struct({ id: Schema.String });

/** The agents the journal names, as their rows name them now; a row that is gone names nothing. */
const findAgentLabels = SqlSchema.findAll({
  Request: Schema.Struct({ planId: Schema.String, agentIds: Schema.Array(Schema.String) }),
  Result: Schema.Struct({
    id: Schema.String,
    model: Schema.String,
    title: Schema.NullOr(Schema.String),
  }),
  execute: ({ planId, agentIds }) =>
    Database.use((db) =>
      db
        .select({ id: codingAgent.id, model: codingAgent.model, title: codingAgent.title })
        .from(codingAgent)
        .where(and(eq(codingAgent.planId, planId), inArray(codingAgent.id, agentIds))),
    ),
});

/**
 * The agents the journal and the sections' writers name, by id, as their rows
 * name them now, so a renamed agent reads renamed everywhere: the label is
 * the row's title, or its model while it has none. The row's own account is
 * the one they are read under.
 */
function agentLabelsOf(
  row: PlanRow,
  sectionWriters: readonly PlanSectionWriter[],
): PlanStoreEffect<ReadonlyMap<string, string>> {
  const named = [
    ...row.agentEdits.map((edit) => edit.agentId),
    ...sectionWriters.flatMap((writer) => (writer.agentId === undefined ? [] : [writer.agentId])),
  ];
  const agentIds = [...new Set(named)];
  if (agentIds.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findAgentLabels({ planId: row.id, agentIds }),
    (agents) => new Map(agents.map((agent) => [agent.id, agent.title ?? agent.model])),
  );
}

/**
 * Who last changed one section, as its line reads it: a coding agent named by
 * its label, or as an agent whose row is gone, or whose writer was kept
 * before agents were.
 */
function sectionEditOf(
  writer: PlanSectionWriter,
  labels: ReadonlyMap<string, string>,
): PlanSectionEdit {
  const { section, actor, at } = writer;
  const label = writer.agentId === undefined ? undefined : labels.get(writer.agentId);
  return {
    section,
    actor,
    ...(actor === PLAN_ACTOR.AGENT ? { label: label ?? UNKNOWN_AGENT_LABEL } : undefined),
    at,
    duringCall: writer.duringCall === true,
  };
}

/**
 * A coding agent's save from the journal as a plan's last edit, for a plan
 * whose history has not begun: an agent's save made before it is the newest
 * thing the service can name a writer for.
 */
function journaledEdit(edit: LabelledAgentEdit): PlanLastEdit {
  return { actor: PLAN_ACTOR.AGENT, label: edit.label, at: edit.at, duringCall: false };
}

/** The text the row's plan started as (`readStartedText`). */
function startedText(row: PlanRow): PlanStoreEffect<string> {
  return readStartedText(row.userId, row.createdAt.getTime());
}

/**
 * The row's plan, as the window and the model read it: its text as the
 * document's body with no assumptions, since they are a section of the text,
 * and who last changed each section, as its revisions read. The row's own account is the one its
 * agents are read under. Its last edit is its newest revision, or, before its
 * history begins, the newest save a coding agent made. A plan is saved once
 * a save has moved its last save past its start, which no creation and no
 * carrying over does.
 */
function storedPlanOf(row: PlanRow): PlanStoreEffect<StoredPlan> {
  return Effect.gen(function* () {
    const summary = summaryOf(row);
    const sectionWriters = yield* readSectionWriters(row.id, startedText(row));
    const labels = yield* agentLabelsOf(row, sectionWriters);
    const agentEdits = row.agentEdits.map((edit) => ({
      ...edit,
      label: labels.get(edit.agentId) ?? UNKNOWN_AGENT_LABEL,
    }));
    const lastEdit = Option.orElse(yield* readLastEdit(row.id), () =>
      Option.map(Option.fromUndefinedOr(agentEdits.at(-1)), journaledEdit),
    );
    return {
      plan: {
        ...summary,
        agentEdits: agentEdits.map(({ agentId, label, at }) => ({ agentId, label, at })),
        ...(Option.isSome(lastEdit) ? { lastEdit: lastEdit.value } : undefined),
        document: { body: row.document, assumptions: [] },
        sectionEdits: sectionWriters.map((writer) => sectionEditOf(writer, labels)),
        rollout: row.rollout,
      },
      text: row.document,
      agentEdits,
      conversationId: row.conversationId ?? undefined,
      saved: row.updatedAt.getTime() > row.createdAt.getTime(),
      sectionWriters,
    };
  });
}

/** The row's plan alone, for the writes that answer one. */
function planOf(row: PlanRow): PlanStoreEffect<Plan> {
  return Effect.map(storedPlanOf(row), (stored) => stored.plan);
}

/**
 * The row as one line of the list. Note that `openedAt` is still answered,
 * as the start, because a desktop through v0.7.1 refuses a summary without it.
 * It goes once a release whose decoder treats it as optional has shipped and
 * v0.7.1 is no longer supported. A pin and an archive are answered only where
 * they stand, so a plan that is neither reads as every plan did before them.
 */
function summaryOf(row: PlanSummaryRow): PlanSummary {
  const createdAt = row.createdAt.getTime();
  return {
    id: row.id,
    workspaceId: row.organizationId,
    name: row.name,
    createdAt,
    updatedAt: row.updatedAt.getTime(),
    repository: row.repository,
    openedAt: createdAt,
    ...(row.pinnedAt === null ? undefined : { pinnedAt: row.pinnedAt.getTime() }),
    ...(row.archivedAt === null ? undefined : { archivedAt: row.archivedAt.getTime() }),
  };
}

const insertPlan = SqlSchema.findOne({
  Request: Schema.Struct({
    userId: Schema.String,
    organizationId: Schema.String,
    name: Schema.String,
    repository: Schema.NullOr(Schema.String),
    document: Schema.String,
    now: Schema.Date,
  }),
  Result: PlanRowSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .insert(plan)
        .values({
          userId: write.userId,
          organizationId: write.organizationId,
          name: write.name,
          repository: write.repository,
          document: write.document,
          createdAt: write.now,
          updatedAt: write.now,
        })
        .returning(PLAN_COLUMNS),
    ),
});

const findPlans = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, includeArchived: Schema.Boolean }),
  Result: PlanSummaryRowSchema,
  execute: ({ userId, includeArchived }) =>
    Database.use((db) =>
      db
        .select(PLAN_SUMMARY_COLUMNS)
        .from(plan)
        .where(and(planReachableBy(userId), includeArchived ? undefined : isNull(plan.archivedAt)))
        .orderBy(desc(plan.createdAt), desc(plan.id)),
    ),
});

const findPlan = SqlSchema.findOneOption({
  Request: PlanKeySchema,
  Result: PlanRowSchema,
  execute: ({ userId, planId }) =>
    Database.use((db) =>
      db.select(PLAN_COLUMNS).from(plan).where(reachablePlan(userId, planId)).limit(1),
    ),
});

const replaceText = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    planId: Schema.String,
    text: Schema.String,
    agentEdits: Schema.optionalKey(Schema.Array(planAgentEditSchema)),
    rollout: Schema.optionalKey(rolloutSchema),
    now: Schema.Date,
  }),
  Result: PlanRowSchema,
  execute: ({ userId, planId, text, agentEdits, rollout, now }) =>
    Database.use((db) =>
      db
        .update(plan)
        .set({
          document: text,
          ...(agentEdits ? { agentEdits } : undefined),
          ...(rollout ? { rollout } : undefined),
          updatedAt: now,
        })
        .where(reachablePlan(userId, planId))
        .returning(PLAN_COLUMNS),
    ),
});

/** The plan row under its own lock, so a change and a save of the same plan run one after the other. */
const lockPlan = SqlSchema.findOneOption({
  Request: PlanKeySchema,
  Result: PlanRowSchema,
  execute: ({ userId, planId }) =>
    Database.use((db) =>
      db.select(PLAN_COLUMNS).from(plan).where(reachablePlan(userId, planId)).for("update"),
    ),
});

/** The row changed: whichever of the name, the repository, the pin, and the archive the change names, in one statement. */
const applyChanges = SqlSchema.findOne({
  Request: Schema.Struct({
    userId: Schema.String,
    planId: Schema.String,
    name: Schema.optionalKey(Schema.String),
    repository: Schema.optionalKey(Schema.NullOr(Schema.String)),
    pinnedAt: Schema.optionalKey(Schema.NullOr(Schema.Date)),
    archivedAt: Schema.optionalKey(Schema.NullOr(Schema.Date)),
  }),
  Result: PlanRowSchema,
  execute: ({ userId, planId, ...changes }) =>
    Database.use((db) =>
      db.update(plan).set(changes).where(reachablePlan(userId, planId)).returning(PLAN_COLUMNS),
    ),
});

const findPlanOfConversation = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: PlanRowSchema,
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select(PLAN_COLUMNS)
        .from(plan)
        .where(and(planReachableBy(userId), eq(plan.conversationId, conversationId)))
        .limit(1),
    ),
});

const PlanConversationRowSchema = Schema.Struct({
  conversationId: Schema.NullOr(Schema.String),
  conversationOwnerId: Schema.NullOr(Schema.String),
  conversationDeletedAt: Schema.NullOr(InstantColumnSchema),
});

/** The plan row under its own lock, with the conversation it names, the member who opened it, and whether it still stands. */
const lockPlanConversation = SqlSchema.findOneOption({
  Request: PlanKeySchema,
  Result: PlanConversationRowSchema,
  execute: ({ userId, planId }) =>
    Database.use((db) =>
      db
        .select({
          conversationId: plan.conversationId,
          conversationOwnerId: conversations.userId,
          conversationDeletedAt: conversations.deletedAt,
        })
        .from(plan)
        .leftJoin(conversations, eq(conversations.id, plan.conversationId))
        .where(reachablePlan(userId, planId))
        .for("update", { of: plan }),
    ),
});

const insertPlanConversation = SqlSchema.findOne({
  Request: Schema.Struct({ userId: Schema.String, now: Schema.Date }),
  Result: PlanIdRowSchema,
  execute: ({ userId, now }) =>
    Database.use((db) =>
      db
        .insert(conversations)
        .values({ userId, kind: CONVERSATION_KIND.PLAN, createdAt: now, lastActivityAt: now })
        .returning({ id: conversations.id }),
    ),
});

const removePlan = SqlSchema.findOneOption({
  Request: PlanKeySchema,
  Result: Schema.Struct({ conversationId: Schema.NullOr(Schema.String) }),
  execute: ({ userId, planId }) =>
    Database.use((db) =>
      db
        .delete(plan)
        .where(reachablePlan(userId, planId))
        .returning({ conversationId: plan.conversationId }),
    ),
});

const stampConversations = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationIds: Schema.Array(Schema.String),
    now: Schema.Date,
  }),
  Result: PlanIdRowSchema,
  execute: ({ conversationIds, now }) =>
    Database.use((db) =>
      db
        .update(conversations)
        .set({ deletedAt: now })
        .where(and(inArray(conversations.id, conversationIds), isNull(conversations.deletedAt)))
        .returning({ id: conversations.id }),
    ),
});

/**
 * The plan's calls that have ended, and with them the words said on each,
 * which cascade with the session. A call still open is left to the sweep
 * (`purgeDeletedPlanCalls`), since the voice service still writes it and
 * the orphan sweep may still have to end it on Luke's key.
 */
const removeEndedCalls = SqlSchema.void({
  Request: PlanKeySchema,
  execute: ({ userId, planId }) =>
    Database.use((db) =>
      db
        .delete(voiceSessions)
        .where(
          and(
            eq(voiceSessions.userId, userId),
            eq(voiceSessions.planId, planId),
            isNotNull(voiceSessions.closedAt),
          ),
        ),
    ),
});

/** The conversations of the plan's coding agents, read before the delete cascades the rows that name them. */
const findAgentConversations = SqlSchema.findAll({
  Request: PlanKeySchema,
  Result: Schema.Struct({ id: Schema.String, conversationId: Schema.String }),
  execute: ({ userId, planId }) =>
    Database.use((db) =>
      db
        .select({ id: codingAgent.id, conversationId: codingAgent.conversationId })
        .from(codingAgent)
        .innerJoin(plan, eq(plan.id, codingAgent.planId))
        .where(reachablePlan(userId, planId)),
    ),
});

/**
 * Only a standing conversation of the same account may be attached, so the
 * association can name nothing the plan's owner could not read themselves.
 */
const setConversation = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    planId: Schema.String,
    conversationId: Schema.String,
  }),
  Result: PlanIdRowSchema,
  execute: ({ userId, planId, conversationId }) =>
    Database.use((db) =>
      db
        .update(plan)
        .set({ conversationId })
        .where(
          and(
            reachablePlan(userId, planId),
            exists(
              db
                .select({ id: conversations.id })
                .from(conversations)
                .where(
                  and(
                    eq(conversations.id, conversationId),
                    eq(conversations.userId, userId),
                    isNull(conversations.deletedAt),
                  ),
                ),
            ),
          ),
        )
        .returning({ id: plan.id }),
    ),
});

/**
 * The text an account's plan started as at `createdAt`, epoch milliseconds:
 * a copy of the account's template as it stood then, as its history reads,
 * or the template it holds now where it has no history. A note reads it to
 * tell a section still holding only its template's guidance.
 */
export function readStartedText(userId: string, createdAt: number): PlanStoreEffect<string> {
  return Effect.gen(function* () {
    const held = yield* readTemplateAt(userId, new Date(createdAt));
    const template = Option.isSome(held) ? held.value : yield* readPlanTemplate(userId);
    return template ?? DEFAULT_PLAN_TEMPLATE;
  });
}

/**
 * Starts a plan under the account, in the workspace it was handed, as one
 * document, a copy of the account's own template or the default where it
 * keeps none, with the repository it was handed; it stands first in the
 * list. Note that the template is copied, not referred to, because an edit
 * of the template must leave every plan started from it as it stands.
 */
export function createPlan(userId: string, started: NewPlan): PlanStoreEffect<Plan> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const template = yield* readPlanTemplate(userId);
    const row = yield* insertPlan({
      userId,
      organizationId: started.organizationId,
      name: started.name,
      repository: started.repository ?? null,
      document: template ?? DEFAULT_PLAN_TEMPLATE,
      now,
    }).pipe(
      // An insert that returned no row is the database breaking its own contract, not an outcome.
      Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
    );
    return yield* planOf(row);
  });
}

/**
 * Every plan of every workspace the account is a member of, newest started first, without their documents,
 * and without the archived ones unless `includeArchived` asks for them.
 * Nothing but starting a plan moves the order: opening, reading, saving,
 * pinning, and archiving one leave every row where it stood, and the order a
 * pin draws is the window's to draw from `pinnedAt`.
 */
export function listPlans(
  userId: string,
  options: { readonly includeArchived?: boolean } = {},
): PlanStoreEffect<readonly PlanSummary[]> {
  return Effect.map(
    findPlans({ userId, includeArchived: options.includeArchived === true }),
    (rows) => rows.map(summaryOf),
  );
}

/**
 * The plan with its saved document and its conversation, or nothing for a
 * plan of a workspace the account is not in. This is the read the window opens a plan
 * through and the planning model starts and resumes from.
 */
export function readPlan(
  userId: string,
  planId: string,
): PlanStoreEffect<Option.Option<StoredPlan>> {
  return Effect.flatMap(findPlan({ userId, planId }), (found) =>
    Effect.transposeOption(Option.map(found, storedPlanOf)),
  );
}

/**
 * The plan as `readPlan` reads it, held under the row's lock until the
 * enclosing transaction ends, so a save formatted from it is not crossed by
 * a rename.
 */
export function readPlanForUpdate(
  userId: string,
  planId: string,
): PlanStoreEffect<Option.Option<StoredPlan>> {
  return Effect.flatMap(lockPlan({ userId, planId }), (locked) =>
    Effect.transposeOption(Option.map(locked, storedPlanOf)),
  );
}

/** What a save of a document plan's text writes beside it, where it is handed. */
export interface PlanTextSaveExtras {
  /** The coding agents' journal. */
  readonly agentEdits?: readonly PlanAgentEdit[];
  /** The rollout beside the text. */
  readonly rollout?: Rollout;
}

/**
 * Replaces the text of a plan that is one document, with the agents' journal
 * and the rollout where they are handed, and answers
 * the plan as saved, or nothing where the account reaches no such plan; nothing
 * is ever created here.
 */
export function savePlanText(
  userId: string,
  planId: string,
  text: string,
  extras: PlanTextSaveExtras = {},
): PlanStoreEffect<Option.Option<Plan>> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const row = yield* replaceText({ userId, planId, text, ...extras, now });
    return yield* Effect.transposeOption(Option.map(row, planOf));
  });
}

/**
 * The instant a pin or an archive stands from after a change: now where it
 * is asked for, the one already standing where it already was, so asking
 * twice moves nothing, and none where it is taken away.
 */
function stampOf(asked: boolean, standing: Date | null, now: Date): Date | null {
  if (!asked) return null;
  return standing ?? now;
}

/**
 * Changes the plan, a new name with its document's heading, a repository or
 * none, pinned or not, archived or not, and answers it as changed, or nothing
 * where the account reaches no such plan. The changes arrive already read under
 * the wire's rules, and a repository already confirmed reachable. A change is
 * not a save: the document's `updatedAt` and the list's order stand. A pin
 * and an archive are kept apart, so a pinned plan archived and brought back
 * is pinned again. An archived plan is neither renamed nor given another
 * repository, read under the same lock, unless the same change brings it
 * back; its pin and its archive still change.
 */
export function updatePlan(
  userId: string,
  planId: string,
  changes: PlanChanges,
): Effect.Effect<Option.Option<Plan>, PlanStoreFailure | PlanArchived, DatabaseServices> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockPlan({ userId, planId });
        if (Option.isNone(locked)) return Option.none();
        const stillArchived = locked.value.archivedAt !== null && changes.archived !== false;
        const reworded = changes.name !== undefined || changes.repository !== undefined;
        if (stillArchived && reworded) return yield* new PlanArchived();
        const now = yield* DateTime.nowAsDate;
        const row = yield* applyChanges({
          userId,
          planId,
          ...(changes.name === undefined ? undefined : { name: changes.name }),
          ...(changes.repository === undefined ? undefined : { repository: changes.repository }),
          ...(changes.pinned === undefined
            ? undefined
            : { pinnedAt: stampOf(changes.pinned, locked.value.pinnedAt, now) }),
          ...(changes.archived === undefined
            ? undefined
            : { archivedAt: stampOf(changes.archived, locked.value.archivedAt, now) }),
        }).pipe(
          // The row is held under this transaction's lock, so an update that missed it is the database breaking its own contract.
          Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
        );
        return Option.some(yield* planOf(row));
      }),
    ),
  );
}

/**
 * Deletes the plan, its document, and its ended calls with what was said on
 * them, and stamps its conversation and its coding agents' conversations
 * cleared; false where the account reached no such plan. The agents'
 * conversations are read before the delete, because the delete cascades
 * the agent rows that name them.
 *
 * A caller that stopped the plan's agents first names the ones it stopped,
 * and the delete fails with `PlanAgentUnstopped` where any other stands. The
 * plan's row is locked before the agents are read, so a Start racing the
 * delete either landed its agent before the read, which then refuses, or
 * waits on the lock and finds no plan to start on. What the caller hands
 * `beforeDelete` runs under that lock once no other agent stands and before
 * anything goes, given the plan's conversation and each agent's, so what it
 * does to them happens only to a plan that is deleted.
 */
export function deletePlan<R = never>(
  userId: string,
  planId: string,
  guard?: PlanDeleteGuard<R>,
): Effect.Effect<boolean, PlanStoreFailure | PlanAgentUnstopped, DatabaseServices | R> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockPlan({ userId, planId });
        if (Option.isNone(locked)) return false;
        const agents = yield* findAgentConversations({ userId, planId });
        if (guard !== undefined && agents.some(({ id }) => !guard.stoppedAgentIds.has(id))) {
          return yield* new PlanAgentUnstopped();
        }
        const { conversationId } = locked.value;
        const conversationIds = [
          ...(conversationId === null ? [] : [conversationId]),
          ...agents.map((agent) => agent.conversationId),
        ];
        if (guard !== undefined) yield* guard.beforeDelete(conversationIds);
        const removed = yield* removePlan({ userId, planId });
        if (Option.isNone(removed)) return false;
        yield* removeEndedCalls({ userId, planId });
        if (conversationIds.length > 0) {
          const now = yield* DateTime.nowAsDate;
          yield* stampConversations({ conversationIds, now });
        }
        return true;
      }),
    ),
  );
}

/**
 * Names the conversation the plan resumes in. False, and nothing written,
 * where the account reaches no such plan or no such standing conversation.
 */
export function attachPlanConversation(
  userId: string,
  planId: string,
  conversationId: string,
): PlanStoreEffect<boolean> {
  return Effect.map(setConversation({ userId, planId, conversationId }), Option.isSome);
}

/** A plan's conversation as the store addresses it: its id and the member who opened it, whose id its rows are written under. */
export interface PlanConversation {
  readonly conversationId: string;
  readonly ownerId: string;
}

/**
 * The conversation the plan's planning model runs in, opened and attached
 * now where the plan names none that still stands; nothing where the account
 * reaches no such plan. A conversation a teammate opened is answered as
 * theirs, so the caller speaks into the plan's one conversation rather than
 * opening a second; one opened here is the caller's own. The plan row's
 * lock holds two opens of one plan one after the other, so the second finds
 * the first's conversation rather than opening another.
 */
export function openPlanConversation(
  userId: string,
  planId: string,
): PlanStoreEffect<Option.Option<PlanConversation>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockPlanConversation({ userId, planId });
        if (Option.isNone(locked)) return Option.none();
        const { conversationId, conversationOwnerId, conversationDeletedAt } = locked.value;
        if (
          conversationId !== null &&
          conversationOwnerId !== null &&
          conversationDeletedAt === null
        ) {
          return Option.some({ conversationId, ownerId: conversationOwnerId });
        }
        const now = yield* DateTime.nowAsDate;
        const opened = yield* insertPlanConversation({ userId, now }).pipe(
          // An insert that returned no row is the database breaking its own contract, not an outcome.
          Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
        );
        if (!(yield* attachPlanConversation(userId, planId, opened.id))) {
          return yield* Effect.die(new Error("the plan's new conversation did not attach"));
        }
        return Option.some({ conversationId: opened.id, ownerId: userId });
      }),
    ),
  );
}

/**
 * The plan a conversation belongs to, with its saved document; nothing for a
 * conversation no plan the account reaches names. This is how a
 * planning turn, admitted for a conversation, finds the document it is handed
 * and the plan whose repository its reads are bound to.
 */
export function readPlanOfConversation(
  userId: string,
  conversationId: string,
): PlanStoreEffect<Option.Option<StoredPlan>> {
  return Effect.flatMap(findPlanOfConversation({ userId, conversationId }), (found) =>
    Effect.transposeOption(Option.map(found, storedPlanOf)),
  );
}
