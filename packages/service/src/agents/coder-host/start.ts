import type { DatabaseServices } from "@luke/database/core/query";
import {
  readAccountPreferences,
  writeAccountPreferences,
} from "@luke/database/models/account-store";
import {
  type CodingAgent,
  type CodingAgentPlace,
  createCodingAgent,
  discardCodingAgent,
} from "@luke/database/models/coding-agent-store";
import { readPlan } from "@luke/database/models/plan-store";
import { isWorkspaceMember } from "@luke/database/models/workspace-store";
import type { CodingAgentAttachment } from "@luke/features/coding-agent-wire";
import type { IntegrationProvider } from "@luke/features/integration-wire";
import type { ModelChoice } from "@luke/features/models-wire";
import { CODING_AGENT_DEFAULT_CHOICE } from "@luke/features/models-wire";
import { planMarkdown } from "@luke/features/plan-markdown";
import type { Plan } from "@luke/features/plan-wire";
import { failureKind } from "@luke/runtime/effect";
import { Effect, Option } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { GitHubApp } from "../../github/github-app.js";
import { workspaceRepository } from "../../github/workspace-repository.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrArchived,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import {
  acceptedModelChoice,
  type ModelCatalog,
  type ModelChoiceRefused,
} from "../../providers/model-catalog.js";
import { eveContent } from "../attached-files.js";
import { BRAIN_HOST_TURN } from "../brain-host/bounds.js";
import {
  describeUnreachable,
  EVE_SEND_OUTCOME,
  type EveSessions,
} from "../brain-host/eve-sessions.js";
import { mentionedContext, mentionedServers } from "../mentioned-context.js";
import { anthropicFastAccess } from "./account-keys.js";

/**
 * start.ts -- an agent started on a plan, or in a workspace with no plan: the one path a Start takes, from the Start button, from Luke's voice, or from an automation's run.
 *
 * The model, effort, and context window are the ask's own where it names a
 * model, the account's stored default otherwise, either checked against the
 * catalog, which also
 * refuses a stored default that has since left it; a refused choice is
 * answered as the catalog's own refusal, so the route can say invalid and
 * the voice tool can say which choices there are. The plan must name a
 * repository the account still reaches through the Luke GitHub App, and
 * through its workspace's installation where it has one, read now rather
 * than when the plan named it (`packages/service/src/github/workspace-repository.ts`). The
 * agent and its conversation are made under the ask's key, and a retry
 * carrying the same key is the same agent and opens nothing again; a new
 * agent's eve session opens with the plan's document as the Markdown Copy
 * would put on the clipboard, or with the ask's task in the plan's place
 * and the files attached to it, which only a task carries. An agent
 * started with no plan is handed a task in a workspace the account is a
 * member of, on a repository named by the ask and read through that
 * workspace's installation as a plan's is.
 * An eve that did not take the opening leaves no agent behind, so the retry
 * under the same key starts afresh. An ask that named a choice makes it
 * the account's default, so the menu's last choice and the default stay one
 * value. Who reaches eve is the caller's: the route holds the developer's
 * own bearer, and the voice brain's tool acts as the deployment for the
 * account, which the coder channel's table admits for exactly this opening
 * (`coder-host/channel.ts`).
 */

/** Where a Start puts the agent: on a plan, handed the plan or a task in its place, or in a workspace with no plan, on a repository, handed a task. */
export type StartPlace =
  | { readonly planId: string; readonly task: string | undefined }
  | {
      readonly planId: null;
      readonly organizationId: string;
      readonly repository: string;
      readonly task: string;
    };

/** What a Start asks: where it goes, the key a retry carries again, the choice where one was made, the files attached to a task, the MCP servers its draft switched off, and the automation whose run asks. */
export type StartAsk = StartPlace & {
  readonly idempotencyKey: string;
  readonly choice: ModelChoice | undefined;
  readonly attachments?: readonly CodingAgentAttachment[] | undefined;
  readonly disabledServers?: readonly IntegrationProvider[] | undefined;
  /** Whether a named choice becomes the account's default, as a developer's own Start makes it; an automation's run keeps the default as it stands. */
  readonly rememberChoice?: boolean;
  /** The automation whose run starts the agent; none for a Start by hand. */
  readonly automationId?: string | undefined;
};

/** What a Start came to: the agent, and whether this ask made it or found it under its key. */
export interface CodingAgentStart {
  readonly agent: CodingAgent;
  readonly created: boolean;
}

/** What a Start reaches: the store, the catalog, GitHub through the App on the developer's standing, and the network to eve. */
export type StartServices = DatabaseServices | HttpClient.HttpClient | GitHubApp | ModelCatalog;

/**
 * The choice an agent runs on: the one named where one is, the account's
 * default otherwise, either checked against the catalog as the account is
 * offered it, so a fast version withheld from it, its key's organization
 * never granted fast mode, is refused here
 * rather than at the agent's first step. A catalog that
 * could not be read is an outage; a choice it refuses is its own refusal.
 */
