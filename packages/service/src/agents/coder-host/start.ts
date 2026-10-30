import { randomUUID } from "node:crypto";
import { type DatabaseServices, READ_CONCURRENCY } from "@luke/database/core/query";
import { accountExperimentOn, readAccountPreferences } from "@luke/database/models/account-store";
import {
  type Agent,
  type AgentPlace,
  archiveAgentCommitted,
  createAgent,
  discardAgent,
  nativeRuntimesOfReached,
  readAgent,
  readAgentByKey,
  readAgentContext,
  taskPilotStands,
} from "@luke/database/models/agent-store";
import type { HandedFile } from "@luke/database/models/attached-file-parts";
import { devicesNamed } from "@luke/database/models/device-store";
import { hostRemoved } from "@luke/database/models/host-store";
import { listAccountProviderKeyRows } from "@luke/database/models/provider-key-store";
import {
  assignUnassignedTaskCommitted,
  beginTaskWorkCommitted,
  readTask,
  readTaskWorkspace,
  readTreeStopped,
  type StoredTask,
} from "@luke/database/models/task-store";
import { isWorkspaceMember, readAccountNames } from "@luke/database/models/workspace-store";
import {
  type AwaitingLineMetadata,
  automationLineMetadata,
  type LineSender,
  storeWriter,
} from "@luke/database/models/writer";
import type {
  StoredArchive,
  StoredAutomationOrigin,
  StoredStartedFrom,
} from "@luke/database/schemas/agent";
import { type ConversationRuntime, MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import {
  firstMessageText,
  type NoteFiles,
  type Replay,
  START_NOTE_HEADING,
  type StartNoteHeading,
  stepsBytes,
  summaryBytes,
} from "@luke/features/agent-replay";
import {
  AGENT_ARCHIVER,
  AGENT_ATTACHMENT_TYPE,
  AGENT_BOUNDS,
  AGENT_KIND,
  AGENT_MACHINE,
  type AgentAttachment,
  type AgentKind,
  type AgentMachineKind,
  type AgentStartFrom,
  type AgentStartRequest,
  type AgentSummary,
  CONTEXT_WINDOW,
  LOCAL_AGENT_REFUSAL,
} from "@luke/features/agent-wire";
import type { GitHubAccess } from "@luke/features/github-repositories-wire";
import { agentName, automationRun } from "@luke/features/model-label";
import { agentFallbackChoice, type ModelChoice } from "@luke/features/models-wire";
import { planMarkdown } from "@luke/features/plan-markdown";
import { TASK_MODE, type Task } from "@luke/features/task-wire";
import { bothInOrder, causeKind, failureKind } from "@luke/runtime/effect";
import { EXPERIMENT } from "@luke/settings";
import { MESSAGE_CHANNEL, START_LINE_BRIEF } from "@luke/wire";
import { sentLineId } from "@luke/wire/host-ids";
import { Cause, Clock, Effect, Option, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  recordServerEvent,
  SERVER_AGENT_START_KIND,
  SERVER_EVENT,
} from "../../events/server-events.js";
import { GitHubApp } from "../../github/github-app.js";
import { githubReachOrRefusal } from "../../github/github-refusal.js";
import { readBranchHead } from "../../github/repository-file.js";
import { workspaceRepository } from "../../github/workspace-repository.js";
import {
  credentialMissing,
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  localAgentRefused,
} from "../../http/http-effect.js";
import { logStoreFailure } from "../../http/store-failure.js";
import {
  ModelCatalog,
  ModelChoiceRefused,
  type OfferedModel,
  offeredToAccount,
  validateModelChoice,
} from "../../providers/model-catalog.js";
import { admitsPlanWriter } from "../agent-reach.js";
import { eveContent, keptHandedImages } from "../attached-files.js";
import { EVE_HOST_TURN } from "../eve-host/bounds.js";
import {
  type AgentSessions,
  describeUnreachable,
  EVE_SEND_OUTCOME,
  type EveFailed,
  type EveTypedTurn,
  RUNTIME_REFUSAL,
} from "../eve-host/eve-sessions.js";
import { MENTIONED_BOUNDS, mentionedContext, mentionedServers } from "../mentioned-context.js";
import { readMentioned } from "../mentioned-reads.js";
import { agentFailureSaid, agentLogIds } from "./agent-log.js";
import {
  type AccountKeyRows,
  AgentCredentialMissing,
  accountFastOffer,
  agentMachineChoice,
  agentRuntimeChoice,
  LocalAgentRefused,
  localAgentRuntimeChoice,
  markedUnconnected,
} from "./agent-runtime-choice.js";
import { contextWindowOf } from "./context.js";
import { isNativeRuntime } from "./native-runtime.js";
import {
  type FittedReplay,
  replayOf,
  type StartFrom,
  type StartWhere,
  startFromOf,
} from "./replay.js";
import {
  type FittedSteps,
  filesBytes,
  fitReplay,
  fromEveEstimate,
  measuredBoundBytes,
  REPLAY_FIT,
  replayBudgetBytes,
  replayTokens,
  type SummaryModelOf,
  summarizeSteps,
  withinWindow,
} from "./replay-summary.js";
import { failedCallRefusal } from "./runtime-sessions.js";
import { agentSummary, summaryAccounts, summaryDevices } from "./status.js";
import { agentLineSender } from "./steer.js";
import { cancelledTurn, summaryOf } from "./stop.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/**
 * start.ts -- an agent started on a task, or in a workspace with no task: the one path a Start takes, from the Start button, from Luke's voice, or from an automation's run.
 *
 * The model, effort, and context window are the ask's own where it names a
 * model, the account's stored default otherwise, either checked against the
 * catalog, which also
 * refuses a stored default that has since left it; a refused choice is
 * answered as the catalog's own refusal, so the route can say invalid and
 * the voice tool can say which choices there are. The task must name a
 * repository the account still reaches through the Luke GitHub App, and
 * through its workspace's installation where it has one, read now rather
 * than when the task named it (`packages/service/src/github/workspace-repository.ts`). The
 * agent and its conversation are made under the ask's key, and a retry
 * carrying the same key is the same agent and opens nothing again; a new
 * agent's eve session opens with the task's document as the Markdown Copy
 * would put on the clipboard, or with the ask's prompt in the plan's place
 * and the files attached to it, which only a prompt carries; a note the
 * ask carries rides after either under a heading of its own, so what the
 * developer said beyond the plan reaches the agent in the same first
 * message rather than as a second one on its heels. Once eve has taken an
 * agent on a task, the task moves into progress from the backlog or to do
 * and never back (`beginTaskWork`), a move that fails logged rather than
 * the Start's failure; a Start by hand on a task no one is assigned to assigns it to
 * its starter (`assignUnassignedTask`), as that fails logged too. An agent
 * started with no task is handed a prompt in a workspace the account is a
 * member of, on a repository named by the ask and read through that
 * workspace's installation as a task's is.
 * A Start from another agent of the task, or of the workspace where the
 * source has no task, to continue it or to fork it at one of its messages,
 * hands the new agent that agent's brief with its
 * transcript replayed after it (`replay.ts`) and its work, what it had not
 * pushed included, copied to a branch of its own (`snapshot.ts`), the note
 * after both with the files the note carries, and runs it on that agent's
 * choice and servers unless the ask names its own, and an agent started from an
 * automation's run is no run of that automation. Its mentions and servers
 * are read from the source's brief and the note, as a fresh start's would
 * be, and never from the replay. A continue is named after its source,
 * `<title> (continued)`, where the ask names no title and the source has
 * one, and once eve has taken it the source is stopped as a Stop stops it,
 * since the work goes on in the new agent; a fork leaves its source
 * running, and a source that could not be stopped is logged, never the
 * Start's failure. A continue of a pilot is a pilot too, and takes over
 * from its source: the account's agents the source started that stand
 * unarchived report to the new pilot from the transaction that makes it
 * (`createAgent`), those of any pilot that took over from it before among
 * them, and once stopped the source is archived, by the coding agent that
 * continued it or else the member, which is logged where it fails; a source
 * eve would not stop stands unarchived. A fork of a pilot takes over nothing.
 * A member's continue of an agent a pilot started, such as a sub-pilot,
 * reports to that pilot as its source did; every other Start records only
 * the coding agent whose `start_agent` asks as its starter, the one its note
 * tells it to report to.
 * An ask that names a branch has its agent's checkout cloned at that branch
 * rather than the default one, which the agent's row keeps; the branch is
 * read on GitHub through the same installation before anything is made, so
 * one the repository does not hold is refused here rather than at the clone.
 * A Start from another agent that names no branch is cloned at the branch
 * that agent was started on, so a continue of an agent started on a stacked
 * pull request's branch cuts from and opens against that branch as its
 * source did, rather than the default one; where GitHub no longer holds it,
 * as once that pull request merged and its branch went, the new agent is
 * cloned at the default branch rather than refused.
 * The MCP servers the words mention are handed to the agent's first turn
 * whatever its switches say, but an automation's run is handed only those
 * its automation's own prompt mentions, never those of the webhook body or
 * the GitHub event its prompt carries after it, since whoever wrote those
 * is not the agent's developer.
 * A blank Start, on a task, hands the agent nothing, neither the plan nor
 * a prompt, and opens no session: its first words, typed or spoken, open
 * one as they reach it (`steer.ts`), and leaves its task's status where it
 * stands, since no work was handed. It runs on the choice any Start does,
 * and on a task with no repository it works in none and asks nothing of
 * GitHub, where any other Start on such a task is refused.
 * A fresh Start on a task worked in pilot mode (`TASK_MODE.PILOT`) where no
 * pilot stands unarchived makes the task's pilot, whoever asks, a member or a
 * coding agent's `start_agent`, which is how a pilot gives a child task its
 * sub-pilot; every later one makes a coder, as every Start on any other task
 * does. A pilot is refused for an account with the Pilot experiment off.
 * Any Start on a child task of a pilot tree whose Running switch is off
 * (`readTreeStopped`) is refused, a member's or a coding agent's, fresh or
 * from another agent, until the switch is on; the top task's own pilot
 * never is, since it plans and talks while its tree is stopped.
 * The member's operator is the one blank Start with no task: in a workspace
 * the account is a member of, on no repository, from no other agent and
 * with no prompt or note, and no other Start is an operator's. Every other
 * Start with no task still names a prompt, and a repository where it works
 * in one; one that names none works in none, as the operator does. The store
 * answers the operator already standing where there is one
 * (`createAgent`), so a Start of it is an ensure.
 * An eve that did not take the opening leaves no agent behind, so the retry
 * under the same key starts afresh, and so does one that could not be
 * reached, a first line that could not be written, and a Start cut short
 * before eve took it, each said as an error naming the agent (`agent-log.ts`).
 * A choice an ask names runs that one agent and is never kept as the
 * account's default, which only
 * Settings writes. Who reaches eve is the caller's: the route holds the developer's
 * own bearer, and the voice brain's and a coding agent's tool act as the
 * deployment for the account, which the coder channel's table admits for
 * exactly this opening, and its door for the cancel that stops a
 * continue's source (`coder-host/channel.ts`).
 */

export type { StartWhere };

/**
 * Where a Start puts the agent and what it is handed: on a plan, handed the
 * plan or a prompt in its place, or in a workspace with no plan, on a
 * repository, handed a prompt, since there is no plan to hand it; in either,
 * another agent of that place's brief and transcript in the prompt's place
 * where it takes over from one, and a note after any of them.
 */
export type StartPlace = StartWhere & {
  /** The developer's words in the plan's place; none for the plan, or for a Start from another agent, whose brief stands for them. */
  readonly prompt: string | undefined;
  /** What the developer said for the agent beyond the plan or the prompt; none where they said nothing more. */
  readonly note?: string | undefined;
  /** Whose note it is; the developer's unless a coding agent started this one. */
  readonly noteHeading?: StartNoteHeading | undefined;
  /** Another agent of the same place to take over from, handed its brief and its transcript replayed in place of the plan or a prompt; none for an agent started afresh. */
  readonly from?: AgentStartFrom | undefined;
  /** Whether the agent is handed nothing, neither the plan nor a prompt, its first words coming later; such a Start, on a task or as the member's operator, names no prompt, note, or source. */
  readonly blank?: boolean | undefined;
  /** What the agent is: a coder unless named, or the member's operator, which only a blank Start with no task and no repository makes. */
  readonly kind?: AgentKind | undefined;
};

/** What a Start asks: where it goes, the key a retry carries again, the choice where one was made, the files attached to a prompt, the MCP servers its draft switched off, and the automation whose run asks, with that run. */
export type StartAsk = StartPlace & {
  readonly idempotencyKey: string;
  readonly choice: ModelChoice | undefined;
  readonly attachments?: readonly AgentAttachment[] | undefined;
  readonly disabledServers?: readonly string[] | undefined;
  /** The automation whose run starts the agent; none for a Start by hand. */
  readonly automationId?: string | undefined;
  /** That automation's run as it starts the agent, which the agent keeps; none for a Start by hand. */
  readonly automationOrigin?: StoredAutomationOrigin | undefined;
  /** The automation run the agent belongs to: the run that starts it, or the run of the coding agent whose `start_agent` starts it on no task; none for an agent no run owns. */
  readonly automationRunId?: string | undefined;
  /** The coding agent whose `start_agent` asks, which the first line names as its sender and the agent's row keeps as its starter; none for a Start by a member or an automation. */
  readonly startedBy?: Agent | undefined;
  /** The agent's title from the start, a run's fixed name, which no model is asked for; none for a Start the model names. */
  readonly title?: string | undefined;
  /** How the summary of the steps a replay cannot keep is written, for a Start from another agent; none leaves those steps out unsummarized. */
  readonly summaryModel?: SummaryModelOf | undefined;
  /** The words the first turn's MCP servers are read from where they are not all the agent is handed: an automation's own prompt, never a webhook body or a GitHub event's words beside it; the prompt and the note otherwise, a source's brief standing for the prompt and its replay never read. */
  readonly serverWords?: string | undefined;
  /** The branch the agent's checkout is cloned at, such as a stacked pull request's; none for the repository's default branch. */
  readonly branch?: string | undefined;
  /** Whether a call is opened into the agent as it lands; it runs where any Start would (`startRuntimeOf`). */
  readonly call?: boolean | undefined;
  /** The repository the task's own start reached in the same request, which the agent's Start takes rather than asking GitHub again; none for every other Start. */
  readonly reached?: StartReach | undefined;
  /** The task the task's own start made in the same request, as it was made, which the agent's Start lands on rather than reading it again; none for every other Start. */
  readonly landed?: StoredTask | undefined;
};

/** A repository as a task's start reached it: the full name its row keeps, and how it was reached. */
export interface StartReach {
  readonly repository: string;
  readonly access: GitHubAccess;
}

/** What a Start came to: the agent, and whether this ask made it or found it under its key. */
export interface AgentStarted {
  readonly agent: Agent;
  readonly created: boolean;
  /** The transaction the agent's row was written in, where this Start wrote it. */
  readonly txid?: string;
}

/** What a Start reaches: the store, the catalog, GitHub through the App on the developer's standing, and the network to eve. */
export type StartServices = DatabaseServices | HttpClient.HttpClient | GitHubApp | ModelCatalog;

/** What an account may start an agent on: the models the catalog offers it, and the choice a Start naming none runs on. */
export interface AccountModelChoices {
  readonly offered: readonly OfferedModel[];
  /** The account's stored default, which may have since left the catalog, or where it stored none the fallback its credentials pay for (`agentFallbackChoice`). */
  readonly defaultChoice: ModelChoice;
}

/**
 * The models an account may start an agent on, the catalog as the account
 * is offered it (`offeredToAccount`), so a fast version withheld from it,
 * its key's organization never granted fast mode, is not among them, and
 * the account's default choice beside them. This is the one source a Start
 * is checked against, the agent tools list the choices from, and the
 * preferences snapshot answers an unstored default from, so none of them
 * disagree. A catalog or a store that could not be read is an outage.
 */
export const accountModelChoices = (userId: string) =>
  Effect.map(modelChoicesRead(userId), (read) => read.choices);

/**
 * The account's choices as `accountModelChoices` reads them, with its
 * stored credentials they were decided from, which a Start decides its
 * payer from too rather than reading them again. Its preferences, its
 * credentials, and the catalog are read together.
 */
const modelChoicesRead = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
): Effect.fn.Return<
  { readonly choices: AccountModelChoices; readonly keys: AccountKeyRows },
  HostedRefusal,
  DatabaseServices | ModelCatalog
