import {
  type Plan,
  type PlanCreateRequest,
  type PlanDocument,
  type PlanSummary,
  planAssumptionSchema,
} from "@sidecar/hosted";
import { and, desc, eq, exists, isNull } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { plan } from "../db/plan-schema.js";
import { db } from "../db/query.js";
import { conversations } from "../db/storage-schema.js";
import { CONVERSATION_KIND } from "../db/storage-vocabulary.js";
import { InstantColumnSchema } from "./store/database.js";

/**
 * plan-store.ts -- the named plans an account owns, and the one document each holds.
 *
 * Every statement here names the account it runs for beside the plan, so a
 * plan id another account owns reads, saves, opens, and deletes exactly as an
 * id that names nothing: as no plan. A save is one `update` over the row that
 * stands and never an insert, so a plan deleted before a save lands stays
 * deleted, and a save that fails leaves the document as it was. A plan's
 * conversation is a `plan` conversation of the same account, opened once and
 * named on the row, and it goes with the plan: deleting the plan stamps it
 * `deleted_at` on the terms of a Clear, so the purge takes its words thirty
 * days on. Every function is an effect over the ambient `SqlClient` and names
 * no database of its own.
 */

type PlanStoreFailure = SqlError | Schema.SchemaError;

/** What a plan store operation answers: an effect over the ambient client, composed into whatever called it. */
export type PlanStoreEffect<A> = Effect.Effect<A, PlanStoreFailure, SqlClient.SqlClient>;

/** A plan as the service holds it: what the window reads, and the conversation it resumes in, if one is attached. */
export interface StoredPlan {
  readonly plan: Plan;
  readonly conversationId: string | undefined;
}

/** The columns every read and every `returning` projects, so a row decodes one way whatever wrote it. */
const PLAN_COLUMNS = {
  id: plan.id,
  name: plan.name,
  repositoryOwner: plan.repositoryOwner,
  repositoryName: plan.repositoryName,
  repositoryBranch: plan.repositoryBranch,
  repositoryCommit: plan.repositoryCommit,
  body: plan.body,
  assumptions: plan.assumptions,
  conversationId: plan.conversationId,
  createdAt: plan.createdAt,
  updatedAt: plan.updatedAt,
  openedAt: plan.openedAt,
};

const PlanRowSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  repositoryOwner: Schema.String,
  repositoryName: Schema.String,
  repositoryBranch: Schema.String,
  repositoryCommit: Schema.String,
  body: Schema.String,
  assumptions: Schema.Array(planAssumptionSchema),
  conversationId: Schema.NullOr(Schema.String),
  createdAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
  openedAt: InstantColumnSchema,
});

type PlanRow = typeof PlanRowSchema.Type;

const PlanKeySchema = Schema.Struct({ userId: Schema.String, planId: Schema.String });

const PlanIdRowSchema = Schema.Struct({ id: Schema.String });

/** The row's document, as the window and the model read it. */
function storedPlanOf(row: PlanRow): StoredPlan {
  return {
    plan: {
      ...summaryOf(row),
      document: { body: row.body, assumptions: row.assumptions },
    },
    conversationId: row.conversationId ?? undefined,
  };
}

function summaryOf(row: PlanRow): PlanSummary {
  return {
    id: row.id,
    name: row.name,
    repository: {
      owner: row.repositoryOwner,
      name: row.repositoryName,
      branch: row.repositoryBranch,
      commit: row.repositoryCommit,
    },
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    openedAt: row.openedAt.getTime(),
  };
}

/** The account's plan, when it owns one under this id. */
function ownedPlan(userId: string, planId: string) {
  return and(eq(plan.id, planId), eq(plan.userId, userId));
}

const insertPlan = SqlSchema.findOne({
  Request: Schema.Struct({
    userId: Schema.String,
    name: Schema.String,
    owner: Schema.String,
    repositoryName: Schema.String,
    branch: Schema.String,
    commit: Schema.String,
    now: Schema.Date,
  }),
  Result: PlanRowSchema,
  execute: (write) =>
    db
      .insert(plan)
      .values({
        userId: write.userId,
        name: write.name,
        repositoryOwner: write.owner,
        repositoryName: write.repositoryName,
        repositoryBranch: write.branch,
        repositoryCommit: write.commit,
        body: "",
        assumptions: [],
        createdAt: write.now,
        updatedAt: write.now,
        openedAt: write.now,
      })
      .returning(PLAN_COLUMNS),
});

