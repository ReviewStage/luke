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
import { readTask } from "@luke/database/models/task-store";
import { isWorkspaceMember } from "@luke/database/models/workspace-store";
import type { StoredAutomationOrigin } from "@luke/database/schemas/coding-agent";
import type { CodingAgentAttachment } from "@luke/features/coding-agent-wire";
import { CODING_AGENT_DEFAULT_CHOICE, type ModelChoice } from "@luke/features/models-wire";
import { planMarkdown } from "@luke/features/plan-markdown";
import type { Task } from "@luke/features/task-wire";
import { failureKind } from "@luke/runtime/effect";
import { Effect, Option } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { GitHubApp } from "../../github/github-app.js";
import { githubReachOrRefusal } from "../../github/github-refusal.js";
import { readBranchHead } from "../../github/repository-file.js";
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
import { readMentioned } from "../mentioned-reads.js";
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
 * would put on the clipboard, or with the ask's prompt in the plan's place
 * and the files attached to it, which only a prompt carries; a note the
 * ask carries rides after either under a heading of its own, so what the
 * developer said beyond the plan reaches the agent in the same first
 * message rather than as a second one on its heels. An agent
 * started with no plan is handed a prompt in a workspace the account is a
 * member of, on a repository named by the ask and read through that
 * workspace's installation as a plan's is.
 * An ask that names a branch has its agent's checkout cloned at that branch
 * rather than the default one, which the agent's row keeps; the branch is
 * read on GitHub through the same installation before anything is made, so
 * one the repository does not hold is refused here rather than at the clone.
 * The MCP servers the words mention are handed to the agent's first turn
 * whatever its switches say, but an automation's run is handed only those
 * its automation's own prompt mentions, never those of the webhook body or
 * the GitHub event its prompt carries after it, since whoever wrote those
 * is not the agent's developer.
 * An eve that did not take the opening leaves no agent behind, so the retry
 * under the same key starts afresh. An ask that named a choice makes it
 * the account's default, so the menu's last choice and the default stay one
 * value. Who reaches eve is the caller's: the route holds the developer's
 * own bearer, and the voice brain's tool acts as the deployment for the
 * account, which the coder channel's table admits for exactly this opening
 * (`coder-host/channel.ts`).
 */

/** The heading a start's note stands under, after the plan or the prompt it rides with: the developer's, or the coding agent's that started the agent (`../coding-agent-tools.ts`). */
export const START_NOTE_HEADING = {
  DEVELOPER: "## Note from the developer",
  AGENT: "## Note from the coding agent that started you",
} as const;

type StartNoteHeading = (typeof START_NOTE_HEADING)[keyof typeof START_NOTE_HEADING];

/** Where a Start puts the agent: on a plan, handed the plan or a prompt in its place and a note after either, or in a workspace with no plan, on a repository, handed a prompt. */
export type StartPlace =
  | {
      readonly taskId: string;
      readonly prompt: string | undefined;
      /** What the developer said for the agent beyond the plan or the prompt; none where they said nothing more. */
      readonly note?: string | undefined;
      /** Whose note it is; the developer's unless a coding agent started this one. */
      readonly noteHeading?: StartNoteHeading | undefined;
    }
  | {
      readonly taskId: null;
      readonly organizationId: string;
      readonly repository: string;
      readonly prompt: string;
    };

/** What a Start asks: where it goes, the key a retry carries again, the choice where one was made, the files attached to a prompt, the MCP servers its draft switched off, and the automation whose run asks, with that run. */
export type StartAsk = StartPlace & {
  readonly idempotencyKey: string;
  readonly choice: ModelChoice | undefined;
  readonly attachments?: readonly CodingAgentAttachment[] | undefined;
  readonly disabledServers?: readonly string[] | undefined;
  /** Whether a named choice becomes the account's default, as a developer's own Start makes it; an automation's run keeps the default as it stands. */
  readonly rememberChoice?: boolean;
  /** The automation whose run starts the agent; none for a Start by hand. */
  readonly automationId?: string | undefined;
  /** That automation's run as it starts the agent, which the agent keeps; none for a Start by hand. */
  readonly automationOrigin?: StoredAutomationOrigin | undefined;
  /** The agent's title from the start, a run's fixed name, which no model is asked for; none for a Start the model names. */
  readonly title?: string | undefined;
  /** The words the first turn's MCP servers are read from where they are not all the agent is handed: an automation's own prompt, never a webhook body or a GitHub event's words beside it; the prompt and the note otherwise. */
  readonly serverWords?: string | undefined;
  /** The branch the agent's checkout is cloned at, such as a stacked pull request's; none for the repository's default branch. */
  readonly branch?: string | undefined;
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
  readonly task: Task | undefined;
  readonly mover: string | undefined;
  readonly place: CodingAgentPlace;
}

