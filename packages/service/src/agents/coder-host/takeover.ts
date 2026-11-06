import type { DatabaseServices } from "@repo/database/core/query";
import { readAgentRepositories } from "@repo/database/models/agent-repositories";
import {
  type Agent,
  archiveAgentCommitted,
  listPublishedAgentsById,
  readAgent,
  readAgentByKey,
  readAgentContext,
  readAgentRouting,
} from "@repo/database/models/agent-store";
import {
  copySessionEntries,
  holdsSessionEntries,
} from "@repo/database/models/claude-session-entries";
import { standingSessionsOf } from "@repo/database/models/recorded-session";
import { readTaskHeader, readTaskWorkspace } from "@repo/database/models/task-store";
import { isWorkspaceMember } from "@repo/database/models/workspace-store";
import { storeWriter } from "@repo/database/models/writer";
import type { StoredArchive } from "@repo/database/schemas/agent";
import { type NoteFiles, type Replay, stepsBytes, summaryBytes } from "@repo/features/agent-replay";
import {
  AGENT_ARCHIVER,
  AGENT_ATTACHMENT_TYPE,
  AGENT_BOUNDS,
  AGENT_KIND,
  AGENT_MACHINE,
  type AgentAlsoRepository,
  type AgentAttachment,
  type AgentPullRequest,
  type AgentRunsOnRequest,
  type AgentStartFrom,
  CONTEXT_WINDOW,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import { agentName } from "@repo/features/model-label";
import type { ModelChoice } from "@repo/features/models-wire";
import { bothInOrder } from "@repo/runtime/effect";
import { START_LINE_BRIEF } from "@repo/wire";
import { Effect, Option } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { SERVER_AGENT_START_KIND, type ServerAgentStartKind } from "../../events/server-events.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import { logStoreFailure } from "../../http/store-failure.js";
import { ModelCatalog } from "../../providers/model-catalog.js";
import { standingAgentDrive } from "../agent-drive.js";
import { admitsPlanWriter, controlsAgent } from "../agent-reach.js";
import type { AgentSessions, EveTypedTurn } from "../eve-host/eve-sessions.js";
import { MENTIONED_BOUNDS } from "../mentioned-context.js";
import { deploymentOidcToken, vercelSandboxApi } from "../vercel-sandbox-api.js";
import type { AccountKeyRows, AgentRuntimeChoice } from "./agent-runtime-choice.js";
import { contextWindowOf } from "./context.js";
import { agentPublished } from "./published.js";
import {
  type FittedReplay,
  lineageOf,
  replayOf,
  type SourceWork,
  type StartFrom,
  sourceTranscriptOf,
  TAKEN_ON,
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
import { copySourceWork, SNAPSHOT_MISS, type SourceCopyServices } from "./snapshot.js";
import { canceledTurn } from "./stop.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/**
 * takeover.ts -- what a Start does because it starts from another agent: the continue-versus-fork rules, the read of the source it inherits from, and the source's stop around the new agent's open.
 *
 * A Start from another agent of the task, or of the workspace where the
 * source has no task, to continue it or to fork it at one of its messages,
 * hands the new agent that agent's brief with its transcript replayed after
 * it (`replay.ts`) and its work, what it had not pushed included, on a fork
 * of the drive it stood on or copied to a branch of its own (`snapshot.ts`),
 * the note after both with the files the note carries, and runs it on that
 * agent's choice, servers, place, branch, and extra repositories unless the
 * ask names its own, and an agent started from an automation's run is no run
 * of that automation. Its mentions and servers are read from the source's
 * brief and the note, as a fresh start's would be, and never from the
 * replay. A continue is named after its source, `<title> (continued)`,
 * where the ask names no title and the source has one, and once eve has
 * taken it the source is stopped as a Stop stops it, since the work goes on
 * in the new agent; a fork leaves its source running, and a source that
 * could not be stopped is logged, never the Start's failure. A continue
 * stops its source, so one its starter's plan pays for is continued only by
 * those the plan's policy admits (`admitsPlanWriter`). A continue of a pilot
 * is a pilot too, and takes over from its source: the account's agents the
 * source started that stand unarchived report to the new pilot from the
 * transaction that makes it (`createAgent`), those of any pilot that took
 * over from it before among them, and once stopped the source is archived,
 * by the coding agent that continued it or else the member, which is logged
 * where it fails; a source eve would not stop stands unarchived. A fork of a
 * pilot takes over nothing. A member's continue of an agent a pilot started,
 * such as a sub-pilot, reports to that pilot as its source did; every other
 * Start records only the coding agent whose `start_agent` asks as its
 * starter, the one its note tells it to report to.
 *
 * The rules are decided once, from the source and the ask, with no read
 * (`takeoverRules`), so `start.ts` reads what a Start inherits rather than
 * asking which kind of Start it is; a fresh Start's rules are the ask's own
 * values. Every Start reads its source first (`takeoverOf`), which answers
 * a retry under its key before any source is read, decides its rules from
 * that source and its ask, then fits the source's replay once its choice is
 * accepted (`landedInheriting`), and
 * opens its agent through `openedTakingOver`, which copies a carried
 * transcript before the open and stops the source only after it.
 */

/** How a Start stands to the agent it starts from: none, a continue of its whole work, or a fork at one of its messages. */
export const TAKEOVER = { FRESH: "fresh", CONTINUE: "continue", FORK: "fork" } as const;

export type Takeover = (typeof TAKEOVER)[keyof typeof TAKEOVER];

/** What a takeover reads of a Start's ask: where it goes, its key, its source, and the values a source stands in for where the ask names none. */
export type TakeoverAsk = StartWhere & {
  readonly idempotencyKey: string;
  readonly from?: AgentStartFrom | undefined;
  readonly choice: ModelChoice | undefined;
  readonly note?: string | undefined;
  readonly attachments?: readonly AgentAttachment[] | undefined;
  readonly disabledServers?: readonly string[] | undefined;
  readonly serverWords?: string | undefined;
  readonly title?: string | undefined;
  readonly startedBy?: Agent | undefined;
  readonly alsoRepositories?: readonly AgentAlsoRepository[] | undefined;
  readonly summaryModel?: SummaryModelOf | undefined;
  readonly runsOn?: AgentRunsOnRequest | undefined;
};

/**
 * Where a Start puts its agent: a task, or a workspace with no task and the
 * repository the agent clones there, or none, where any coder handed words
 * alone stands (`start.ts`'s `landingOf`); an
 * agent it is started from must stand in the same place.
 */
export type StartWhere =
  | { readonly taskId: string }
  | { readonly taskId: null; readonly organizationId: string; readonly repository: string }
  | { readonly taskId: null; readonly organizationId: string; readonly repository: null };

/** What the first line of a Start from another agent says it is, and names. */
interface TakenLine {
  readonly brief: typeof START_LINE_BRIEF.CONTINUE | typeof START_LINE_BRIEF.FORK;
  readonly sourceAgentId: string;
}

/** The words a Start reads its mentions and its first turn's servers from. */
interface MentionWords {
  readonly words: string | undefined;
  readonly serverWords: string | undefined;
}

/** What a Start's kind decides, with no read: the ask's own values for a fresh Start, a source's where the ask names none for one from another agent. */
export interface TakeoverRules {
  readonly kind: Takeover;
  /** The agent it starts from, whose place it runs at where the ask names none (`machineOfStart`); none for a fresh Start. */
  readonly source: Agent | undefined;
  /** Whether the source's plan must admit the starter (`admitsPlanWriter`): a continue stops its source; a fork runs on the forker's own payer. */
  readonly checksPlanWriter: boolean;
  /** The choice the Start asks the catalog for; none for the account's default. */
  readonly choice: ModelChoice | undefined;
  /** The files the agent is handed: the source's brief's that fit, then the ask's. */
  readonly attachments: readonly AgentAttachment[];
  readonly disabledServers: readonly string[] | undefined;
  readonly title: string | undefined;
  /** The pilot a continue of a pilot takes over, whose agents report to the new one, a pilot on a task; none otherwise. */
  readonly takesOver: Agent | undefined;
  /** Whether the new agent reports to the pilot that started its source: a member's continue alone. */
  readonly readsPilotStarter: boolean;
  /** Whether the source is stopped once the new agent's session opened: a continue alone. */
  readonly stopsSource: boolean;
  /** The branch the source was started on, which the new agent is cloned at where GitHub still holds it and the ask names none. */
  readonly branch: string | null;
  /** Whether the new agent works in the repositories its source worked in beside its own: one from another agent whose ask names none. */
  readonly carriesExtras: boolean;
  /** The Start as it is counted. */
  readonly startKind: ServerAgentStartKind;
  /** What the first line says it is where it names a source; none for a fresh Start's, which says its brief. */
  readonly startLine: TakenLine | undefined;
  /** The words mentions and servers are read from, given the words the landing handed in the prompt's place, which only a fresh Start reads. */
  readonly mentionWords: (handed: string | null) => MentionWords;
}

/** The agent a Start takes over from as its landing reads it: the source's prompt, the new agent's brief in the description's place where it was handed one, and how its replay is fitted to the first message it is written into, which `firstMessage` writes for a replay or none. */
export interface ReplayFitter {
  readonly prompt: string | undefined;
  readonly fit: (
    firstMessage: (replay: Replay | undefined) => string,
  ) => Effect.Effect<FittedReplay, never, DatabaseServices>;
}

/** What a Start inherits: the source as read, none for a fresh Start, and the rules `takeoverRules` decides of it. */
export interface Inherited {
  readonly from: StartFrom | undefined;
  readonly rules: TakeoverRules;
}

/** What `takeoverOf` answers: the agent a retry's key already made, or the source a new Start is from, none for a fresh one. */
export type TakeoverRead =
  | { readonly made: Agent }
  | { readonly made: undefined; readonly from: StartFrom | undefined };

/** A choice as the catalog accepted it, with the account's stored credentials it was checked against. */
interface AcceptedRead {
  readonly choice: ModelChoice;
  readonly keys: AccountKeyRows;
}

/** What a continue's title adds to its source's. */
const CONTINUED_SUFFIX = " (continued)";

/** That suffix, however many times a chain of continues stacked it on a title written by hand. */
const CONTINUED_SUFFIXES = /(?: \(continued\))+$/u;

/** The kind each takeover is counted as. */
const START_KIND_OF: Readonly<Record<Takeover, ServerAgentStartKind>> = {
  [TAKEOVER.FRESH]: SERVER_AGENT_START_KIND.FRESH,
  [TAKEOVER.CONTINUE]: SERVER_AGENT_START_KIND.CONTINUE,
  [TAKEOVER.FORK]: SERVER_AGENT_START_KIND.FORK,
};

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

/** A prompt with the note after it, the words a Start from another agent reads mentions from; none where there is neither. */
function wordsOf(prompt: string | undefined, note: string | undefined): string | undefined {
  const words = [prompt, note].filter((each) => each !== undefined);
  return words.length === 0 ? undefined : words.join("\n\n");
}

/** How many of the note's files are text files, which eve is handed inlined, and how many images and PDFs. */
function noteFilesOf(files: readonly AgentAttachment[]): NoteFiles {
  const text = files.filter((file) => file.mediaType === AGENT_ATTACHMENT_TYPE.TEXT).length;
  return { text, other: files.length - text };
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** The kind of Start that hands on `from`: a continue where it names no message, a fork where it does. */
function takeoverKindOf(from: StartFrom): Takeover {
  return from.told.messageId === undefined ? TAKEOVER.CONTINUE : TAKEOVER.FORK;
}

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
export function whereOf(place: StartWhere): StartWhere {
  if (place.taskId !== null) return { taskId: place.taskId };
  return place.repository === null
    ? { taskId: null, organizationId: place.organizationId, repository: null }
    : { taskId: null, organizationId: place.organizationId, repository: place.repository };
}

/**
 * What a Start's kind decides of it, read off the source it hands on and the
 * ask, with no read: none for a fresh Start, whose values are the ask's own;
 * for one from another agent, the source's choice, servers, branch, and
 * place where the ask names none, its brief's files ahead of the ask's, and
 * its extra repositories; and for a continue alone, the plan-writer check,
 * the title after its source's, the source's stop, the pilot it takes over,
 * and, for a member's, the pilot its source reported to.
 */
export function takeoverRules(from: StartFrom | undefined, ask: TakeoverAsk): TakeoverRules {
  const own = ask.attachments ?? [];
  if (from === undefined) {
    return {
      kind: TAKEOVER.FRESH,
      source: undefined,
      checksPlanWriter: false,
      choice: ask.choice,
      attachments: own,
      disabledServers: ask.disabledServers,
      title: ask.title,
      takesOver: undefined,
      readsPilotStarter: false,
      stopsSource: false,
      branch: null,
      carriesExtras: false,
      startKind: START_KIND_OF[TAKEOVER.FRESH],
      startLine: undefined,
      mentionWords: (handed) => {
        const words = handed ?? ask.note;
        return { words, serverWords: ask.serverWords ?? words };
      },
    };
  }
  const { source } = from;
  const kind = takeoverKindOf(from);
  const continued = kind === TAKEOVER.CONTINUE;
  // Note that the replay is never read for mentions, because its words name what the source read, not what to hand on.
  const words = wordsOf(from.prompt, ask.note);
  const serverWords = ask.serverWords ?? wordsOf(from.serverWords ?? from.prompt, ask.note);
  return {
    kind,
    source,
    checksPlanWriter: continued,
    choice: ask.choice ?? from.choice,
    attachments: [...from.attachments, ...own],
    disabledServers: ask.disabledServers ?? from.disabledServers,
    title: ask.title ?? (continued ? continuedTitle(source.title) : undefined),
    takesOver: continued && source.kind === AGENT_KIND.PILOT ? source : undefined,
    readsPilotStarter: continued && ask.startedBy === undefined,
    stopsSource: continued,
    branch: source.startBranch,
    carriesExtras: ask.alsoRepositories === undefined,
    startKind: START_KIND_OF[kind],
    startLine: {
      brief: continued ? START_LINE_BRIEF.CONTINUE : START_LINE_BRIEF.FORK,
      sourceAgentId: source.id,
    },
    mentionWords: () => ({ words, serverWords }),
  };
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

/** Whether a pull request is still open, a draft among them, so work that goes on goes on in it. */
function stillOpen(published: AgentPullRequest | null): boolean {
  return (
    published !== null &&
    (published.state === PULL_REQUEST_STATE.OPEN || published.state === PULL_REQUEST_STATE.DRAFT)
  );
}

/**
 * Whether a continue goes on in its source's pull request: one its row last
 * read open, read again on GitHub now, since one merged or closed since the
 * row was written must not take the work. A read that fails is logged and
 * answered no, so the continue opens a pull request of its own rather than
 * pushing to a branch that may be done.
 */
const goesOnInPullRequest = (userId: string, source: Agent, stored: AgentPullRequest | null) =>
  source.branch === null || !stillOpen(stored)
    ? Effect.succeed(false)
    : agentPublished(userId, source).pipe(
        Effect.map((answer) => stillOpen(answer.pullRequest)),
        Effect.catch((failure) =>
          Effect.as(
            Effect.logWarning(
              `the pull request of an agent being continued could not be read: ${failure._tag}`,
            ),
            false,
          ),
        ),
      );

/**
 * Where the source's work reaches the new agent. A source whose session has
 * a drive of its own hands that drive, which the new agent's is forked from
 * at its first open (`agent-drive.ts`), so its sandbox is never woken; one
 * from before drives has its work copied to a branch as it always was
 * (`snapshot.ts`). Note that a source in another repository than the one
 * the new agent works in hands no drive, since its checkout would be none
 * of the new agent's, and that a drive that could not be read is a miss,
 * logged, as a copy that failed is.
 */
const sourceWorkOf = (
  userId: string,
  source: Agent,
  repository: string | null,
  forked: boolean,
  idempotencyKey: string,
) => {
  const missed: SourceWork = {
    on: TAKEN_ON.COPY,
    copy: { copied: false, miss: SNAPSHOT_MISS.FAILED },
  };
  return Effect.gen(function* () {
    const [session] =
      source.repository?.toLowerCase() === repository?.toLowerCase()
        ? yield* standingSessionsOf(source.userId, [source.conversationId])
        : [];
    if (session !== undefined) {
      const api = yield* vercelSandboxApi(deploymentOidcToken);
      const drive = yield* standingAgentDrive(api, session.sessionId);
      if (drive !== undefined) return { on: TAKEN_ON.DRIVE, drive } satisfies SourceWork;
    }
    const copy = yield* copySourceWork(userId, source, repository, forked, idempotencyKey);
    return { on: TAKEN_ON.COPY, copy } satisfies SourceWork;
  }).pipe(
    Effect.catch((failure) =>
      Effect.as(Effect.logWarning(`the source's drive was not read: ${String(failure)}`), missed),
    ),
  );
};

/** The repository the new agent clones in the place: the task's as it stands now, or the workspace place's own; none where the task names none. */
const placeRepository = (userId: string, place: StartWhere) =>
  Effect.gen(function* () {
    if (place.taskId === null) return place.repository;
    const task = yield* hostedStoreOrUnavailable(readTaskHeader(userId, place.taskId));
    return Option.isSome(task) ? task.value.repository : null;
  });

/**
 * What a Start from another agent of the place is handed and runs on, read
 * as the account, the source's files held to what fits beside `noteFiles`.
 * Note that a source the account reaches in no such place is refused as
 * naming nothing, so a source on another plan is never dropped and started
 * afresh; a message that is none of its journals is invalid. The work is
 * taken once the transcript reads, so a Start refused on its message pushes
 * nothing.
 */
export const startFromOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  place: StartWhere,
  from: AgentStartFrom,
  noteFiles: readonly AgentAttachment[],
  idempotencyKey: string,
): Effect.fn.Return<StartFrom, HostedRefusal, DatabaseServices | SourceCopyServices> {
  const [found] = yield* hostedStoreOrUnavailable(listPublishedAgentsById(userId, [from.agentId]));
  const inPlace =
    found !== undefined &&
    found.agent.taskId === place.taskId &&
    (place.taskId !== null || found.agent.organizationId === place.organizationId);
  if (!inPlace) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
  const { agent: source, published } = found;
  // An agent on its starter's own GitHub token is continued or forked by its starter alone, before its work is copied.
  if (!controlsAgent(userId, source)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  const repository = yield* placeRepository(userId, place);
  const { lineage, carried } = yield* hostedStoreOrUnavailable(
    lineageOf(userId, source, repository),
  );
  const transcript = yield* sourceTranscriptOf(source, from, noteFiles);
  const forked = from.messageId !== undefined;
  const work = yield* sourceWorkOf(userId, source, repository, forked, idempotencyKey);
  const inPullRequest = !forked && (yield* goesOnInPullRequest(userId, source, published));
  const [, ...extras] = yield* hostedStoreOrUnavailable(readAgentRepositories(userId, source.id));
  const edited = yield* transcript.edited;
  return {
    source,
    lineage,
    prompt: transcript.prompt,
    attachments: transcript.attachments,
    steps: transcript.steps,
    totalSteps: transcript.totalSteps,
    carriedSummary: transcript.carriedSummary,
    choice: { model: source.model, effort: source.effort, contextWindow: source.contextWindow },
    disabledServers: source.disabledServers,
    serverWords: source.automationOrigin?.prompt,
    told: {
      published,
      work,
      carried,
      forked: { at: forked, edited },
      unkept: transcript.unkept,
      inPullRequest,
      extras,
      messageId: from.messageId,
      cut: transcript.cut,
    },
  };
});

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

/**
 * What a Start takes over from, read before anything it makes: the agent
 * its key already made where it is a retry of this Start, a fresh one's in
 * the place asked and one from another agent's before its source is read,
 * which may be gone since; a key that names another Start's agent refused
 * as invalid. Otherwise the source read against the place asked, one not of
 * it refused, never dropped (`startFromOf`); none for a fresh Start.
 */
export const takeoverOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  ask: TakeoverAsk,
): Effect.fn.Return<TakeoverRead, HostedRefusal, DatabaseServices | SourceCopyServices> {
  const asked = ask.from;
  if (asked === undefined) {
    const made = yield* hostedStoreOrUnavailable(readAgentByKey(userId, ask.idempotencyKey));
    if (Option.isSome(made) && (yield* madeInPlace(userId, made.value, whereOf(ask)))) {
      return { made: made.value };
    }
    return { made: undefined, from: undefined };
  }
  const made = yield* startedFromBefore(userId, ask.idempotencyKey, asked, ask);
  if (Option.isSome(made)) return { made: made.value };
  // A key that already names the agent of another Start is refused, never answered with that agent.
  const other = yield* hostedStoreOrUnavailable(readAgentByKey(userId, ask.idempotencyKey));
  if (Option.isSome(other)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const from = yield* startFromOf(
    userId,
    whereOf(ask),
    asked,
    ask.attachments ?? [],
    ask.idempotencyKey,
  );
  return { made: undefined, from };
});

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

/**
 * The source's CLI session a continue or a fork of a whole agent forks as
 * its own, in place of a replay of its steps: one the service keeps the
 * transcript of, on the harness the new agent runs (`runtime`), for an agent
 * in the cloud, where its runner reads the transcript back; none for a fork
 * at a message, which is replayed to that message, and wherever else.
 */
const carriedSessionOf = Effect.fnUntraced(function* (
  ask: Pick<TakeoverAsk, "runsOn">,
  from: StartFrom,
  runtime: Effect.Effect<AgentRuntimeChoice, HostedRefusal, DatabaseServices>,
) {
  if (from.told.messageId !== undefined) return undefined;
  const { source } = from;
  const place = ask.runsOn ?? { machine: source.machine ?? AGENT_MACHINE.VERCEL };
  if (place.machine !== AGENT_MACHINE.VERCEL) return undefined;
  const routing = yield* hostedStoreOrUnavailable(readAgentRouting(source.userId, source.id));
  const read = Option.getOrUndefined(routing);
  if (read?.nativeSession == null) return undefined;
  if ((yield* runtime).runtime !== read.runtime) return undefined;
  const held = yield* hostedStoreOrUnavailable(
    holdsSessionEntries(source.userId, source.conversationId),
  );
  return held ? read.nativeSession : undefined;
});

/** The source as a Start hands it on where its transcript is carried: none of its steps replayed, and its session named. */
function carryingTranscript(from: StartFrom, session: string): StartFrom {
  return {
    ...from,
    steps: [],
    totalSteps: 0,
    carriedSummary: undefined,
    told: { ...from.told, transcript: session },
  };
}

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

/**
 * A Start's accepted choice and its landing, with what it inherits fitted
 * to them: a fresh Start's landing does not wait on its choice, so the two
 * are read together; one from another agent is first held to its source's
 * plan's policy where it stops that source and reads the pilot its source
 * reported to where its rules say, then fits that agent's replay to the
 * choice's window, its transcript carried whole in place of its replayed
 * steps where the service keeps it on the harness `runtimeOf` decides, so
 * its landing waits on it, and once landed carries the repositories its
 * source worked in beside the landing's own where the ask names none.
 */
export const landedInheriting = <
  A extends AcceptedRead,
  L extends { readonly repository: string | null },
  E1,
  R1,
  E2,
  R2,
>(
  userId: string,
  ask: TakeoverAsk,
  inherited: Inherited,
  accepted: Effect.Effect<A, E1, R1>,
  runtimeOf: (
    model: string,
    keys: AccountKeyRows,
  ) => Effect.Effect<AgentRuntimeChoice, HostedRefusal, DatabaseServices>,
  land: (
    fitter: ReplayFitter | undefined,
    noteFiles: NoteFiles | undefined,
  ) => Effect.Effect<L, E2, R2>,
): Effect.Effect<
  {
    readonly read: A;
    readonly landing: L;
    readonly carried: readonly AgentAlsoRepository[] | undefined;
    /** The pilot that started the source, for a member's continue of an agent a pilot started; none otherwise. */
    readonly pilotStarter: string | undefined;
  },
  E1 | E2 | HostedRefusal,
  R1 | R2 | DatabaseServices | ModelCatalog
> => {
  const { from, rules } = inherited;
  if (from === undefined) {
    return Effect.map(bothInOrder(accepted, land(undefined, undefined)), ([read, landing]) => ({
      read,
      landing,
      carried: undefined,
      pilotStarter: undefined,
    }));
  }
  return Effect.gen(function* () {
    if (rules.checksPlanWriter) yield* admitsPlanWriter(userId, from.source);
    const pilotStarter = rules.readsPilotStarter
      ? yield* pilotStarterOf(userId, from.source)
      : undefined;
    const read = yield* accepted;
    const session = yield* carriedSessionOf(ask, from, runtimeOf(read.choice.model, read.keys));
    const handedFrom = session === undefined ? from : carryingTranscript(from, session);
    const fitter = yield* replayFitterOf(
      userId,
      handedFrom,
      read.choice,
      ask.summaryModel,
      rules.attachments,
    );
    // The note's files go after the source's in each group eve is handed, so the marker counts them by group.
    const landing = yield* land(fitter, noteFilesOf(ask.attachments ?? []));
    const carried = rules.carriesExtras
      ? yield* carriedExtrasOf(userId, from.source, landing.repository)
      : undefined;
    return { read, landing, carried, pilotStarter };
  });
};

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
 * The new agent's `opening` run around what it inherits: the source's CLI
 * transcript made the new agent's own before its first open forks it, then
 * the opening, and once that succeeded the source of a continue stopped,
 * since the work goes on in the new agent, and a pilot it took over archived
 * where the stop held, since one eve would not stop still runs and stands
 * where its messages still reach it. Answers the transaction the pilot was
 * archived in; none where none was, as for every fresh Start, which only opens.
 */
export const openedTakingOver = <E, R>(
  eve: Effect.Effect<
    AgentSessions<EveTypedTurn>,
    HostedRefusal,
    HttpClient.HttpClient | DatabaseServices
  >,
  userId: string,
  startedBy: Agent | undefined,
  inherited: Inherited,
  agent: Agent,
  opening: Effect.Effect<void, E, R>,
): Effect.Effect<
  Option.Option<string>,
  E | HostedRefusal,
  R | DatabaseServices | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const { from, rules } = inherited;
    if (from !== undefined && agent.startedFrom?.session !== undefined) {
      yield* hostedStoreOrUnavailable(
        copySessionEntries(
          { userId: from.source.userId, conversationId: from.source.conversationId },
          agent.conversationId,
        ),
      );
    }
    yield* opening;
    if (from === undefined || !rules.stopsSource) return Option.none<string>();
    const stopped = yield* stoppedSource(eve, from.source, startedBy?.id);
    if (rules.takesOver === undefined || !stopped) return Option.none<string>();
    return yield* archivedPilot(userId, rules.takesOver, startedBy);
  });