const findPlans = SqlSchema.findAll({
  Request: Schema.String,
  Result: PlanRowSchema,
  execute: (userId) =>
    db
      .select(PLAN_COLUMNS)
      .from(plan)
      .where(eq(plan.userId, userId))
      .orderBy(desc(plan.openedAt), desc(plan.createdAt), desc(plan.id)),
});

const findPlan = SqlSchema.findOneOption({
  Request: PlanKeySchema,
  Result: PlanRowSchema,
  execute: ({ userId, planId }) =>
    db.select(PLAN_COLUMNS).from(plan).where(ownedPlan(userId, planId)).limit(1),
});

const stampOpened = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, planId: Schema.String, now: Schema.Date }),
  Result: PlanRowSchema,
  execute: ({ userId, planId, now }) =>
    db.update(plan).set({ openedAt: now }).where(ownedPlan(userId, planId)).returning(PLAN_COLUMNS),
});

const replaceDocument = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    planId: Schema.String,
    body: Schema.String,
    assumptions: Schema.Array(planAssumptionSchema),
    now: Schema.Date,
  }),
  Result: PlanRowSchema,
  execute: ({ userId, planId, body, assumptions, now }) =>
    db
      .update(plan)
      .set({ body, assumptions, updatedAt: now })
      .where(ownedPlan(userId, planId))
      .returning(PLAN_COLUMNS),
});

const findPlanOfConversation = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: PlanRowSchema,
  execute: ({ userId, conversationId }) =>
    db
      .select(PLAN_COLUMNS)
      .from(plan)
      .where(and(eq(plan.userId, userId), eq(plan.conversationId, conversationId)))
      .limit(1),
});

const PlanConversationRowSchema = Schema.Struct({
  conversationId: Schema.NullOr(Schema.String),
  conversationDeletedAt: Schema.NullOr(InstantColumnSchema),
});

/** The plan row under its own lock, with the conversation it names and whether that conversation still stands. */
const lockPlanConversation = SqlSchema.findOneOption({
  Request: PlanKeySchema,
  Result: PlanConversationRowSchema,
  execute: ({ userId, planId }) =>
    db
      .select({
        conversationId: plan.conversationId,
        conversationDeletedAt: conversations.deletedAt,
      })
      .from(plan)
      .leftJoin(conversations, eq(conversations.id, plan.conversationId))
      .where(ownedPlan(userId, planId))
      .for("update", { of: plan }),
});

const insertPlanConversation = SqlSchema.findOne({
  Request: Schema.Struct({ userId: Schema.String, now: Schema.Date }),
  Result: PlanIdRowSchema,
  execute: ({ userId, now }) =>
    db
      .insert(conversations)
      .values({ userId, kind: CONVERSATION_KIND.PLAN, createdAt: now, lastActivityAt: now })
      .returning({ id: conversations.id }),
});

const removePlan = SqlSchema.findOneOption({
  Request: PlanKeySchema,
  Result: Schema.Struct({ conversationId: Schema.NullOr(Schema.String) }),
  execute: ({ userId, planId }) =>
    db
      .delete(plan)
      .where(ownedPlan(userId, planId))
      .returning({ conversationId: plan.conversationId }),
});

const stampConversation = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    now: Schema.Date,
  }),
  Result: PlanIdRowSchema,
  execute: ({ userId, conversationId, now }) =>
    db
      .update(conversations)
      .set({ deletedAt: now })
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.userId, userId),
          isNull(conversations.deletedAt),
        ),
      )
      .returning({ id: conversations.id }),
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
    db
      .update(plan)
      .set({ conversationId })
      .where(
        and(
          ownedPlan(userId, planId),
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
});

/** Starts a plan under the account with an empty document; it opens first in the list. */
export function createPlan(userId: string, request: PlanCreateRequest): PlanStoreEffect<Plan> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const row = yield* insertPlan({
      userId,
      name: request.name,
      owner: request.repository.owner,
      repositoryName: request.repository.name,
      branch: request.repository.branch,
      commit: request.repository.commit,
      now,
    }).pipe(
      // An insert that returned no row is the database breaking its own contract, not an outcome.
      Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
    );
    return storedPlanOf(row).plan;
  });
}