> {
  const catalog = yield* ModelCatalog;
  const { preferences, keys, read } = yield* Effect.all(
    {
      preferences: hostedStoreOrUnavailable(readAccountPreferences(userId)),
      keys: hostedStoreOrUnavailable(listAccountProviderKeyRows(userId)),
      read: catalog.read.pipe(
        Effect.catchTag("ModelCatalogUnavailable", (unavailable) =>
          Effect.logWarning(
            `the model catalog could not be read: ${failureKind(unavailable.cause)}`,
          ).pipe(Effect.andThen(Effect.fail(HOSTED_REFUSAL.UNAVAILABLE))),
        ),
      ),
    },
    { concurrency: READ_CONCURRENCY },
  );
  const fastOffer = yield* hostedStoreOrUnavailable(accountFastOffer(userId, keys));
  const offered = yield* hostedStoreOrUnavailable(
    markedUnconnected(userId, offeredToAccount(read, fastOffer), keys),
  );
  const stored = preferences?.agent;
  return { choices: { offered, defaultChoice: stored ?? agentFallbackChoice(offered) }, keys };
});

/**
 * The choice an agent runs on: the one named where one is, the account's
 * default otherwise, either checked against the models the account is
 * offered (`accountModelChoices`), so a fast version withheld from it is
 * refused here rather than at the agent's first step. A catalog that could
 * not be read is an outage; a choice it refuses is its own refusal.
 */
