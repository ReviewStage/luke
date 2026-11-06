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
import { descriptionMarkdown } from "@repo/features/description-markdown";
import type { GitHubAccess } from "@repo/features/github-repositories-wire";
import { agentName, automationRun } from "@repo/features/model-label";
import { agentFallbackChoice, type ModelChoice } from "@repo/features/models-wire";
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
import { descriptionsOnFor } from "../descriptions-on.js";
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

export type { StartWhere };

export type StartPlace = StartWhere & {
  readonly prompt: string | undefined;
  readonly note?: string | undefined;
  readonly noteHeading?: StartNoteHeading | undefined;
  readonly from?: AgentStartFrom | undefined;
  readonly blank?: boolean | undefined;
  readonly kind?: AgentKind | undefined;
};

export type StartAsk = StartPlace & {
  readonly idempotencyKey: string;
  readonly choice: ModelChoice | undefined;
  readonly attachments?: readonly AgentAttachment[] | undefined;
  readonly disabledServers?: readonly string[] | undefined;
  readonly automationId?: string | undefined;
  readonly automationOrigin?: StoredAutomationOrigin | undefined;
  readonly automationRunId?: string | undefined;
  readonly startedBy?: Agent | undefined;
  readonly title?: string | undefined;
  readonly carried?: SlackLineMetadata | undefined;
  readonly summaryModel?: SummaryModelOf | undefined;
  readonly serverWords?: string | undefined;
  readonly branch?: string | undefined;
  readonly call?: boolean | undefined;
  readonly reached?: StartReach | undefined;
  readonly landed?: StoredTask | undefined;
  readonly runsOn?: AgentRunsOnRequest | undefined;
  readonly alsoRepositories?: readonly AgentAlsoRepository[] | undefined;
};

export interface StartReach {
  readonly repository: string;
  readonly access: GitHubAccess;
}

export interface AgentStarted {
  readonly agent: Agent;
  readonly created: boolean;
  readonly txid?: string;
}

export type StartServices = DatabaseServices | HttpClient.HttpClient | GitHubApp | ModelCatalog;

export interface AccountModelChoices {
  readonly offered: readonly OfferedModel[];
  readonly defaultChoice: ModelChoice;
}

export const accountModelChoices = (userId: string) =>
  Effect.map(modelChoicesRead(userId), (read) => read.choices);

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

export const acceptedAgentChoice = (userId: string, named: ModelChoice | undefined) =>
  Effect.map(acceptedChoiceRead(userId, named), (accepted) => accepted.choice);

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

interface StartLanding {
  readonly workspaceId: string;
  readonly repository: string | null;
  readonly task: Task | undefined;
  readonly mover: string | undefined;
  readonly place: AgentPlace;
  readonly startedFrom: StoredStartedFrom | undefined;
}

interface ReplayFitter {
  readonly prompt: string | undefined;
  readonly fit: (
    firstMessage: (replay: Replay | undefined) => string,
  ) => Effect.Effect<FittedReplay, never, DatabaseServices>;
}

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