/** Every plan the account owns, most recently opened first, without their documents. */
export function listPlans(userId: string): PlanStoreEffect<readonly PlanSummary[]> {
  return Effect.map(findPlans(userId), (rows) => rows.map(summaryOf));
}

/**
 * The plan with its saved document and its conversation, or nothing for a
 * plan the account does not own. This is the read the planning model starts
 * and resumes from: it moves nothing, so reading it for the model does not
 * reorder the window's list.
 */
export function readPlan(
  userId: string,
  planId: string,
): PlanStoreEffect<Option.Option<StoredPlan>> {
  return Effect.map(findPlan({ userId, planId }), Option.map(storedPlanOf));
}

/** The window opening a plan: its saved document, with the plan moved to the head of the list. */
export function openPlan(userId: string, planId: string): PlanStoreEffect<Option.Option<Plan>> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const row = yield* stampOpened({ userId, planId, now });
    return Option.map(row, (opened) => storedPlanOf(opened).plan);
  });
}

/**
 * Replaces the plan's document whole and answers it as saved, or nothing
 * where the account owns no such plan; nothing is ever created here.
 */
export function savePlanDocument(
  userId: string,
  planId: string,
  document: PlanDocument,
): PlanStoreEffect<Option.Option<Plan>> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const row = yield* replaceDocument({
      userId,
      planId,
      body: document.body,
      assumptions: document.assumptions,
      now,
    });
    return Option.map(row, (saved) => storedPlanOf(saved).plan);
  });
}

/** Deletes the plan and its document, and stamps its conversation cleared; false where the account owned no such plan. */
export function deletePlan(userId: string, planId: string): PlanStoreEffect<boolean> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const removed = yield* removePlan({ userId, planId });
        if (Option.isNone(removed)) return false;
        const { conversationId } = removed.value;
        if (conversationId !== null) {
          const now = yield* DateTime.nowAsDate;
          yield* stampConversation({ userId, conversationId, now });
        }
        return true;
      }),
    ),
  );
}

/**
 * Names the conversation the plan resumes in. False, and nothing written,
 * where the account owns no such plan or no such standing conversation.
 */
export function attachPlanConversation(
  userId: string,
  planId: string,
  conversationId: string,
): PlanStoreEffect<boolean> {
  return Effect.map(setConversation({ userId, planId, conversationId }), Option.isSome);
}

/**
 * The conversation the plan's planning model runs in, opened and attached
 * now where the plan names none that still stands; nothing where the account
 * owns no such plan. The plan row's lock holds two opens of one plan one
 * after the other, so the second finds the first's conversation rather than
 * opening another.
 */
export function openPlanConversation(
  userId: string,
  planId: string,
): PlanStoreEffect<Option.Option<string>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockPlanConversation({ userId, planId });
        if (Option.isNone(locked)) return Option.none();
        const { conversationId, conversationDeletedAt } = locked.value;
        if (conversationId !== null && conversationDeletedAt === null) {
          return Option.some(conversationId);
        }
        const now = yield* DateTime.nowAsDate;
        const opened = yield* insertPlanConversation({ userId, now }).pipe(
          // An insert that returned no row is the database breaking its own contract, not an outcome.
          Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
        );
        if (!(yield* attachPlanConversation(userId, planId, opened.id))) {
          return yield* Effect.die(new Error("the plan's new conversation did not attach"));
        }
        return Option.some(opened.id);
      }),
    ),
  );
}

/**
 * The plan a conversation of the account belongs to, with its saved document;
 * nothing for a conversation no plan of the account names. This is how a
 * planning turn, admitted for a conversation, finds the document it is handed
 * and the plan its `update_plan` is bound to.
 */
export function readPlanOfConversation(
  userId: string,
  conversationId: string,
): PlanStoreEffect<Option.Option<StoredPlan>> {
  return Effect.map(findPlanOfConversation({ userId, conversationId }), Option.map(storedPlanOf));
}