export const acceptedAgentChoice = (userId: string, named: ModelChoice | undefined) =>
  Effect.map(acceptedChoiceRead(userId, named), (accepted) => accepted.choice);

/** The choice as `acceptedAgentChoice` accepts it, with the account's stored credentials it was checked against. */
const acceptedChoiceRead = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  named: ModelChoice | undefined,
): Effect.fn.Return<
  { readonly choice: ModelChoice; readonly keys: AccountKeyRows },
  HostedRefusal | ModelChoiceRefused,
  DatabaseServices | ModelCatalog
> {
  const { choices, keys } = yield* modelChoicesRead(userId);
  const { offered, defaultChoice } = choices;
  const choice = yield* Effect.fromResult(
    validateModelChoice(offered, named ?? defaultChoice),
  ).pipe(Effect.mapError((reason) => new ModelChoiceRefused({ reason, offered })));
  return { choice, keys };
});

/** Where a Start lands, read as the account: the workspace whose installation reads the repository, the repository, none for a blank Start on a task with none or the member's operator, the task where there is one, the account that may move it where that is the account asking, and the store's place for the agent with what it is handed. */
interface StartLanding {
  readonly workspaceId: string;
  readonly repository: string | null;
  readonly task: Task | undefined;
  readonly mover: string | undefined;
  readonly place: AgentPlace;
  /** What the new agent keeps of the agent it was started from; none for one started afresh. */
  readonly startedFrom: StoredStartedFrom | undefined;
}

/** The agent a Start takes over from as its landing reads it: the source's prompt, the new agent's brief in the plan's place where it was handed one, and how its replay is fitted to the first message it is written into, which `firstMessage` writes for a replay or none. */
interface ReplayFitter {
  readonly prompt: string | undefined;
  readonly fit: (
    firstMessage: (replay: Replay | undefined) => string,
  ) => Effect.Effect<FittedReplay, never, DatabaseServices>;
}

/**
 * The branch named for the agent's checkout, confirmed on GitHub through
 * the workspace's installation, or refused: as not found where GitHub names
 * no commit for it, and as GitHub unanswered where it could not be asked.
 */
const confirmedBranch = Effect.fnUntraced(function* (
  workspaceId: string,
  repository: string,
  member: string | undefined,
  branch: string,
): Effect.fn.Return<void, HostedRefusal, DatabaseServices | HttpClient.HttpClient | GitHubApp> {
  const app = yield* GitHubApp;
  const reached = yield* githubReachOrRefusal(
    app.repositoryReadToken(workspaceId, repository, member),
  );
  if (Option.isNone(reached)) return yield* Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
  const { repository: confirmed, token } = reached.value;
  const head = yield* readBranchHead(token, confirmed, branch).pipe(
    Effect.mapError(() => HOSTED_REFUSAL.GITHUB_UNANSWERED),
  );
  if (head === undefined) return yield* Effect.fail(HOSTED_REFUSAL.BRANCH_NOT_FOUND);
});

/**
 * The branch the agent's checkout is cloned at: the one the ask names,
 * which GitHub must hold; else the one the agent it is started from was
 * started on, where GitHub still holds it; else none, the default branch.
 * Note that a retry whose agent already stands is not asked of GitHub
 * again, because the branch may be gone since and the agent its Start made
 * is still the answer.
 */
const startBranchOf = Effect.fnUntraced(function* (
  userId: string,
  ask: StartAsk,
  inherited: string | null,
  landing: StartLanding,
  member: string | undefined,
): Effect.fn.Return<
  string | undefined,
  HostedRefusal,
  DatabaseServices | HttpClient.HttpClient | GitHubApp
> {
  const branch = ask.branch ?? inherited ?? undefined;
  if (branch === undefined || landing.repository === null) return undefined;
  const made = yield* hostedStoreOrUnavailable(readAgentByKey(userId, ask.idempotencyKey));
  if (Option.isSome(made)) return branch;
  const confirmed = confirmedBranch(landing.workspaceId, landing.repository, member, branch);
  if (ask.branch !== undefined) return yield* Effect.as(confirmed, branch);
  return yield* confirmed.pipe(
    Effect.as<string | undefined>(branch),
    Effect.catch((refusal) =>
      refusal.error === HOSTED_REFUSAL.BRANCH_NOT_FOUND.error
        ? Effect.succeed(undefined)
        : Effect.fail(refusal),
    ),
  );
});

/** What the agent is handed, written around the replay of the agent it takes over from where there is one, the note after both; and what it keeps of that agent. */
const handedOf = Effect.fnUntraced(function* (
  words: string,
  place: StartPlace,
  fitter: ReplayFitter | undefined,
  noteFiles: NoteFiles | undefined,
) {
  const heading = place.noteHeading ?? START_NOTE_HEADING.DEVELOPER;
  const written = (replayed: Replay | undefined) =>
    firstMessageText(words, replayed, place.note, heading, noteFiles);
  // The replay is fitted to the new agent's first message as it is written around it.
  const fitted = fitter === undefined ? undefined : yield* fitter.fit(written);
  return { text: written(fitted?.replay), startedFrom: fitted?.startedFrom };
});

/** Whether the place asks for the member's operator as only it may be started: blank, with no task, no repository, no source, and no words. */
function operatorPlace(place: StartPlace, fitter: ReplayFitter | undefined): boolean {
  return (
    place.blank === true &&
    place.taskId === null &&
    place.repository === null &&
    place.prompt === undefined &&
    place.note === undefined &&
    place.from === undefined &&
    fitter === undefined
  );
}

/**
 * What a fresh Start on the task asks for: its pilot where the task is worked
 * in pilot mode and no pilot of it stands unarchived, whoever started it,
 * else a coder. A pilot is refused as not permitted for an account with the
 * Pilot experiment off: the account the Start is made for, which for a coding
 * agent's `start_agent` is its starter, so a sub-pilot is held to whoever
 * started the pilot above it. Note that the store asks again under the task's
 * lock (`createAgent`), so a Start that raced another to the task's pilot
 * makes a coder.
 */
const freshKindOn = Effect.fnUntraced(function* (
  userId: string,
  task: Task,
): Effect.fn.Return<
  typeof AGENT_KIND.CODER | typeof AGENT_KIND.PILOT,
  HostedRefusal,
  DatabaseServices
> {
  if (task.mode !== TASK_MODE.PILOT) return AGENT_KIND.CODER;
  if (yield* hostedStoreOrUnavailable(taskPilotStands(task.id))) return AGENT_KIND.CODER;
  if (!(yield* hostedStoreOrUnavailable(accountExperimentOn(userId, EXPERIMENT.PILOT)))) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  }
  return AGENT_KIND.PILOT;
});