export const acceptedAgentChoice = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  named: ModelChoice | undefined,
): Effect.fn.Return<
  ModelChoice,
  HostedRefusal | ModelChoiceRefused,
  DatabaseServices | ModelCatalog
> {
  const choice =
    named ??
    (yield* hostedStoreOrUnavailable(readAccountPreferences(userId)))?.codingAgent ??
    CODING_AGENT_DEFAULT_CHOICE;
  const fastAccess = yield* hostedStoreOrUnavailable(anthropicFastAccess(userId));
  return yield* acceptedModelChoice(choice, fastAccess).pipe(
    Effect.catchTag("ModelCatalogUnavailable", (unavailable) =>
      Effect.logWarning(
        `the model catalog could not be read: ${failureKind(unavailable.cause)}`,
      ).pipe(Effect.andThen(Effect.fail(HOSTED_REFUSAL.UNAVAILABLE))),
    ),
  );
});

/** Where a Start lands, read as the account: the workspace whose installation reads the repository, the repository, the plan where there is one, the account that may move it where that is the account asking, and the store's place for the agent with what it is handed. */
interface StartLanding {
  readonly workspaceId: string;
  readonly repository: string;
  readonly plan: Plan | undefined;
  readonly mover: string | undefined;
  readonly place: CodingAgentPlace;
}

/** The plan read as the account, its repository required, or the workspace the account must be a member of; either refused as naming nothing. On a plan the agent is handed its document or the task; in a workspace, the task. */
const landingOf = Effect.fnUntraced(function* (
  userId: string,
  place: StartPlace,
): Effect.fn.Return<StartLanding, HostedRefusal, DatabaseServices> {
  if (place.planId === null) {
    const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, place.organizationId));
    if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return {
      workspaceId: place.organizationId,
      repository: place.repository,
      plan: undefined,
      mover: undefined,
      place: {
        planId: null,
        organizationId: place.organizationId,
        planSnapshot: null,
        task: place.task,
      },
    };
  }
  const read = yield* hostedStoreOrUnavailable(readPlan(userId, place.planId));
  if (Option.isNone(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { plan, ownerId } = read.value;
  if (plan.repository === null) return yield* Effect.fail(HOSTED_REFUSAL.NO_REPOSITORY);
  return {
    workspaceId: plan.workspaceId,
    repository: plan.repository,
    plan,
    mover: ownerId === userId ? userId : undefined,
    place:
      place.task === undefined
        ? { planId: place.planId, planSnapshot: planMarkdown(plan), task: null }
        : { planId: place.planId, planSnapshot: null, task: place.task },
  };
});

/** Starts the account's agent on the plan or in the workspace, as above; eve is composed only once a new agent needs its session opened, so a retry that found its agent asks for none. */
export const startCodingAgent = /* @__PURE__ */ Effect.fn("web/startCodingAgent")(function* (
  eve: Effect.Effect<EveSessions, HostedRefusal, HttpClient.HttpClient>,
  userId: string,
  ask: StartAsk,
): Effect.fn.Return<CodingAgentStart, HostedRefusal | ModelChoiceRefused, StartServices> {
  const choice = yield* acceptedAgentChoice(userId, ask.choice);
  const landing = yield* landingOf(userId, ask);
  yield* workspaceRepository(landing.workspaceId, landing.repository, landing.mover);
  const brief = landing.place;
  const started = yield* hostedStoreOrArchived(
    createCodingAgent(userId, {
      ...brief,
      automationId: ask.automationId,
      idempotencyKey: ask.idempotencyKey,
      model: choice.model,
      effort: choice.effort,
      contextWindow: choice.contextWindow,
      repository: landing.repository,
      disabledServers: ask.disabledServers,
      // The servers the task mentions are its first turn's, whatever the switches say.
      mentionedServers: brief.task === null ? [] : mentionedServers(brief.task, landing.repository),
    }),
  );
  if (Option.isNone(started)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { agent, created } = started.value;
  if (!created) return { agent, created };
  // The session opens with the plan or the task as its first message; an eve that did not take
  // it leaves no agent behind, so the retry under the same key starts afresh.
  const sessions = yield* eve;
  const opened = yield* sessions
    .open({
      conversationId: agent.conversationId,
      turn: BRAIN_HOST_TURN.TYPED,
      message:
        brief.task === null
          ? brief.planSnapshot
          : eveContent(
              brief.task,
              ask.attachments ?? [],
              mentionedContext(brief.task, landing.plan),
            ),
    })
    .pipe(
      Effect.catchTag("EveUnreachable", (failure) =>
        Effect.as(
          Effect.logWarning(
            `eve could not be reached to start a coding agent: ${describeUnreachable(failure)}`,
          ),
          undefined,
        ),
      ),
    );
  if (opened === undefined || opened.outcome !== EVE_SEND_OUTCOME.ACCEPTED) {
    yield* hostedStoreOrUnavailable(discardCodingAgent(userId, agent.id));
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }
  if (ask.choice !== undefined && ask.rememberChoice !== false) {
    yield* hostedStoreOrUnavailable(writeAccountPreferences(userId, { codingAgent: choice }));
  }
  return { agent, created };
});
