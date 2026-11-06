import { randomUUID } from "node:crypto";
import { type DatabaseServices, READ_CONCURRENCY } from "@repo/database/core/query";
import { accountExperimentOn, readAccountPreferences } from "@repo/database/models/account-store";
import { agentOwnerFactsOf } from "@repo/database/models/agent-owners";
import { readAgentRepositories } from "@repo/database/models/agent-repositories";
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
  readNewestAgentPlace,
  taskPilotStands,
} from "@repo/database/models/agent-store";
import type { HandedFile } from "@repo/database/models/attached-file-parts";
import { devicesNamed } from "@repo/database/models/device-store";
import { hostRemoved } from "@repo/database/models/host-store";
import { listAccountProviderKeyRows } from "@repo/database/models/provider-key-store";
import { keepRunsOnPick, readRunsOnPick } from "@repo/database/models/runs-on-pick";
import {
  assignUnassignedTaskCommitted,
  beginTaskWorkCommitted,
  readTask,
  readTaskWorkspace,
  type StoredTask,
} from "@repo/database/models/task-store";
import { isWorkspaceMember, readAccountNames } from "@repo/database/models/workspace-store";
import {
  type AwaitingLineMetadata,
  automationLineMetadata,
  type LineSender,
  storeWriter,
} from "@repo/database/models/writer";
import type {
  StoredArchive,
  StoredAutomationOrigin,
  StoredStartedFrom,
} from "@repo/database/schemas/agent";
import { MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import {
  firstMessageText,
  type NoteFiles,
  type Replay,
  START_NOTE_HEADING,
  type StartNoteHeading,
  stepsBytes,
  summaryBytes,
} from "@repo/features/agent-replay";
import {
  AGENT_ARCHIVER,
  AGENT_ATTACHMENT_TYPE,
  AGENT_BOUNDS,
  AGENT_KIND,
  AGENT_MACHINE,
  AGENT_SOURCE,
  type AgentAlsoRepository,
  type AgentAttachment,
  type AgentKind,
  type AgentMachineKind,
  type AgentRunsOnRequest,
  type AgentSource,
  type AgentStartFrom,
  type AgentStartRequest,
  type AgentSummary,
  CONTEXT_WINDOW,
  EXTRA_REPOSITORY_REFUSAL,
  LOCAL_AGENT_REFUSAL,
} from "@repo/features/agent-wire";
import type { GitHubAccess } from "@repo/features/github-repositories-wire";
import { agentName, automationRun } from "@repo/features/model-label";
import { agentFallbackChoice, type ModelChoice } from "@repo/features/models-wire";
import { descriptionMarkdown } from "@repo/features/description-markdown";
import { TASK_MODE, type Task } from "@repo/features/task-wire";
import { bothInOrder, causeKind, failureKind } from "@repo/runtime/effect";
import { EXPERIMENT } from "@repo/settings";
import { MESSAGE_CHANNEL, type SlackLineMetadata, START_LINE_BRIEF } from "@repo/wire";
import { sentLineId } from "@repo/wire/host-ids";
import { Cause, Clock, Effect, Option, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  recordServerEvent,
  SERVER_AGENT_START_FAILURE,
  SERVER_AGENT_START_KIND,
  SERVER_AGENT_STARTER,
  SERVER_EVENT,
  type ServerAgentStarter,
  type ServerAgentStartFailure,
} from "../../events/server-events.js";
import { GitHubApp, REPOSITORY_SET_UNREACHED } from "../../github/github-app.js";
import { githubReachOrRefusal } from "../../github/github-refusal.js";
import { readBranchHead } from "../../github/repository-file.js";
import { workspaceRepository } from "../../github/workspace-repository.js";
import {
  credentialMissing,
  extraRepositoryRefused,
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  localAgentRefused,
  repositoryNotReachable,
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
  type EveTypedTurn,
  RUNTIME_REFUSAL,
} from "../eve-host/eve-sessions.js";
import { MENTIONED_BOUNDS, mentionedContext, mentionedServers } from "../mentioned-context.js";
import { readMentioned } from "../mentioned-reads.js";
import { descriptionsOnFor } from "../descriptions-on.js";
import { agentFailureSaid, agentLogIds } from "./agent-log.js";
import {
  type AccountKeyRows,
  AgentCredentialMissing,
  accountFastOffer,
  agentMachineChoice,
  agentRuntimeChoice,
  LocalAgentRefused,
  markedUnconnected,
} from "./agent-runtime-choice.js";
import { contextWindowOf } from "./context.js";
import type { NativeRuntime } from "./native-runtime.js";
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
import { canceledTurn, summaryOf } from "./stop.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/**
 * start.ts -- an agent started on a task, or in a workspace with no task: the one path a start takes, from New task, an agent's draft, or the terminal picker, from another agent's `start_agent`, or from an automation's run.
 *
 * The model, effort, and context window are the ask's own where it names a
 * model, the account's stored default otherwise, either checked against the
 * catalog, which also
 * refuses a stored default that has since left it; a refused choice is
 * answered as the catalog's own refusal, so the route can say invalid and
 * a caller can say which choices there are. A task that names a
 * repository must name one the account still reaches through our GitHub App, and
 * through its workspace's installation where it has one, read now rather
 * than when the task named it (`packages/service/src/github/workspace-repository.ts`);
 * on a task that names none the agent works in none and asks nothing of GitHub. The
 * agent and its conversation are made under the ask's key, and a retry
 * carrying the same key is the same agent and opens nothing again; a new
 * agent's eve session opens with the task's document as the Markdown Copy
 * would put on the clipboard, or with the ask's prompt in the description's place
 * and the files attached to it, which only a prompt carries; a note the
 * ask carries rides after either under a heading of its own, so what the
 * developer said beyond the description reaches the agent in the same first
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
 * A blank Start, on a task, hands the agent nothing, neither the description nor
 * a prompt, and opens no session: its first words, typed or spoken, open
 * one as they reach it (`steer.ts`), and leaves its task's status where it
 * stands, since no work was handed. It runs on the choice any Start does.
 * A fresh Start on a task worked in pilot mode (`TASK_MODE.PILOT`) where no
 * pilot stands unarchived makes the task's pilot, whoever asks, a member or a
 * coding agent's `start_agent`, which is how a pilot gives a child task its
 * sub-pilot; every later one makes a coder, as every Start on any other task
 * does. A pilot is refused for an account with the Pilot experiment off.
 * A Start with no task names a prompt, and a repository where it works in
 * one; one that names none works in none.
 * A Start may name repositories its agent works in beside its own
 * (`alsoRepositories`), kept after it as the agent's extras
 * (`agent-repositories.ts`), each cloned beside its checkout under one token
 * for them all, and only in the cloud, through the one installation of the
 * App that reaches its own, for a starter with the Several repositories
 * experiment on (`extraRepositoriesOf`); a Start that names none reads and
 * writes exactly what it did before.
 * An eve that did not take the opening leaves no agent behind, so the retry
 * under the same key starts afresh, and so does one that could not be
 * reached, a first line that could not be written, and a Start cut short
 * before eve took it, each said as an error naming the agent (`agent-log.ts`).
 * A choice an ask names runs that one agent and is never kept as the
 * account's default, which only
 * Settings writes. Where the agent runs is the place the ask names, else
 * its source's, else its starter's default (`machineOfStart`); unlike a
 * choice, a place the ask names is kept as the starter's last pick. Who reaches the agent is the caller's: the route holds the developer's
 * own bearer, and a coding agent's tool acts as the
 * deployment for the account; the agent's harness answers the opening, and
 * the cancel that stops a continue's source, either way
 * (`runtime-sessions.ts`).
 */

export type { StartWhere };

/**
 * Where a Start puts the agent and what it is handed: on a plan, handed the
 * description or a prompt in its place, or in a workspace with no plan, on a
 * repository, handed a prompt, since there is no description to hand it; in either,
 * another agent of that place's brief and transcript in the prompt's place
 * where it takes over from one, and a note after any of them.
 */
export type StartPlace = StartWhere & {
  /** The developer's words in the description's place; none for the description, or for a Start from another agent, whose brief stands for them. */
  readonly prompt: string | undefined;
  /** What the developer said for the agent beyond the description or the prompt; none where they said nothing more. */
  readonly note?: string | undefined;
  /** Whose note it is; the developer's unless a coding agent started this one. */
  readonly noteHeading?: StartNoteHeading | undefined;
  /** Another agent of the same place to take over from, handed its brief and its transcript replayed in place of the description or a prompt; none for an agent started afresh. */
  readonly from?: AgentStartFrom | undefined;
  /** Whether the agent is handed nothing, neither the description nor a prompt, its first words coming later; such a Start names no prompt, note, or source. */
  readonly blank?: boolean | undefined;
  /** What the agent is: a coder unless named, or a pilot where a continue of a task's pilot asks for one. */
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
  /** What carried the prompt where something other than the Start did, which the first line says in place of its brief: a member's message to the Slack bot; none for every other Start. */
  readonly carried?: SlackLineMetadata | undefined;
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
  /** Where the agent runs, the cloud or one of the starter's devices; none for where `machineOfStart` defaults it. */
  readonly runsOn?: AgentRunsOnRequest | undefined;
  /** The repositories the agent works in beside its own, each with the branch its checkout is cloned at where one is named; none for an agent in one repository or none. */
  readonly alsoRepositories?: readonly AgentAlsoRepository[] | undefined;
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

/** Where a Start lands, read as the account: the workspace whose installation reads the repository, the repository, none for a blank Start on a task with none, the task where there is one, the account that may move it where that is the account asking, and the store's place for the agent with what it is handed. */
interface StartLanding {
  readonly workspaceId: string;
  readonly repository: string | null;
  readonly task: Task | undefined;
  readonly mover: string | undefined;
  readonly place: AgentPlace;
  /** What the new agent keeps of the agent it was started from; none for one started afresh. */
  readonly startedFrom: StoredStartedFrom | undefined;
}

/** The agent a Start takes over from as its landing reads it: the source's prompt, the new agent's brief in the description's place where it was handed one, and how its replay is fitted to the first message it is written into, which `firstMessage` writes for a replay or none. */
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
export const confirmedBranch = Effect.fnUntraced(function* (
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
 * which GitHub must hold, and which a Start in no repository is refused for
 * naming; else the one the agent it is started from was
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
  // A branch named where there is no repository to clone it from is refused, rather than dropped.
  if (ask.branch !== undefined && landing.repository === null) {
    return yield* Effect.fail(HOSTED_REFUSAL.NO_REPOSITORY);
  }
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

/** The task read as the account, or the workspace the account must be a member of; either refused as naming nothing. On a task the agent is handed its document or the prompt, its brief or name in place of its document where the account has Descriptions off, in a workspace the prompt, with the replay of the agent it takes over from after either where there is one, whose brief stands for the prompt, or nothing for a blank Start on a task. */
const landingOf = Effect.fnUntraced(function* (
  userId: string,
  place: StartPlace,
  fitter: ReplayFitter | undefined,
  noteFiles: NoteFiles | undefined,
  landed: StoredTask | undefined,
): Effect.fn.Return<StartLanding, HostedRefusal, DatabaseServices> {
  const brief = fitter === undefined ? place.prompt : fitter.prompt;
  if (place.taskId === null) {
    const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, place.organizationId));
    if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
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
        descriptionSnapshot: null,
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
      place: { taskId: place.taskId, descriptionSnapshot: null, prompt: null, kind },
    };
  }
  // A starter with Descriptions off hands no description: the task's brief in its place, or else its name.
  const words =
    brief === undefined && !(yield* descriptionsOnFor(userId, kind))
      ? (read.value.brief ?? task.name)
      : brief;
  const handed = yield* handedOf(words ?? descriptionMarkdown(task), place, fitter, noteFiles);
  return {
    startedFrom: handed.startedFrom,
    workspaceId: task.workspaceId,
    repository: task.repository,
    task,
    mover,
    place:
      words === undefined
        ? { taskId: place.taskId, descriptionSnapshot: handed.text, prompt: null, kind }
        : { taskId: place.taskId, descriptionSnapshot: null, prompt: handed.text, kind },
  };
});

/** How many of the note's files are text files, which eve is handed inlined, and how many images and PDFs. */
function noteFilesOf(files: readonly AgentAttachment[]): NoteFiles {
  const text = files.filter((file) => file.mediaType === AGENT_ATTACHMENT_TYPE.TEXT).length;
  return { text, other: files.length - text };
}

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
 * Start reached: a turn it still runs canceled and stamped, and nothing
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
  canceledTurn(
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
 * The agent a Start made discarded because its session never opened, so a
 * retry under the same key starts it afresh and no agent stands to read as
 * never started: why said once as an error and reported
 * (`agentFailureSaid`), in the caller's scope, which names the agent; a
 * discard that fails is logged. The failed Start is counted
 * (`startFailed`) once the agent is discarded.
 */
const discardedAt = (
  userId: string,
  agent: Agent,
  said: string,
  reason: string,
  failed: StartFailed,
) =>
  Effect.andThen(
    agentFailureSaid(said, reason, true),
    Effect.andThen(
      Effect.ignore(hostedStoreOrUnavailable(discardAgent(userId, agent.id))),
      startFailed(userId, agent, failed),
    ),
  );

/** A Start that failed to open its agent's session, counted under the member who made it, in the count's words. */
const startFailed = (userId: string, agent: Agent, { failure, startedBy }: StartFailed) =>
  recordServerEvent(
    SERVER_EVENT.AGENT_START_FAIL,
    { userId, workspaceId: agent.organizationId },
    {
      failure,
      started_by: startedBy,
      agent_kind: agent.kind,
    },
  );

/** Why a Start failed, and who started it, as the count words them. */
interface StartFailed {
  readonly failure: ServerAgentStartFailure;
  readonly startedBy: ServerAgentStarter;
}

/** Who a Start is counted as made by: an agent's `start_agent` names its starter, an automation's run names its run, and a member's Start neither. */
const starterOf = (ask: Pick<StartAsk, "startedBy" | "automationOrigin">) =>
  ask.startedBy !== undefined
    ? SERVER_AGENT_STARTER.AGENT
    : automationRun(ask) !== undefined
      ? SERVER_AGENT_STARTER.AUTOMATION
      : SERVER_AGENT_STARTER.MEMBER;

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

/** The place an agent stands in, which a Start from it puts the new agent in: its task, or, where it has none, its workspace and its repository, or none where it worked in none. */
export function placeOfAgent(
  agent: Pick<Agent, "taskId" | "organizationId" | "repository">,
): StartWhere {
  if (agent.taskId !== null) return { taskId: agent.taskId };
  const { organizationId, repository } = agent;
  return repository === null
    ? { taskId: null, organizationId, repository }
    : { taskId: null, organizationId, repository };
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
  if (!(yield* madeInPlace(userId, made.value, place ?? placeOfAgent(made.value)))) {
    return Option.none();
  }
  return made;
});

/**
 * The runtime a new agent's conversation is recorded on, with its payer,
 * by the account's routing (`agentRuntimeChoice`): the credential Settings
 * chose, a blank Start, a continue and a fork alike.
 * Where no credential of
 * the account's pays, the Start is refused by name, the provider beside
 * it, and nothing is written.
 */
function startRuntimeOf(userId: string, model: string, keys: AccountKeyRows) {
  return Effect.catch(agentRuntimeChoice(userId, model, keys), (failure) =>
    failure instanceof AgentCredentialMissing
      ? Effect.fail(credentialMissing(failure.provider))
      : hostedStoreOrUnavailable(Effect.fail(failure)),
  );
}

/**
 * Where a new agent runs (`agentMachineChoice`): a sandbox, or the starter's
 * Mac the Start names where it is one Start offers them, and one that works
 * in a repository reached on the starter's own token where its host does so
 * on its own GitHub sign-in; refused by name where it is not, and nothing is
 * written.
 */
function startMachineOf(
  userId: string,
  asked: {
    readonly machine?: AgentMachineKind | undefined;
    readonly deviceId?: string | undefined;
  },
  runtime: NativeRuntime,
  githubAccess: GitHubAccess | undefined,
) {
  return Effect.catch(agentMachineChoice(userId, asked, runtime, githubAccess), (failure) =>
    failure instanceof LocalAgentRefused
      ? Effect.fail(localAgentRefused(failure.reason))
      : hostedStoreOrUnavailable(Effect.fail(failure)),
  );
}

/** What outside the app a Start comes from, which the agent's row keeps for a list to mark it by: the Slack message that carried its prompt; none for a Start in the app. */
function sourceOf(carried: SlackLineMetadata | undefined): AgentSource | undefined {
  if (carried === undefined) return undefined;
  return {
    kind: AGENT_SOURCE.SLACK,
    ...(carried.url === undefined ? undefined : { url: carried.url }),
  };
}

/**
 * Who a Start's first line names as its sender and what it says it is: an
 * automation's run says its prompt as the automation, as its later lines do
 * (`automation-runs.ts`); a member's message to the Slack bot says what
 * carried it, sent by that member; any other Start's is its brief, sent by
 * the agent whose `start_agent` asked, or else by the member who started it.
 */
function openingOf(
  agent: Agent,
  ask: Pick<StartAsk, "automationOrigin" | "startedBy" | "carried">,
  brief: { readonly prompt: string | null },
  /** The agent it takes over from, continued or forked; none for a fresh Start. */
  taken: { readonly source: Agent; readonly continued: boolean } | undefined,
): { readonly sender: LineSender; readonly metadata: AwaitingLineMetadata } {
  const { automationOrigin, startedBy, carried } = ask;
  if (automationOrigin !== undefined) {
    return {
      sender: { kind: MESSAGE_SENDER.AUTOMATION, name: automationOrigin.name },
      metadata: automationLineMetadata(automationOrigin.firing),
    };
  }
  if (carried !== undefined) {
    return { sender: { kind: MESSAGE_SENDER.MEMBER, userId: agent.userId }, metadata: carried };
  }
  const sender: LineSender =
    startedBy === undefined
      ? { kind: MESSAGE_SENDER.MEMBER, userId: agent.userId }
      : agentLineSender(startedBy);
  const metadata: AwaitingLineMetadata =
    taken === undefined
      ? {
          channel: MESSAGE_CHANNEL.START,
          brief: brief.prompt === null ? START_LINE_BRIEF.DESCRIPTION : START_LINE_BRIEF.PROMPT,
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

/** A place a Start reads before it is checked: the cloud, or a device by its id, null once that device's row is gone. */
interface PlaceRead {
  readonly machine: AgentMachineKind;
  readonly deviceId?: string | null | undefined;
}

/** A Start's agent in a sandbox, the one place that needs no device. */
const IN_THE_CLOUD: StartMachine = { asked: { machine: AGENT_MACHINE.VERCEL } };

/**
 * Where a Start that names no place and takes over from no agent runs its
 * agent, by its starter's account: where the starter's newest agent on the
 * task runs, never a teammate's, since a device is one member's; else where
 * the starter last named a place (`runs-on-pick.ts`); else the cloud. A
 * task holds no place of its own. Note that an automation's run reads
 * neither of the starter's own and runs in the cloud, because no member is
 * there to have chosen for it, and a Mac its owner last picked may be asleep
 * when the run fires, which would fail the run rather than start it.
 */
const defaultPlaceOf = Effect.fnUntraced(function* (
  userId: string,
  task: Task | undefined,
  automated: boolean,
): Effect.fn.Return<PlaceRead, HostedRefusal, DatabaseServices> {
  if (automated) return { machine: AGENT_MACHINE.VERCEL };
  if (task !== undefined) {
    const newest = yield* hostedStoreOrUnavailable(readNewestAgentPlace(userId, task.id));
    if (Option.isSome(newest)) return newest.value;
  }
  const pick = yield* hostedStoreOrUnavailable(readRunsOnPick(userId));
  return Option.getOrElse(pick, (): PlaceRead => ({ machine: AGENT_MACHINE.VERCEL }));
});

/**
 * Where a new agent runs, one rule for every Start: the place the ask
 * names (`runsOn`), from another agent too, which is how an agent moves;
 * else where the agent it is started from runs, for a continue or a fork,
 * `start_agent` from another agent among them, so a local agent goes on
 * locally; else the starter's default (`defaultPlaceOf`). The starter is
 * the account the Start is made for: a member's own, the calling agent's
 * starter for `start_agent`, and the automation's owner for an automation's
 * run. Whichever decided it, a device runs only its owner's agents, so a
 * Start by anyone else is refused as `not-owner`, naming the device and
 * whose it is; a device whose row is gone is refused as away, a host its
 * starter removed is refused by name, and one that is the starter's goes on
 * to the runtime and machine choices, which refuse it by name where it is
 * away, the experiment is off, or it runs no harness for the model. Nothing
 * falls back to the cloud on its own.
 */
const machineOfStart = Effect.fnUntraced(function* (
  userId: string,
  ask: Pick<StartAsk, "runsOn" | "automationOrigin">,
  source: Agent | undefined,
  task: Task | undefined,
): Effect.fn.Return<StartMachine, HostedRefusal, DatabaseServices> {
  const place: PlaceRead =
    ask.runsOn ??
    (source !== undefined
      ? { machine: source.machine ?? AGENT_MACHINE.VERCEL, deviceId: source.deviceId }
      : yield* defaultPlaceOf(userId, task, ask.automationOrigin !== undefined));
  if (place.machine === AGENT_MACHINE.VERCEL) return IN_THE_CLOUD;
  const { deviceId } = place;
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

/**
 * The place a Start named, kept as its starter's last pick, which a later
 * Start naming none and a task an agent makes for them run at; nothing for
 * a Start that named none. Note that a pick that fails to keep fails
 * nothing, because the agent already stands.
 */
const keptPick = (userId: string, runsOn: AgentRunsOnRequest | undefined) =>
  runsOn === undefined
    ? Effect.void
    : keepRunsOnPick(userId, runsOn).pipe(
        Effect.catch((failure) =>
          Effect.logWarning(`the last Runs on pick could not be kept: ${failure._tag}`),
        ),
      );

/**
 * The repositories a Start names beside its agent's own, as GitHub spells
 * them, each with the branch its checkout is cloned at, read before
 * anything is written; none for a Start that names none, which reads
 * nothing more. They are refused, by why, for a starter with the Several
 * repositories experiment off, for an agent with no repository of its own,
 * and for one that would run on a device; refused as invalid where one is
 * named twice, the agent's own among them; and the agent's own and every
 * extra must be reached through the one installation of the App that
 * reaches the first, so one token reaches them all (`repositorySetReach`),
 * each refused by name where it is reached only on the starter's token or
 * through another installation, and as not reachable, with why, where
 * neither reaches it. A branch named is confirmed on GitHub as the agent's
 * own is. Those a start from another agent carries from it (`inherited`)
 * ask no experiment, since its starter turned it on already, and one whose
 * branch GitHub no longer holds is cloned at its default branch, as the
 * agent's own inherited branch is (`startBranchOf`).
 */
const extraRepositoriesOf = Effect.fnUntraced(function* (
  userId: string,
  named: readonly AgentAlsoRepository[] | undefined,
  landing: Pick<StartLanding, "workspaceId" | "repository">,
  where: StartMachine,
  member: string | undefined,
  inherited: boolean,
): Effect.fn.Return<
  readonly { readonly repository: string; readonly baseBranch: string | undefined }[] | undefined,
  HostedRefusal,
  DatabaseServices | HttpClient.HttpClient | GitHubApp
> {
  if (named === undefined || named.length === 0) return undefined;
  const on =
    inherited ||
    (yield* hostedStoreOrUnavailable(accountExperimentOn(userId, EXPERIMENT.SEVERAL_REPOSITORIES)));
  if (!on)
    return yield* Effect.fail(extraRepositoryRefused(EXTRA_REPOSITORY_REFUSAL.EXPERIMENT_OFF));
  const own = landing.repository;
  if (own === null) {
    return yield* Effect.fail(extraRepositoryRefused(EXTRA_REPOSITORY_REFUSAL.NO_REPOSITORY));
  }
  if (where.asked.machine === AGENT_MACHINE.DEVICE) {
    return yield* Effect.fail(extraRepositoryRefused(EXTRA_REPOSITORY_REFUSAL.DEVICE));
  }
  const every = [own, ...named.map((each) => each.repository)];
  if (new Set(every.map((each) => each.toLowerCase())).size !== every.length) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const app = yield* GitHubApp;
  const reached = yield* githubReachOrRefusal(
    app.repositorySetReach(landing.workspaceId, every, member),
  );
  if (Result.isFailure(reached)) {
    const refused = reached.failure;
    return yield* Effect.fail(
      refused.why === REPOSITORY_SET_UNREACHED.UNREACHED
        ? repositoryNotReachable(refused.unreached)
        : extraRepositoryRefused(
            refused.why === REPOSITORY_SET_UNREACHED.TOKEN
              ? EXTRA_REPOSITORY_REFUSAL.TOKEN
              : EXTRA_REPOSITORY_REFUSAL.OTHER_INSTALLATION,
            refused.repository,
          ),
    );
  }
  const [, ...extras] = reached.success;
  return yield* Effect.forEach(
    named,
    (each, index) =>
      Effect.gen(function* () {
        const repository = extras[index]?.fullName ?? each.repository;
        if (each.branch === undefined) return { repository, baseBranch: undefined };
        const confirmed = confirmedBranch(landing.workspaceId, repository, member, each.branch);
        if (!inherited) return yield* Effect.as(confirmed, { repository, baseBranch: each.branch });
        return yield* confirmed.pipe(
          Effect.as<string | undefined>(each.branch),
          Effect.catch((refusal) =>
            refusal.error === HOSTED_REFUSAL.BRANCH_NOT_FOUND.error
              ? Effect.succeed(undefined)
              : Effect.fail(refusal),
          ),
          Effect.map((baseBranch) => ({ repository, baseBranch })),
        );
      }),
    { concurrency: READ_CONCURRENCY },
  );
});

/**
 * The repositories the source of a start from another agent works in beside
 * its own (`readAgentRepositories`), each at the branch its checkout was
 * cloned at, and with no pull request, which stays the source's; none where
 * it works in one, or where the new agent works in no repository of its own
 * for them to stand beside. One that is the new agent's own is left out.
 */
const carriedExtrasOf = Effect.fnUntraced(function* (
  userId: string,
  source: Agent,
  own: string | null,
): Effect.fn.Return<readonly AgentAlsoRepository[] | undefined, HostedRefusal, DatabaseServices> {
  if (own === null) return undefined;
  const [, ...extras] = yield* hostedStoreOrUnavailable(readAgentRepositories(userId, source.id));
  const carried = extras
    .filter((each) => each.repository.toLowerCase() !== own.toLowerCase())
    .map((each) =>
      each.baseBranch === null
        ? { repository: each.repository }
        : { repository: each.repository, branch: each.baseBranch },
    );
  return carried.length === 0 ? undefined : carried;
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
  const branchOf = startBranchOf(userId, ask, from?.source.startBranch ?? null, landing, member);
  const brief = landing.place;
  // The words a mention is read from: the prompt with any note after it, or a description start's note
  // alone; never the replay of another agent, whose words name what it read, not what to hand on.
  const words = from === undefined ? (brief.prompt ?? ask.note) : wordsOf(from.prompt, ask.note);
  // Note that an automation's run names its own prompt, because the words an outsider wrote beside it
  // switch on nothing, and so does an agent started from one, with the developer's note after it.
  const serverWords =
    ask.serverWords ??
    (from === undefined ? words : wordsOf(from.serverWords ?? from.prompt, ask.note));
  // The files of the source's brief that fit, then those the note carries; a fresh start's are its own,
  // a prompt's or, on the description, the note's, such as the pictures `start_agent` hands on.
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
  // Where it runs, the runtime, and the payer are decided as the agent is made, by the place it names or else its source or its starter's default, and its model, and never change.
  const where = yield* machineOfStart(userId, ask, from?.source, landing.task);
  // A start from another agent works in the repositories its source worked in beside its own, unless it names others.
  const carried =
    ask.alsoRepositories === undefined && from !== undefined
      ? yield* carriedExtrasOf(userId, from.source, landing.repository)
      : undefined;
  const extras = yield* extraRepositoriesOf(
    userId,
    ask.alsoRepositories ?? carried,
    landing,
    where,
    member,
    carried !== undefined,
  );
  const runtime = yield* startRuntimeOf(userId, choice.model, keys);
  const placed = yield* startMachineOf(userId, where.asked, runtime.runtime, reached?.access);
  const started = yield* hostedStoreOrUnavailable(
    createAgent(userId, {
      ...place,
      automationId: ask.automationId,
      automationOrigin: ask.automationOrigin,
      automationRunId: ask.automationRunId,
      startedFrom: landing.startedFrom,
      source: sourceOf(ask.carried),
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
      extraRepositories: extras,
      disabledServers: ask.disabledServers ?? from?.disabledServers,
      // The servers those words mention are its first turn's, whatever the switches say.
      mentionedServers:
        serverWords === undefined ? [] : mentionedServers(serverWords, landing.repository),
    }),
  );
  if (Option.isNone(started)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { agent, created, txid } = started.value;
  if (!created) return { agent, created };
  // A blank agent opens no session: its first words open one as they reach it (`steer.ts`).
  const handed = brief.prompt ?? brief.descriptionSnapshot;
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
            { failure: SERVER_AGENT_START_FAILURE.UNREACHABLE, startedBy: starterOf(ask) },
          ),
        ),
      );
      // Each image is kept beside the new agent's conversation first, so the agent is told its id; one the
      // store could not keep goes unnamed rather than failing a Start whose agent already stands.
      const files = yield* keptHandedImages(
        { userId: agent.userId, conversationId: agent.conversationId },
        attachments,
      ).pipe(Effect.catch((failure) => Effect.as(logStoreFailure(failure), attachments)));
      const mentioned =
        words === undefined
          ? undefined
          : mentionedContext(
              words,
              landing.task,
              reads,
              undefined,
              yield* descriptionsOnFor(agent.userId, agent.kind),
            );
      // The first message is written here, awaiting its turn, on every runtime, so it says what it is and
      // who sent it: a native harness's runner names the line back as it takes it (`native-events/`).
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
            { failure: SERVER_AGENT_START_FAILURE.FIRST_LINE, startedBy: starterOf(ask) },
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
                { failure: SERVER_AGENT_START_FAILURE.CUT_SHORT, startedBy: starterOf(ask) },
              ),
      ),
      Effect.annotateLogs(agentLogIds(agent)),
    );
    if (opened === undefined || opened.outcome !== EVE_SEND_OUTCOME.ACCEPTED) {
      // An image still being prepared is answered by name, so the Start is made again under its key.
      const refusal = opened === undefined ? HOSTED_REFUSAL.UNAVAILABLE : failedCallRefusal(opened);
      // A native harness says why it refused where its harness decided it (`runner-sessions.ts`), so
      // a harness this function cannot reach is said here.
      if (opened !== undefined && opened.runtimeRefusal === RUNTIME_REFUSAL.NOT_HERE) {
        yield* agentFailureSaid(
          `a Start's open was refused: ${refusal.error}, status ${opened.status}`,
          refusal.error,
          true,
        ).pipe(Effect.annotateLogs(agentLogIds(agent)));
      }
      yield* hostedStoreOrUnavailable(discardAgent(userId, agent.id)).pipe(
        Effect.annotateLogs(agentLogIds(agent)),
      );
      yield* startFailed(userId, agent, {
        failure:
          opened === undefined
            ? SERVER_AGENT_START_FAILURE.UNREACHABLE
            : SERVER_AGENT_START_FAILURE.REFUSED,
        startedBy: starterOf(ask),
      });
      return yield* Effect.fail(refusal);
    }
    yield* Effect.logInfo("a Start opened its agent's session").pipe(
      Effect.annotateLogs(agentLogIds(agent)),
    );
  }
  // A place named is kept only once the agent stands for good, so a refused opening changes no pick.
  yield* keptPick(userId, ask.runsOn);
  // The work goes on in the continue, so its source stops; a fork's source goes on beside it.
  const stopped = continued ? yield* stoppedSource(eve, from.source, ask.startedBy?.id) : false;
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
    // A blank agent was handed no work, so its task stands where it is.
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
  yield* recordServerEvent(
    SERVER_EVENT.AGENT_START,
    { userId, workspaceId: agent.organizationId },
    {
      model: choice.model,
      effort: choice.effort,
      start_kind:
        from === undefined
          ? SERVER_AGENT_START_KIND.FRESH
          : continued
            ? SERVER_AGENT_START_KIND.CONTINUE
            : SERVER_AGENT_START_KIND.FORK,
      is_from_automation: automationRun(ask) !== undefined,
      started_by: starterOf(ask),
      has_task: ask.taskId !== null,
      agent_kind: agent.kind,
    },
  );
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

/**
 * The account's agent started on the task, or in the workspace with no
 * task, as a request asks it, through `startAgent`: the agent's own
 * Start (`POST /api/plans/{id}/agents`), a Start from an agent in its own
 * place (`POST /api/agents/{id}/agents`), and a task's start that names an
 * agent (`POST /api/plans`) all take it, so they refuse and answer alike.
 * A choice the catalog refuses is refused as invalid; an empty note is none,
 * its files carrying it alone. A new agent's summary is read as it was just
 * made, with no turn; one a retry found under its key, as it stands now.
 */
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
    runsOn: request.runsOn,
    alsoRepositories: request.alsoRepositories,
    branch: request.branch,
    title: request.title,
    summaryModel,
    reached,
    landed,
  }).pipe(Effect.catchTag("ModelChoiceRefused", () => Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)));
  if (!created) return { agent: yield* summaryOf(userId, agent), created };
  const [names, runtimes, macs, owners] = yield* hostedStoreOrUnavailable(
    Effect.all(
      [
        readAccountNames(summaryAccounts(agent)),
        nativeRuntimesOfReached([agent.conversationId]),
        devicesNamed(summaryDevices([agent])),
        agentOwnerFactsOf([agent]),
      ],
      { concurrency: 4 },
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
      owners,
      [],
      macs,
    ),
    created,
    ...(txid === undefined ? undefined : { txid }),
  };
});