/** The task read as the account, its repository required unless the Start is blank, or the workspace the account must be a member of; either refused as naming nothing. On a task the agent is handed its document or the prompt, in a workspace the prompt, with the replay of the agent it takes over from after either where there is one, whose brief stands for the prompt, or nothing for a blank Start on a task or the member's operator. */
const landingOf = Effect.fnUntraced(function* (
  userId: string,
  place: StartPlace,
  fitter: ReplayFitter | undefined,
  noteFiles: NoteFiles | undefined,
  landed: StoredTask | undefined,
): Effect.fn.Return<StartLanding, HostedRefusal, DatabaseServices> {
  const brief = fitter === undefined ? place.prompt : fitter.prompt;
  const operator = place.kind === AGENT_KIND.OPERATOR;
  // The operator is started one way alone, and no other Start is an operator's.
  if (operator && !operatorPlace(place, fitter)) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  if (place.taskId === null) {
    const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, place.organizationId));
    if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    if (operator) {
      return {
        workspaceId: place.organizationId,
        repository: null,
        task: undefined,
        mover: undefined,
        place: {
          taskId: null,
          organizationId: place.organizationId,
          planSnapshot: null,
          prompt: null,
          kind: AGENT_KIND.OPERATOR,
        },
        startedFrom: undefined,
      };
    }
    // An agent with no plan has only words to be handed, so a Start that names none starts
    // nothing; one that names no repository works in none, as a blank agent on a task with none does.
    if (brief === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    const handed = yield* handedOf(brief, place, fitter, noteFiles);
    return {
      workspaceId: place.organizationId,
      repository: place.repository,
      task: undefined,
      mover: undefined,
      place: {
        taskId: null,
        organizationId: place.organizationId,
        planSnapshot: null,
        prompt: handed.text,
      },
      startedFrom: handed.startedFrom,
    };
  }
  // A task its own start made a moment ago, in the same request, is landed on as it was made.
  const read =
    landed !== undefined && landed.task.id === place.taskId
      ? Option.some(landed)
      : yield* hostedStoreOrUnavailable(readTask(userId, place.taskId));
  if (Option.isNone(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { task, ownerId } = read.value;
  // A child task of a stopped pilot tree takes no agent, fresh or continued, until Running is on.
  if (yield* hostedStoreOrUnavailable(readTreeStopped(userId, task.id))) {
    return yield* Effect.fail(HOSTED_REFUSAL.TREE_STOPPED);
  }
  const mover = ownerId === userId ? userId : undefined;
  // A Start from another agent goes its source's way; only a fresh one can make the task's pilot.
  const kind = place.from === undefined ? yield* freshKindOn(userId, task) : AGENT_KIND.CODER;
  if (place.blank === true) {
    return {
      startedFrom: undefined,
      workspaceId: task.workspaceId,
      repository: task.repository,
      task,
      mover,
      place: { taskId: place.taskId, planSnapshot: null, prompt: null, kind },
    };
  }
  if (task.repository === null) return yield* Effect.fail(HOSTED_REFUSAL.NO_REPOSITORY);
  const handed = yield* handedOf(brief ?? planMarkdown(task), place, fitter, noteFiles);
  return {
    startedFrom: handed.startedFrom,
    workspaceId: task.workspaceId,
    repository: task.repository,
    task,
    mover,
    place:
      brief === undefined
        ? { taskId: place.taskId, planSnapshot: handed.text, prompt: null, kind }
        : { taskId: place.taskId, planSnapshot: null, prompt: handed.text, kind },
  };
});

/** How many of the note's files are text files, which eve is handed inlined, and how many images and PDFs. */
function noteFilesOf(files: readonly AgentAttachment[]): NoteFiles {
  const text = files.filter((file) => file.mediaType === AGENT_ATTACHMENT_TYPE.TEXT).length;
  return { text, other: files.length - text };
}

/** The bytes of a text in UTF-8. */
function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/**
 * The newest step the source's work measured, read down its lineage from
 * the source to the first agent that ran one, since a source that never ran
 * a step carried the work of the agent before it; nothing where none did or
 * none reads.
 */
const measuredStepOf = Effect.fnUntraced(function* (userId: string, lineage: readonly Agent[]) {
  for (const agent of lineage) {
    const context = yield* readAgentContext(userId, agent.id).pipe(
      Effect.orElseSucceed(() => Option.none()),
    );
    if (Option.isSome(context) && context.value.lastStep !== null) {
      return { step: context.value.lastStep, compacted: context.value.compactedAt !== null };
    }
  }
  return undefined;
});

/**
 * How the replay of the agent a Start takes over from is fitted: against
 * the window of the model the new agent runs on, as the catalog lists it,
 * less the instructions the source's work last measured, or a fallback
 * where it measured none, and within the context it last measured where
 * eve compacted it (`measuredBoundBytes`), with the steps that do not fit
 * summarized on the model `summaryModel` finds at the model's lowest
 * effort, where it finds one (`replay-summary.ts`); then the whole first
 * prompt, the files and what a mention may add included, held to the
 * window (`withinWindow`).
 */
const replayFitterOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  from: StartFrom,
  choice: ModelChoice,
  summaryModel: SummaryModelOf | undefined,
  files: readonly AgentAttachment[],
): Effect.fn.Return<ReplayFitter, never, DatabaseServices | ModelCatalog> {
  const catalog = yield* ModelCatalog;
  const offered = yield* catalog.read.pipe(Effect.orElseSucceed(() => []));
  const windowTokens = contextWindowOf(
    offered,
    choice.model,
    choice.contextWindow ?? CONTEXT_WINDOW.LONG,
  );
  const lowest = offered.find((model) => model.id === choice.model)?.efforts[0] ?? choice.effort;
  const measured = yield* measuredStepOf(userId, from.lineage);
  // Note that a native harness's step estimates no instructions (`runner-events-app.ts`), since
  // the CLI composes its own, so it is told the fallback as a source that measured none is.
  const estimated =
    measured === undefined
      ? 0
      : measured.step.systemPromptTokens + measured.step.toolDefinitionTokens;
  const instructions =
    estimated === 0 ? REPLAY_FIT.INSTRUCTIONS_FALLBACK_TOKENS : fromEveEstimate(estimated);
  const bound = measuredBoundBytes(
    measured === undefined
      ? undefined
      : { inputTokens: measured.step.inputTokens, compacted: measured.compacted },
    stepsBytes(from.steps) + summaryBytes(from.carriedSummary),
  );
  const model =
    summaryModel === undefined ? undefined : yield* summaryModel(userId, choice, lowest);
  // Note that what a mention adds is written after the replay is fitted, so its bound is held back for it.
  const besideBytes = filesBytes(files) + MENTIONED_BOUNDS.PART_CHARS;
  return {
    prompt: from.prompt,
    fit: (firstMessage) =>
      Effect.gen(function* () {
        const budget = replayBudgetBytes(
          windowTokens,
          instructions,
          utf8Bytes(firstMessage(undefined)) + filesBytes(files),
        );
        const fitted = yield* fitReplay(
          from.steps,
          from.carriedSummary,
          bound === undefined ? budget : Math.min(budget, bound),
          (dropped, earlier) =>
            model === undefined
              ? Effect.succeed(Option.none())
              : summarizeSteps(model, dropped, windowTokens, earlier),
        );
        const promptTokens = (steps: FittedSteps) =>
          instructions +
          replayTokens(
            utf8Bytes(firstMessage(replayOf(from, steps.kept, steps.summary).replay)) + besideBytes,
          );
        const held = withinWindow(fitted, promptTokens, windowTokens);
        if (held !== fitted) {
          yield* Effect.logWarning(
            `a replay was cut to fit the window: ${held.kept.length} of ${fitted.kept.length} steps kept, its summary ${held.summary === undefined ? "left out" : "kept"}`,
          );
        }
        return replayOf(from, held.kept, held.summary);
      }),
  };
});

/** A prompt with the note after it, the words a Start from another agent reads mentions from; none where there is neither. */
function wordsOf(prompt: string | undefined, note: string | undefined): string | undefined {
  const words = [prompt, note].filter((each) => each !== undefined);
  return words.length === 0 ? undefined : words.join("\n\n");
}

/** What a continue's title adds to its source's. */
const CONTINUED_SUFFIX = " (continued)";

/** That suffix, however many times a chain of continues stacked it on a title written by hand. */
const CONTINUED_SUFFIXES = /(?: \(continued\))+$/u;