const handedOf = Effect.fnUntraced(function* (
  words: string,
  place: StartPlace,
  fitter: ReplayFitter | undefined,
  noteFiles: NoteFiles | undefined,
) {
  const heading = place.noteHeading ?? START_NOTE_HEADING.DEVELOPER;
  const written = (replayed: Replay | undefined) =>
    firstMessageText(words, replayed, place.note, heading, noteFiles);
  const fitted = fitter === undefined ? undefined : yield* fitter.fit(written);
  return { text: written(fitted?.replay), startedFrom: fitted?.startedFrom };
});

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
  const read =
    landed !== undefined && landed.task.id === place.taskId
      ? Option.some(landed)
      : yield* hostedStoreOrUnavailable(readTask(userId, place.taskId));
  if (Option.isNone(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { task, ownerId } = read.value;
  const mover = ownerId === userId ? userId : undefined;
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

function noteFilesOf(files: readonly AgentAttachment[]): NoteFiles {
  const text = files.filter((file) => file.mediaType === AGENT_ATTACHMENT_TYPE.TEXT).length;
  return { text, other: files.length - text };
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

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

function wordsOf(prompt: string | undefined, note: string | undefined): string | undefined {
  const words = [prompt, note].filter((each) => each !== undefined);
  return words.length === 0 ? undefined : words.join("\n\n");
}

const CONTINUED_SUFFIX = " (continued)";

const CONTINUED_SUFFIXES = /(?: \(continued\))+$/u;

function continuedTitle(source: string | null): string | undefined {
  const base = (source ?? "").replace(CONTINUED_SUFFIXES, "").trim();
  if (base === "") return undefined;
  const room = AGENT_BOUNDS.MAX_TITLE_CHARS - CONTINUED_SUFFIX.length;
  let kept = "";
  for (const char of base) {
    if (kept.length + char.length > room) break;
    kept += char;
  }
  return `${kept.trimEnd()}${CONTINUED_SUFFIX}`;
}

const stoppedSource = (
  eve: Effect.Effect<
    AgentSessions<EveTypedTurn>,
    HostedRefusal,
    HttpClient.HttpClient | DatabaseServices
  >,
  source: Agent,
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

interface StartFailed {
  readonly failure: ServerAgentStartFailure;
  readonly startedBy: ServerAgentStarter;
}

const starterOf = (ask: Pick<StartAsk, "startedBy" | "automationOrigin">) =>
  ask.startedBy !== undefined
    ? SERVER_AGENT_STARTER.AGENT
    : automationRun(ask) !== undefined
      ? SERVER_AGENT_STARTER.AUTOMATION
      : SERVER_AGENT_STARTER.MEMBER;

const pilotStarterOf = (userId: string, source: Agent) =>
  source.startedByAgentId === null
    ? Effect.succeed(undefined)
    : Effect.map(hostedStoreOrUnavailable(readAgent(userId, source.startedByAgentId)), (starter) =>
        Option.isSome(starter) && starter.value.kind === AGENT_KIND.PILOT
          ? starter.value.id
          : undefined,
      );

export function placeOfAgent(
  agent: Pick<Agent, "taskId" | "organizationId" | "repository">,
): StartWhere {
  if (agent.taskId !== null) return { taskId: agent.taskId };
  const { organizationId, repository } = agent;
  return repository === null
    ? { taskId: null, organizationId, repository }
    : { taskId: null, organizationId, repository };
}

function whereOf(place: StartWhere): StartWhere {
  if (place.taskId !== null) return { taskId: place.taskId };
  return place.repository === null
    ? { taskId: null, organizationId: place.organizationId, repository: null }
    : { taskId: null, organizationId: place.organizationId, repository: place.repository };
}

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

export const startedFromBefore = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  idempotencyKey: string,
  from: Pick<AgentStartFrom, "agentId" | "messageId">,
  place: StartWhere | undefined,
): Effect.fn.Return<Option.Option<Agent>, HostedRefusal, DatabaseServices> {
  const made = yield* hostedStoreOrUnavailable(readAgentByKey(userId, idempotencyKey));
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

function startRuntimeOf(userId: string, model: string, keys: AccountKeyRows) {
  return Effect.catch(agentRuntimeChoice(userId, model, keys), (failure) =>
    failure instanceof AgentCredentialMissing
      ? Effect.fail(credentialMissing(failure.provider))
      : hostedStoreOrUnavailable(Effect.fail(failure)),
  );
}

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

function sourceOf(carried: SlackLineMetadata | undefined): AgentSource | undefined {
  if (carried === undefined) return undefined;
  return {
    kind: AGENT_SOURCE.SLACK,
    ...(carried.url === undefined ? undefined : { url: carried.url }),
  };
}

function openingOf(
  agent: Agent,
  ask: Pick<StartAsk, "automationId" | "automationOrigin" | "startedBy" | "carried">,
  brief: { readonly prompt: string | null },
  taken: { readonly source: Agent; readonly continued: boolean } | undefined,
): { readonly sender: LineSender; readonly metadata: AwaitingLineMetadata } {
  const { automationId, automationOrigin, startedBy, carried } = ask;
  if (automationOrigin !== undefined) {
    return {
      sender: { kind: MESSAGE_SENDER.AUTOMATION, automationId, name: automationOrigin.name },
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
    if (Result.isFailure(written) || Option.isNone(written.success)) {
      return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    }
    return sentLineId(clientKey);
  });

interface StartMachine {
  readonly asked: { readonly machine: AgentMachineKind; readonly deviceId?: string | undefined };
}

interface PlaceRead {
  readonly machine: AgentMachineKind;
  readonly deviceId?: string | null | undefined;
}

const IN_THE_CLOUD: StartMachine = { asked: { machine: AGENT_MACHINE.VERCEL } };

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

const keptPick = (userId: string, runsOn: AgentRunsOnRequest | undefined) =>
  runsOn === undefined
    ? Effect.void
    : keepRunsOnPick(userId, runsOn).pipe(
        Effect.catch((failure) =>
          Effect.logWarning(`the last Runs on pick could not be kept: ${failure._tag}`),
        ),
      );

const extraRepositoriesOf = Effect.fnUntraced(function* (
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

export const startAgent = /* @__PURE__ */ Effect.fn("web/startAgent")(function* (
  eve: Effect.Effect<
    AgentSessions<EveTypedTurn>,
    HostedRefusal,
    HttpClient.HttpClient | DatabaseServices
  >,
  userId: string,
  ask: StartAsk,
): Effect.fn.Return<AgentStarted, HostedRefusal | ModelChoiceRefused, StartServices> {
  if (ask.from === undefined) {
    const made = yield* hostedStoreOrUnavailable(readAgentByKey(userId, ask.idempotencyKey));
    if (Option.isSome(made) && (yield* madeInPlace(userId, made.value, whereOf(ask)))) {
      return { agent: made.value, created: false };
    }
  }
  if (ask.from !== undefined) {
    const made = yield* startedFromBefore(userId, ask.idempotencyKey, ask.from, ask);
    if (Option.isSome(made)) return { agent: made.value, created: false };
    const other = yield* hostedStoreOrUnavailable(readAgentByKey(userId, ask.idempotencyKey));
    if (Option.isSome(other)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
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
  if (from !== undefined && from.told.messageId === undefined) {
    yield* admitsPlanWriter(userId, from.source);
  }
  const accepted = acceptedChoiceRead(userId, ask.choice ?? from?.choice);
  const [{ choice, keys }, landing] =
    from === undefined
      ? yield* bothInOrder(accepted, landingOf(userId, ask, undefined, undefined, ask.landed))
      : yield* Effect.flatMap(accepted, (read) =>
          Effect.gen(function* () {
            const fitter = yield* replayFitterOf(userId, from, read.choice, ask.summaryModel, [
              ...from.attachments,
              ...(ask.attachments ?? []),
            ]);
            const noteFiles = noteFilesOf(ask.attachments ?? []);
            return [read, yield* landingOf(userId, ask, fitter, noteFiles, ask.landed)] as const;
          }),
        );
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
  const words = from === undefined ? (brief.prompt ?? ask.note) : wordsOf(from.prompt, ask.note);
  const serverWords =
    ask.serverWords ??
    (from === undefined ? words : wordsOf(from.serverWords ?? from.prompt, ask.note));
  const attachments =
    from === undefined
      ? (ask.attachments ?? [])
      : [...from.attachments, ...(ask.attachments ?? [])];
  const mentions =
    words === undefined
      ? Effect.succeed(undefined)
      : hostedStoreOrUnavailable(
          readMentioned(userId, words, {
            task: landing.task,
            workspaceId: landing.workspaceId,
          }),
        );
  const [[reached, branch], reads] = yield* bothInOrder(bothInOrder(reach, branchOf), mentions);
  const continued = from !== undefined && from.told.messageId === undefined;
  const title = ask.title ?? (continued ? continuedTitle(from.source.title) : undefined);
  const takesOver = continued && from.source.kind === AGENT_KIND.PILOT ? from.source : undefined;
  const place =
    takesOver !== undefined && brief.taskId !== null ? { ...brief, kind: AGENT_KIND.PILOT } : brief;
  const pilotStarter =
    continued && ask.startedBy === undefined
      ? yield* pilotStarterOf(userId, from.source)
      : undefined;
  const where = yield* machineOfStart(userId, ask, from?.source, landing.task);
  const carried =
    ask.alsoRepositories === undefined && from !== undefined
      ? yield* carriedExtrasOf(userId, from.source, landing.repository)
      : undefined;
  const extras = yield* extraRepositoriesOf(
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
      mentionedServers:
        serverWords === undefined ? [] : mentionedServers(serverWords, landing.repository),
    }),
  );
  if (Option.isNone(started)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { agent, created, txid } = started.value;
  if (!created) return { agent, created };
  const handed = brief.prompt ?? brief.descriptionSnapshot;
  if (handed !== null) {
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
      const refusal = opened === undefined ? HOSTED_REFUSAL.UNAVAILABLE : failedCallRefusal(opened);
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
  yield* keptPick(userId, ask.runsOn);
  const stopped = continued ? yield* stoppedSource(eve, from.source, ask.startedBy?.id) : false;
  let committed = txid;
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

export interface RequestedStart {
  readonly agent: AgentSummary;
  readonly created: boolean;
  readonly txid?: string;
}

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
