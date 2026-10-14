import type { DatabaseServices } from "@luke/database/core/query";
import {
  readAccountPreferences,
  writeAccountPreferences,
} from "@luke/database/models/account-store";
import {
  type CodingAgent,
  createCodingAgent,
  discardCodingAgent,
} from "@luke/database/models/coding-agent-store";
import { readPlan } from "@luke/database/models/plan-store";
import type { CodingAgentAttachment } from "@luke/features/coding-agent-wire";
import type { IntegrationProvider } from "@luke/features/integration-wire";
import type { ModelChoice } from "@luke/features/models-wire";
import { CODING_AGENT_DEFAULT_CHOICE } from "@luke/features/models-wire";
import { planMarkdown } from "@luke/features/plan-markdown";
import { failureKind } from "@luke/runtime/effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrArchived,
  hostedStoreOrUnavailable,
} from "@luke/service/http/http-effect";
import { Effect, Option } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { GitHubApp } from "../../github/github-app.js";
import { eveContent } from "../attached-files.js";
import { BRAIN_HOST_TURN } from "../brain-host/bounds.js";
import {
  describeUnreachable,
  EVE_SEND_OUTCOME,
  type EveSessions,
} from "../brain-host/eve-sessions.js";
import { mentionedContext } from "../mentioned-context.js";
import {
  acceptedModelChoice,
  type ModelCatalog,
  type ModelChoiceRefused,
} from "../model-catalog.js";
import { workspaceRepository } from "../workspace-repository.js";
import { anthropicFastAccess } from "./account-keys.js";

/**
 * start.ts -- an agent started on a plan: the one path a Start takes, from the Start button or from Luke's voice.
 *
 * The model, effort, and context window are the ask's own where it names a
 * model, the account's stored default otherwise, either checked against the
 * catalog, which also
 * refuses a stored default that has since left it; a refused choice is
 * answered as the catalog's own refusal, so the route can say invalid and
 * the voice tool can say which choices there are. The plan must name a
 * repository the account still reaches through the Luke GitHub App, and
 * through its workspace's installation where it has one, read now rather
 * than when the plan named it (`hosted/workspace-repository.ts`). The
 * agent and its conversation are made under the ask's key, and a retry
 * carrying the same key is the same agent and opens nothing again; a new
 * agent's eve session opens with the plan's document as the Markdown Copy
 * would put on the clipboard, or with the ask's task in the plan's place
 * and the files attached to it, which only a task carries.
 * An eve that did not take the opening leaves no agent behind, so the retry
 * under the same key starts afresh. An ask that named a choice makes it
 * the account's default, so the menu's last choice and the default stay one
 * value. Who reaches eve is the caller's: the route holds the developer's
 * own bearer, and the voice brain's tool acts as the deployment for the
 * account, which the coder channel's table admits for exactly this opening
 * (`coder-host/channel.ts`).
 */

/** What a Start asks: the plan, the key a retry carries again, the choice where one was made, the task where the agent is handed one in the plan's place, with the files attached to it, and the MCP servers its draft switched off. */
export interface StartAsk {
  readonly planId: string;
  readonly idempotencyKey: string;
  readonly choice: ModelChoice | undefined;
  readonly task: string | undefined;
  readonly attachments?: readonly CodingAgentAttachment[] | undefined;
  readonly disabledServers?: readonly IntegrationProvider[] | undefined;
  /** Whether a named choice becomes the account's default, as a developer's own Start makes it; an automation's run keeps the default as it stands. */
  readonly rememberChoice?: boolean;
}

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

/** Starts the account's agent on the plan, as above; eve is composed only once a new agent needs its session opened, so a retry that found its agent asks for none. */
export const startCodingAgent = /* @__PURE__ */ Effect.fn("web/startCodingAgent")(function* (
  eve: Effect.Effect<EveSessions, HostedRefusal, HttpClient.HttpClient>,
  userId: string,
  ask: StartAsk,
): Effect.fn.Return<CodingAgentStart, HostedRefusal | ModelChoiceRefused, StartServices> {
  const choice = yield* acceptedAgentChoice(userId, ask.choice);
  const plan = yield* hostedStoreOrUnavailable(readPlan(userId, ask.planId));
  if (Option.isNone(plan)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const repository = plan.value.plan.repository;
  if (repository === null) return yield* Effect.fail(HOSTED_REFUSAL.NO_REPOSITORY);
  yield* workspaceRepository(
    plan.value.plan.workspaceId,
    repository,
    plan.value.ownerId === userId ? userId : undefined,
  );
  const brief =
    ask.task === undefined
      ? { planSnapshot: planMarkdown(plan.value.plan), task: null }
      : { planSnapshot: null, task: ask.task };
  const started = yield* hostedStoreOrArchived(
    createCodingAgent(userId, {
      planId: ask.planId,
      idempotencyKey: ask.idempotencyKey,
      model: choice.model,
      effort: choice.effort,
      contextWindow: choice.contextWindow,
      ...brief,
      repository,
      disabledServers: ask.disabledServers,
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
              mentionedContext(brief.task, plan.value.plan),
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