/**
 * A continue's title from its source's: the source's, with any suffix a
 * continue already gave it taken off and cut to fit, and the suffix after
 * it; none where the source has no title, so the model names the continue.
 */
function continuedTitle(source: string | null): string | undefined {
  const base = (source ?? "").replace(CONTINUED_SUFFIXES, "").trim();
  if (base === "") return undefined;
  const room = AGENT_BOUNDS.MAX_TITLE_CHARS - CONTINUED_SUFFIX.length;
  let kept = "";
  // Note that the title is cut by code point, so a cut never leaves half of a character.
  for (const char of base) {
    if (kept.length + char.length > room) break;
    kept += char;
  }
  return `${kept.trimEnd()}${CONTINUED_SUFFIX}`;
}

/**
 * The source of a continue stopped as a Stop stops it, over the eve the
 * Start reached: a turn it still runs cancelled and stamped, and nothing
 * where it runs none or a Stop already stands on it. Its sandbox is
 * stopped by its own turn's end, as a Stop leaves it. Answers whether the
 * stop held, false where the source could not be stopped, which is logged,
 * since the new agent stands either way.
 */
const stoppedSource = (
  eve: Effect.Effect<
    AgentSessions<EveTypedTurn>,
    HostedRefusal,
    HttpClient.HttpClient | DatabaseServices
  >,
  source: Agent,
  /** The coding agent whose `start_agent` continues the source; none for a member's Continue. */
  by: string | undefined,
) =>
  cancelledTurn(
    eve,
    storeWriter({ tools: CODER_TOOL_SET }),
    source,
    by === undefined ? {} : { by },
  ).pipe(
    Effect.as(true),
    Effect.catch((refusal) =>
      Effect.as(
        Effect.logWarning(`the agent a continue took over from was not stopped: ${refusal.error}`),
        false,
      ),
    ),
  );

/**
 * The pilot a continue took over from archived once it is stopped, by the
 * coding agent whose `start_agent` continued it or else by the member, and
 * the transaction it was archived in; none where it was not, which is
 * logged, since the new pilot stands either way.
 */
const archivedPilot = (userId: string, pilot: Agent, by: Agent | undefined) => {
  const archiver: StoredArchive =
    by === undefined
      ? { by: AGENT_ARCHIVER.MEMBER, userId }
      : { by: AGENT_ARCHIVER.AGENT, userId, agentId: by.id, agentName: agentName(by) };
  return archiveAgentCommitted(userId, pilot.id, true, archiver).pipe(
    Effect.map(Option.flatMap(({ txid }) => Option.fromNullishOr(txid))),
    Effect.catch((failure) => Effect.as(logStoreFailure(failure), Option.none<string>())),
  );
};

/**
 * Whether an open's refusal is a named outcome the developer is told as
 * such, which is logged and never reported: the plan or the key refused, the
 * device removed or away, or the image still being prepared.
 */
function namedOpenRefusal(failed: EveFailed): boolean {
  return (
    failed.planRefusal !== undefined ||
    failed.keyRefusal !== undefined ||
    (failed.runtimeRefusal !== undefined && failed.runtimeRefusal !== RUNTIME_REFUSAL.NOT_HERE)
  );
}

/**
 * The agent a Start made discarded because its session never opened, so a
 * retry under the same key starts it afresh and no agent stands to read as
 * never started: why said once as an error and reported
 * (`agentFailureSaid`), in the caller's scope, which names the agent; a
 * discard that fails is logged.
 */
const discardedAt = (userId: string, agent: Agent, said: string, reason: string) =>
  Effect.andThen(
    agentFailureSaid(said, reason, true),
    Effect.ignore(hostedStoreOrUnavailable(discardAgent(userId, agent.id))),
  );

/**
 * The pilot a continue keeps as its starter: the one that started its
 * source, where that is a pilot, so a continued sub-pilot still reports up
 * to its parent; none for a source no pilot started.
 */
const pilotStarterOf = (userId: string, source: Agent) =>
  source.startedByAgentId === null
    ? Effect.succeed(undefined)
    : Effect.map(hostedStoreOrUnavailable(readAgent(userId, source.startedByAgentId)), (starter) =>
        Option.isSome(starter) && starter.value.kind === AGENT_KIND.PILOT
          ? starter.value.id
          : undefined,
      );

/** The place an agent stands in, which a Start from it puts the new agent in: its task, or its workspace and repository where it has none; none for an agent with neither, which no checkout could go on from. */
export function placeOfAgent(
  agent: Pick<Agent, "taskId" | "organizationId" | "repository">,
): StartWhere | undefined {
  if (agent.taskId !== null) return { taskId: agent.taskId };
  if (agent.repository === null) return undefined;
  return { taskId: null, organizationId: agent.organizationId, repository: agent.repository };
}

/** The place alone, as a Start from another agent reads its source against it. */
function whereOf(place: StartWhere): StartWhere {
  if (place.taskId !== null) return { taskId: place.taskId };
  return place.repository === null
    ? { taskId: null, organizationId: place.organizationId, repository: null }
    : { taskId: null, organizationId: place.organizationId, repository: place.repository };
}

/** Whether an agent a retry found under its key stands in the place asked, and the account still reaches that place. */
const madeInPlace = Effect.fnUntraced(function* (
  userId: string,
  made: Agent,
  place: StartWhere,
): Effect.fn.Return<boolean, HostedRefusal, DatabaseServices> {
  if (made.taskId !== place.taskId) return false;
  if (place.taskId !== null) {
    return Option.isSome(yield* hostedStoreOrUnavailable(readTaskWorkspace(userId, place.taskId)));
  }
  if (made.organizationId !== place.organizationId) return false;
  return yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, place.organizationId));
});

/**
 * The agent a Start from `from`, its source and the message it forks at
 * where it names one, under `idempotencyKey` already made,
 * where it stands in the place asked, or, with none asked, the one it stands
 * in, and the account still reaches that place; none otherwise. Note that it
 * reads the source not at all, because a retry is answered with the agent
 * its key made though the source may be gone since: every Start from an
 * agent asks this first, by its task or by the source's own path.
 */
export const startedFromBefore = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  idempotencyKey: string,
  from: Pick<AgentStartFrom, "agentId" | "messageId">,
  place: StartWhere | undefined,
): Effect.fn.Return<Option.Option<Agent>, HostedRefusal, DatabaseServices> {
  const made = yield* hostedStoreOrUnavailable(readAgentByKey(userId, idempotencyKey));
  // Note that only the same Start is answered: the same source, forked at the same message or continued.
  const startedFrom = Option.isSome(made) ? made.value.startedFrom : null;
  if (
    Option.isNone(made) ||
    startedFrom?.agentId !== from.agentId ||
    startedFrom.messageId !== from.messageId
  ) {
    return Option.none();
  }
  const where = place ?? placeOfAgent(made.value);
  if (where === undefined || !(yield* madeInPlace(userId, made.value, where))) {
    return Option.none();
  }
  return made;
});

/**
 * Whether a Start of the account's on the model would find a credential to
 * pay for it, refused by name where none does, as the Start itself would be
 * (`agentRuntimeChoice`): what a caller checks before it undoes anything a
 * refused Start could not put back, as an operator's Reset archives its
 * standing operator.
 */
export const startCredentialStands = (userId: string, model: string) =>
  Effect.asVoid(
    Effect.catch(agentRuntimeChoice(userId, model), (failure) =>
      failure instanceof AgentCredentialMissing
        ? Effect.fail(credentialMissing(failure.provider))
        : hostedStoreOrUnavailable(Effect.fail(failure)),
    ),
  );

/**
 * The runtime a new agent's conversation is recorded on, with its payer,
 * by the account's routing (`agentRuntimeChoice`): the credential Settings
 * chose, or for a local agent its Mac's own login where it has one
 * (`localAgentRuntimeChoice`), a blank Start, a continue and a fork alike.
 * Where no credential of
 * the account's pays, the Start is refused by name, the provider beside
 * it, and nothing is written.
 */