/** The brief with the note after it under its heading; the brief alone where there is no note. */
function withNote(
  brief: string,
  note: string | undefined,
  heading: StartNoteHeading = START_NOTE_HEADING.DEVELOPER,
): string {
  return note === undefined ? brief : `${brief}\n\n${heading}\n\n${note}`;
}

/**
 * The branch named for the agent's checkout, confirmed on GitHub through
 * the workspace's installation, or refused: as not found where GitHub names
 * no commit for it, and as GitHub unanswered where it could not be asked.
 */
const confirmedBranch = Effect.fnUntraced(function* (
  workspaceId: string,
  repository: string,
  branch: string,
): Effect.fn.Return<void, HostedRefusal, DatabaseServices | HttpClient.HttpClient | GitHubApp> {
  const app = yield* GitHubApp;
  const reached = yield* githubReachOrRefusal(app.repositoryReadToken(workspaceId, repository));
  if (Option.isNone(reached)) return yield* Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
  const { repository: confirmed, token } = reached.value;
  const head = yield* readBranchHead(token, confirmed, branch).pipe(
    Effect.mapError(() => HOSTED_REFUSAL.GITHUB_UNANSWERED),
  );
  if (head === undefined) return yield* Effect.fail(HOSTED_REFUSAL.BRANCH_NOT_FOUND);
});

/** The plan read as the account, its repository required, or the workspace the account must be a member of; either refused as naming nothing. On a plan the agent is handed its document or the prompt; in a workspace, the prompt. */
const landingOf = Effect.fnUntraced(function* (
  userId: string,
  place: StartPlace,
): Effect.fn.Return<StartLanding, HostedRefusal, DatabaseServices> {
  if (place.taskId === null) {
    const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, place.organizationId));
    if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return {
      workspaceId: place.organizationId,
      repository: place.repository,
      task: undefined,
      mover: undefined,
      place: {
        taskId: null,
        organizationId: place.organizationId,
        planSnapshot: null,
        prompt: place.prompt,
      },
    };
  }
  const read = yield* hostedStoreOrUnavailable(readTask(userId, place.taskId));
  if (Option.isNone(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { task, ownerId } = read.value;
  if (task.repository === null) return yield* Effect.fail(HOSTED_REFUSAL.NO_REPOSITORY);
  return {
    workspaceId: task.workspaceId,
    repository: task.repository,
    task,
    mover: ownerId === userId ? userId : undefined,
    place:
      place.prompt === undefined
        ? {
            taskId: place.taskId,
            planSnapshot: withNote(planMarkdown(task), place.note, place.noteHeading),
            prompt: null,
          }
        : {
            taskId: place.taskId,
            planSnapshot: null,
            prompt: withNote(place.prompt, place.note, place.noteHeading),
          },
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
  if (ask.branch !== undefined) {
    yield* confirmedBranch(landing.workspaceId, landing.repository, ask.branch);
  }
  const brief = landing.place;
  // The words a mention is read from: the prompt with any note after it, or a plan start's note alone.
  const words = brief.prompt ?? (ask.taskId === null ? undefined : ask.note);
  // Note that an automation's run names its own prompt, because the words an outsider wrote beside it switch on nothing.
  const serverWords = ask.serverWords ?? words;
  // What the words mention of the plan's pages and agents is read before the agent is made, so a
  // read that fails leaves no agent its retry would find and never open a session for.
  const reads =
    words === undefined
      ? undefined
      : yield* hostedStoreOrUnavailable(
          readMentioned(userId, words, {
            task: landing.task,
            workspaceId: landing.workspaceId,
          }),
        );
  const started = yield* hostedStoreOrArchived(
    createCodingAgent(userId, {
      ...brief,
      automationId: ask.automationId,
      automationOrigin: ask.automationOrigin,
      title: ask.title,
      idempotencyKey: ask.idempotencyKey,
      model: choice.model,
      effort: choice.effort,
      contextWindow: choice.contextWindow,
      repository: landing.repository,
      startBranch: ask.branch,
      disabledServers: ask.disabledServers,
      // The servers those words mention are its first turn's, whatever the switches say.
      mentionedServers:
        serverWords === undefined ? [] : mentionedServers(serverWords, landing.repository),
    }),
  );
  if (Option.isNone(started)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { agent, created } = started.value;
  if (!created) return { agent, created };
  // The session opens with the plan or the prompt as its first message; an eve that did not take
  // it leaves no agent behind, so the retry under the same key starts afresh.
  const sessions = yield* eve;
  const opened = yield* sessions
    .open({
      conversationId: agent.conversationId,
      turn: BRAIN_HOST_TURN.TYPED,
      message:
        brief.prompt === null
          ? eveContent(
              brief.planSnapshot,
              [],
              words === undefined ? undefined : mentionedContext(words, landing.task, reads),
            )
          : eveContent(
              brief.prompt,
              ask.attachments ?? [],
              mentionedContext(brief.prompt, landing.task, reads),
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