function startRuntimeOf(
  userId: string,
  model: string,
  keys: AccountKeyRows,
  asked: {
    readonly machine?: AgentMachineKind | undefined;
    readonly deviceId?: string | undefined;
  },
) {
  const chosen =
    asked.machine === AGENT_MACHINE.DEVICE
      ? localAgentRuntimeChoice(userId, model, asked.deviceId, keys)
      : agentRuntimeChoice(userId, model, keys);
  return Effect.catch(chosen, (failure) =>
    failure instanceof AgentCredentialMissing
      ? Effect.fail(credentialMissing(failure.provider))
      : hostedStoreOrUnavailable(Effect.fail(failure)),
  );
}

/**
 * Where a new agent runs (`agentMachineChoice`): a sandbox, or the starter's
 * Mac the Start names where it is one Start offers them; refused by name
 * where it is not, and nothing is written.
 */
function startMachineOf(
  userId: string,
  asked: {
    readonly machine?: AgentMachineKind | undefined;
    readonly deviceId?: string | undefined;
  },
  runtime: ConversationRuntime,
) {
  return Effect.catch(agentMachineChoice(userId, asked, runtime), (failure) =>
    failure instanceof LocalAgentRefused
      ? Effect.fail(localAgentRefused(failure.reason))
      : hostedStoreOrUnavailable(Effect.fail(failure)),
  );
}

/**
 * Who a Start's first line names as its sender and what it says it is: an
 * automation's run says its prompt as the automation, as its later lines do
 * (`automation-runs.ts`); any other Start's is its brief, sent by the agent
 * whose `start_agent` asked, or else by the member who started it.
 */
function openingOf(
  agent: Agent,
  ask: Pick<StartAsk, "automationOrigin" | "startedBy">,
  brief: { readonly prompt: string | null },
  /** The agent it takes over from, continued or forked; none for a fresh Start. */
  taken: { readonly source: Agent; readonly continued: boolean } | undefined,
): { readonly sender: LineSender; readonly metadata: AwaitingLineMetadata } {
  const { automationOrigin, startedBy } = ask;
  if (automationOrigin !== undefined) {
    return {
      sender: { kind: MESSAGE_SENDER.AUTOMATION, name: automationOrigin.name },
      metadata: automationLineMetadata(automationOrigin.firing),
    };
  }
  const sender: LineSender =
    startedBy === undefined
      ? { kind: MESSAGE_SENDER.MEMBER, userId: agent.userId }
      : agentLineSender(startedBy);
  const metadata: AwaitingLineMetadata =
    taken === undefined
      ? {
          channel: MESSAGE_CHANNEL.START,
          brief: brief.prompt === null ? START_LINE_BRIEF.PLAN : START_LINE_BRIEF.PROMPT,
        }
      : {
          channel: MESSAGE_CHANNEL.START,
          brief: taken.continued ? START_LINE_BRIEF.CONTINUE : START_LINE_BRIEF.FORK,
          source_agent_id: taken.source.id,
        };
  return { sender, metadata };
}

/**
 * The first message of a Start, written as the line awaiting its turn under
 * a fresh key, as a steer's is (`steer.ts`), and its line id, which a native
 * runner is handed and names back as it takes the line, and eve's receipt
 * takes by its words. Its
 * dispatch has already happened by the time it matters: the line is written
 * standing, and the Start's own open is what hands it over.
 */
const openingLine = (
  agent: Agent,
  text: string,
  files: readonly HandedFile[],
  mentioned: string | undefined,
  opened: { readonly sender: LineSender; readonly metadata: AwaitingLineMetadata },
) =>
  Effect.gen(function* () {
    const clientKey = randomUUID();
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const written = yield* hostedStoreOrUnavailable(
      writer.writeAwaitingLine(
        { userId: agent.userId, conversationId: agent.conversationId },
        {
          text,
          clientKey,
          attachments: files,
          mentioned,
          ...opened,
        },
        Effect.succeed(true),
      ),
    );
    // A line refused, or one the store never landed, is no line the runner could name back.
    if (Result.isFailure(written) || Option.isNone(written.success)) {
      return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    }
    return sentLineId(clientKey);
  });

/** Where a Start's agent runs, as `machineOfStart` decides it: the machine and device it asks the runtime and machine choices for. */
interface StartMachine {
  readonly asked: { readonly machine: AgentMachineKind; readonly deviceId?: string | undefined };
}

/** A Start's agent in a sandbox, the one place that needs no device. */
const IN_THE_CLOUD: StartMachine = { asked: { machine: AGENT_MACHINE.VERCEL } };

/**
 * Where a new agent runs, one rule for every Start: where the agent it is
 * started from runs, for a continue or a fork, `start_agent` from another
 * agent among them, so a local agent goes on locally; else where its task
 * runs (`task.runsOn`); else, with no task, as the member's operator and
 * an agent with no plan are, in the cloud. The starter is the account the
 * Start is made for: a member's own, the calling agent's starter for
 * `start_agent`, and the automation's owner for an automation's run. A
 * device runs only its owner's agents, so a Start by anyone else is
 * refused as `not-owner`, naming the device and whose it is; a device whose
 * row is gone is refused as away, a host its starter removed is refused by
 * name, and one that is the starter's goes on to the runtime and machine choices,
 * which refuse it by name where it is away, the experiment is off, or it
 * runs no harness for the model. Nothing falls back to the cloud on its own.
 */
const machineOfStart = Effect.fnUntraced(function* (
  userId: string,
  source: Agent | undefined,
  task: Task | undefined,
): Effect.fn.Return<StartMachine, HostedRefusal, DatabaseServices> {
  const fromSource = source !== undefined;
  const machine = fromSource
    ? (source.machine ?? AGENT_MACHINE.VERCEL)
    : (task?.runsOn?.machine ?? AGENT_MACHINE.VERCEL);
  if (machine === AGENT_MACHINE.VERCEL) return IN_THE_CLOUD;
  const deviceId = fromSource ? source.deviceId : task?.runsOn?.deviceId;
  const device =
    deviceId === null || deviceId === undefined
      ? undefined
      : (yield* hostedStoreOrUnavailable(devicesNamed([deviceId]))).get(deviceId);
  if (device === undefined) {
    return yield* Effect.fail(localAgentRefused(LOCAL_AGENT_REFUSAL.MAC_AWAY));
  }
  if (device.userId !== userId) {
    const owner = (yield* hostedStoreOrUnavailable(readAccountNames([device.userId]))).get(
      device.userId,
    );
    return yield* Effect.fail(
      localAgentRefused(LOCAL_AGENT_REFUSAL.NOT_OWNER, {
        name: device.name,
        ...(owner === undefined ? undefined : { owner }),
      }),
    );
  }
  if (yield* hostedStoreOrUnavailable(hostRemoved(userId, device.id))) {
    return yield* Effect.fail(HOSTED_REFUSAL.DEVICE_REMOVED);
  }
  return { asked: { machine: AGENT_MACHINE.DEVICE, deviceId: device.id } };
});

/** Starts the account's agent on the task or in the workspace, as above; eve is composed only once a new agent needs its session opened, so a retry that found its agent asks for none. */
export const startAgent = /* @__PURE__ */ Effect.fn("web/startAgent")(function* (
  eve: Effect.Effect<
    AgentSessions<EveTypedTurn>,
    HostedRefusal,
    HttpClient.HttpClient | DatabaseServices
  >,
  userId: string,
  ask: StartAsk,
): Effect.fn.Return<AgentStarted, HostedRefusal | ModelChoiceRefused, StartServices> {
  // Note that a fresh Start's retry is answered with the agent its key made before where it runs is
  // decided, because its task may run elsewhere since, or its device be away, and the agent stands.
  if (ask.from === undefined) {
    const made = yield* hostedStoreOrUnavailable(readAgentByKey(userId, ask.idempotencyKey));
    if (Option.isSome(made) && (yield* madeInPlace(userId, made.value, whereOf(ask)))) {
      return { agent: made.value, created: false };
    }
  }
  // Note that a retry from another agent is answered before its source is read, because the source
  // may be gone since the first Start made the agent its key names.
  if (ask.from !== undefined) {
    const made = yield* startedFromBefore(userId, ask.idempotencyKey, ask.from, ask);
    if (Option.isSome(made)) return { agent: made.value, created: false };
    // A key that already names the agent of another Start is refused, never answered with that agent.
    const other = yield* hostedStoreOrUnavailable(readAgentByKey(userId, ask.idempotencyKey));
    if (Option.isSome(other)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  // A source is read against the place asked, and one that is not of it is refused, never dropped.
  const from =
    ask.from === undefined
      ? undefined
      : yield* startFromOf(
          userId,
          whereOf(ask),
          ask.from,
          ask.attachments ?? [],
          ask.idempotencyKey,
        );
  // A continue stops its source, so a source its starter's plan pays for is continued by those the
  // plan's policy admits; a fork leaves its source running and runs on the forker's own payer.
  if (from !== undefined && from.told.messageId === undefined) {
    yield* admitsPlanWriter(userId, from.source);
  }
  // An agent started from another runs on that agent's choice unless the Start names one.
  const accepted = acceptedChoiceRead(userId, ask.choice ?? from?.choice);
  // A fresh Start's landing does not wait on its choice, so the two are read together; one from
  // another agent fits that agent's replay to the choice's window, so its landing waits on it.
  const [{ choice, keys }, landing] =
    from === undefined
      ? yield* bothInOrder(accepted, landingOf(userId, ask, undefined, undefined, ask.landed))
      : yield* Effect.flatMap(accepted, (read) =>
          Effect.gen(function* () {
            const fitter = yield* replayFitterOf(userId, from, read.choice, ask.summaryModel, [
              ...from.attachments,
              ...(ask.attachments ?? []),
            ]);
            // The note's files go after the source's in each group eve is handed, so the marker counts them by group.
            const noteFiles = noteFilesOf(ask.attachments ?? []);
            return [read, yield* landingOf(userId, ask, fitter, noteFiles, ask.landed)] as const;
          }),
        );
  // An automation's agent reaches through the workspace's installation alone; a Start by hand, on the starter's token too.
  // A blank agent on a task with no repository reaches none.
  // Note that a task started with its agent reached the repository a moment ago, in the same
  // request and as the same member, so that reach stands rather than a second round of GitHub reads.
  const member = ask.automationOrigin === undefined ? userId : undefined;
  const reach: Effect.Effect<
    { readonly access: GitHubAccess } | undefined,
    HostedRefusal,
    StartServices
  > =
    landing.repository === null
      ? Effect.succeed(undefined)
      : ask.reached !== undefined && ask.reached.repository === landing.repository
        ? Effect.succeed(ask.reached)
        : workspaceRepository(landing.workspaceId, landing.repository, member, landing.mover);
  // An agent started from another goes on from the branch that one was started on.
  const branchOf = startBranchOf(userId, ask, from?.source.startBranch ?? null, landing, member);
  const brief = landing.place;
  // The words a mention is read from: the prompt with any note after it, or a plan start's note
  // alone; never the replay of another agent, whose words name what it read, not what to hand on.
  const words = from === undefined ? (brief.prompt ?? ask.note) : wordsOf(from.prompt, ask.note);
  // Note that an automation's run names its own prompt, because the words an outsider wrote beside it
  // switch on nothing, and so does an agent started from one, with the developer's note after it.
  const serverWords =
    ask.serverWords ??
    (from === undefined ? words : wordsOf(from.serverWords ?? from.prompt, ask.note));
  // The files of the source's brief that fit, then those the note carries; a fresh start's are its own,
  // a prompt's or, on the plan, the note's, such as the pictures `start_agent` hands on.
  const attachments =
    from === undefined
      ? (ask.attachments ?? [])
      : [...from.attachments, ...(ask.attachments ?? [])];
  // What the words mention of the plan's pages and agents is read before the agent is made, so a
  // read that fails leaves no agent its retry would find and never open a session for.
  const mentions =
    words === undefined
      ? Effect.succeed(undefined)
      : hostedStoreOrUnavailable(
          readMentioned(userId, words, {
            task: landing.task,
            workspaceId: landing.workspaceId,
          }),
        );
  // GitHub's answers and the store's reads of the mentions wait on none of each other, so they are asked together.
  const [[reached, branch], reads] = yield* bothInOrder(bothInOrder(reach, branchOf), mentions);
  // A continue is named after its source where the ask names nothing; a fork is named as it starts.
  const continued = from !== undefined && from.told.messageId === undefined;
  const title = ask.title ?? (continued ? continuedTitle(from.source.title) : undefined);
  // A continue of a pilot is a pilot, which takes over the agents its source started.
  const takesOver = continued && from.source.kind === AGENT_KIND.PILOT ? from.source : undefined;
  const place =
    takesOver !== undefined && brief.taskId !== null ? { ...brief, kind: AGENT_KIND.PILOT } : brief;
  // A member's continue of an agent a pilot started reports to that pilot; an agent's reports to
  // the agent that asks, whom its note names.
  const pilotStarter =
    continued && ask.startedBy === undefined
      ? yield* pilotStarterOf(userId, from.source)
      : undefined;
  // Where it runs, the runtime, and the payer are decided as the agent is made, by the starter's account, its source or task, and its model, and never change.
  const where = yield* machineOfStart(userId, from?.source, landing.task);
  const runtime = yield* startRuntimeOf(userId, choice.model, keys, where.asked);
  const placed = yield* startMachineOf(userId, where.asked, runtime.runtime);
  const started = yield* hostedStoreOrUnavailable(
    createAgent(userId, {
      ...place,
      automationId: ask.automationId,
      automationOrigin: ask.automationOrigin,
      automationRunId: ask.automationRunId,
      startedFrom: landing.startedFrom,
      startedByAgentId: ask.startedBy?.id ?? pilotStarter,
      takesOverFrom: takesOver?.id,
      title,
      idempotencyKey: ask.idempotencyKey,
      model: choice.model,
      effort: choice.effort,
      contextWindow: choice.contextWindow,
      repository: landing.repository,
      runtime: runtime.runtime,
      payer: runtime.payer,
      machine: placed.machine,
      deviceId: placed.deviceId,
      githubAccess: reached?.access,
      startBranch: branch,
      disabledServers: ask.disabledServers ?? from?.disabledServers,
      // The servers those words mention are its first turn's, whatever the switches say.
      mentionedServers:
        serverWords === undefined ? [] : mentionedServers(serverWords, landing.repository),
    }),
  );
  if (Option.isNone(started)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { agent, created, txid } = started.value;
  if (!created) return { agent, created };
  // The session opens with the plan or the prompt as its first message; an eve that did not take
  // it leaves no agent behind, so the retry under the same key starts afresh. A blank agent opens
  // none: its first words open its session as they reach it (`steer.ts`).
  const handed = brief.prompt ?? brief.planSnapshot;
  if (handed !== null) {
    // Every line the opening says names the agent, the runtime's own past the answer included. Note
    // that the agent stands from here, so an opening cut short before eve was asked, as a caller's
    // deadline cuts a `start_agent`, discards it as a refused one does, in a finalizer the
    // interruption cannot cut short, and says so, rather than leaving an agent no session was opened
    // for. One cut short while eve was asked is said alone, since its session may have opened, a
    // native launch handed on past the answer, and the agent is that session's.
    let asked = false;
    const opened = yield* Effect.gen(function* () {
      const sessions = yield* eve.pipe(
        Effect.tapError((refusal) =>
          discardedAt(
            userId,
            agent,
            `eve could not be reached to start a coding agent: ${refusal.error}`,
            refusal.error,
          ),
        ),
      );
      // Each image is kept beside the new agent's conversation first, so the agent is told its id; one the
      // store could not keep goes unnamed, as before, rather than failing a Start whose agent already stands.
      const files = yield* keptHandedImages(
        { userId: agent.userId, conversationId: agent.conversationId },
        attachments,
      ).pipe(Effect.catch((failure) => Effect.as(logStoreFailure(failure), attachments)));
      const mentioned =
        words === undefined ? undefined : mentionedContext(words, landing.task, reads);
      // The first message is written here, awaiting its turn, on every runtime, so it says what it is and
      // who sent it: a native harness's runner names the line back as it takes it (`native-events/`), and
      // eve's receipt takes it by its words (`relay.ts`'s `#received`) rather than writing a typed line.
      // A launch refused discards the agent, line and all. A line that could not be written discards the
      // agent, as a refused launch does, so a retry under the same key starts it afresh rather than
      // finding an agent that was never launched.
      const line = yield* openingLine(
        agent,
        handed,
        files,
        mentioned,
        openingOf(
          agent,
          ask,
          brief,
          from === undefined ? undefined : { source: from.source, continued },
        ),
      ).pipe(
        Effect.tapError((refusal) =>
          discardedAt(
            userId,
            agent,
            `a Start's first line was not written: ${refusal.error}`,
            refusal.error,
          ),
        ),
      );
      // The runtime says why an open it refused was refused; eve that could not be asked is said here.
      asked = true;
      return yield* sessions
        .open({
          conversationId: agent.conversationId,
          turn: EVE_HOST_TURN.TYPED,
          message: eveContent(handed, files, mentioned),
          lineId: line,
        })
        .pipe(
          Effect.catchTag("EveUnreachable", (failure) =>
            Effect.as(
              agentFailureSaid(
                `eve could not be reached to start a coding agent: ${describeUnreachable(failure)}`,
                failure._tag,
                true,
              ),
              undefined,
            ),
          ),
        );
    }).pipe(
      Effect.onError((cause) =>
        Cause.hasFails(cause)
          ? Effect.void
          : asked
            ? agentFailureSaid(
                `a Start was cut short while its agent's session was opening: ${causeKind(cause)}`,
                causeKind(cause),
                true,
              )
            : discardedAt(
                userId,
                agent,
                `a Start was cut short before its agent's session opened: ${causeKind(cause)}`,
                causeKind(cause),
              ),
      ),
      Effect.annotateLogs(agentLogIds(agent)),
    );
    if (opened === undefined || opened.outcome !== EVE_SEND_OUTCOME.ACCEPTED) {
      // An image still being prepared is answered by name, so the Start is made again under its key.
      const refusal = opened === undefined ? HOSTED_REFUSAL.UNAVAILABLE : failedCallRefusal(opened);
      // A native harness says why it refused where its harness decided it (`runner-sessions.ts`), so
      // eve's refusal, and a harness this function cannot reach, are said here.
      if (
        opened !== undefined &&
        (!isNativeRuntime(runtime.runtime) || opened.runtimeRefusal === RUNTIME_REFUSAL.NOT_HERE)
      ) {
        yield* agentFailureSaid(
          `a Start's open was refused: ${refusal.error}, status ${opened.status}`,
          refusal.error,
          !namedOpenRefusal(opened),
        ).pipe(Effect.annotateLogs(agentLogIds(agent)));
      }
      yield* hostedStoreOrUnavailable(discardAgent(userId, agent.id)).pipe(
        Effect.annotateLogs(agentLogIds(agent)),
      );
      return yield* Effect.fail(refusal);
    }
    yield* Effect.logInfo("a Start opened its agent's session").pipe(
      Effect.annotateLogs(agentLogIds(agent)),
    );
  }
  // The work goes on in the continue, so its source stops; a fork's source goes on beside it.
  const stopped = continued ? yield* stoppedSource(eve, from.source, ask.startedBy?.id) : false;
  // Work on the task has begun, so one in the backlog or to do moves into progress, and one
  // further along stands; a move that fails is logged, never the Start's failure. A blank agent
  // was handed no work, so its task stands where it is.
  // The Start answers the last transaction it committed in, which Realtime delivers after every
  // one before it, so a client waiting on it sees the agent and its task's standing alike.
  let committed = txid;
  // The pilot taken over leaves the task's agents once stopped, its work going on in the new one;
  // one eve would not stop still runs, so it stands where its messages still reach it.
  if (takesOver !== undefined && stopped) {
    const archived = yield* archivedPilot(userId, takesOver, ask.startedBy);
    if (Option.isSome(archived)) committed = archived.value;
  }
  if (landing.task !== undefined) {
    if (handed !== null) {
      const begun = yield* beginTaskWorkCommitted(userId, landing.task.id).pipe(
        Effect.catch((failure) => Effect.as(logStoreFailure(failure), Option.none())),
      );
      if (Option.isSome(begun)) committed = begun.value.txid;
    }
    // Its starter is on a task no one was, where they started it by hand, a blank agent among them;
    // an automation's run assigns no one.
    if (ask.automationOrigin === undefined) {
      const assigned = yield* assignUnassignedTaskCommitted(userId, landing.task.id).pipe(
        Effect.catch((failure) => Effect.as(logStoreFailure(failure), Option.none())),
      );
      if (Option.isSome(assigned)) committed = assigned.value.txid;
    }
  }
  yield* recordServerEvent(SERVER_EVENT.AGENT_START, userId, {
    model: choice.model,
    effort: choice.effort,
    start_kind:
      from === undefined
        ? SERVER_AGENT_START_KIND.FRESH
        : continued
          ? SERVER_AGENT_START_KIND.CONTINUE
          : SERVER_AGENT_START_KIND.FORK,
    is_from_automation: automationRun(ask) !== undefined,
    has_task: ask.taskId !== null,
    agent_kind: agent.kind,
  });
  return committed === undefined ? { agent, created } : { agent, created, txid: committed };
});

/** A Start as a request reached the service, answered: the agent's summary, and whether this request made it or found it under its key. */
export interface RequestedStart {
  readonly agent: AgentSummary;
  readonly created: boolean;
  /** The transaction the agent's row was written in, where this request wrote it. */
  readonly txid?: string;
}

/**
 * The account's agent started on the task, or in the workspace with no
 * task, as a request asks it, through `startAgent`: the agent's own
 * Start (`POST /api/plans/{id}/agents`), a Start from an agent in its own
 * place (`POST /api/agents/{id}/agents`), and a task's start that names an
 * agent (`POST /api/plans`) all take it, so they refuse and answer alike.
 * A choice is one thing, so a model
 * without its effort, the reverse, or a window without a model is refused
 * as invalid, as is a choice the catalog refuses; an empty note is none,
 * its files carrying it alone. A new agent's summary is read as it was just
 * made, with no turn; one a retry found under its key, as it stands now.
 */
/**
 * The choice a Start request names, or none: a model without its effort,
 * the reverse, or a window without a model is refused as invalid, since a
 * choice is one thing. Every requested Start reads it before anything
 * else, a retry included, so a request refused once is refused every time.
 */
export const requestedChoice = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Pick<AgentStartRequest, "model" | "effort" | "contextWindow">,
): Effect.fn.Return<ModelChoice | undefined, HostedRefusal> {
  const { model, effort, contextWindow } = request;
  if (
    (model === undefined) !== (effort === undefined) ||
    (contextWindow !== undefined && model === undefined)
  ) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  return model !== undefined && effort !== undefined
    ? { model, effort, ...(contextWindow === undefined ? undefined : { contextWindow }) }
    : undefined;
});

export const startRequestedAgent = /* @__PURE__ */ Effect.fnUntraced(function* (
  eve: Effect.Effect<
    AgentSessions<EveTypedTurn>,
    HostedRefusal,
    HttpClient.HttpClient | DatabaseServices
  >,
  userId: string,
  where: StartWhere,
  request: AgentStartRequest,
  summaryModel?: SummaryModelOf,
  reached?: StartReach,
  landed?: StoredTask,
): Effect.fn.Return<RequestedStart, HostedRefusal, StartServices> {
  const { note } = request;
  const choice = yield* requestedChoice(request);
  const { agent, created, txid } = yield* startAgent(eve, userId, {
    ...whereOf(where),
    idempotencyKey: request.idempotencyKey,
    choice,
    prompt: request.prompt,
    attachments: request.attachments,
    disabledServers: request.disabledServers,
    from: request.from,
    note: note === "" ? undefined : note,
    blank: request.blank,
    call: request.call,
    summaryModel,
    reached,
    landed,
  }).pipe(Effect.catchTag("ModelChoiceRefused", () => Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)));
  if (!created) return { agent: yield* summaryOf(userId, agent), created };
  const [names, runtimes, macs] = yield* hostedStoreOrUnavailable(
    Effect.all(
      [
        readAccountNames(summaryAccounts(agent)),
        nativeRuntimesOfReached([agent.conversationId]),
        devicesNamed(summaryDevices([agent])),
      ],
      { concurrency: 3 },
    ),
  );
  return {
    agent: agentSummary(
      agent,
      {
        turn: undefined,
        awaitingLineAt: undefined,
        runtime: runtimes.get(agent.conversationId),
      },
      yield* Clock.currentTimeMillis,
      names,
      [],
      macs,
    ),
    created,
    ...(txid === undefined ? undefined : { txid }),
  };
});
