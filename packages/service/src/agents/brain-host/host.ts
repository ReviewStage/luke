import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import { askRecord } from "@luke/database/models/asks";
import { readBoard } from "@luke/database/models/board-store";
import { promptHashOf, toolSetHashOf } from "@luke/database/models/content-addressed";
import { hostTurnId } from "@luke/database/models/ids";
import { listMessagesPast, type MessageCursor } from "@luke/database/models/message-reads";
import { readTaskOfConversation } from "@luke/database/models/task-store";
import type { ConversationTarget } from "@luke/database/models/writer";
import { EMPTY_BOARD } from "@luke/features/board-wire";
import { isTextUIPart } from "ai";
import { Effect, Option, Result, type Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { MessageStreamEvent } from "eve/client";
import type { SessionAuth, SessionContext } from "eve/context";
import type { ToolContext as EveToolContext } from "eve/tools";
import {
  ACTION_RESULT_STATUS,
  type BrainTurnTrigger,
  isRecord,
  isWireString,
  MESSAGE_ROLE,
  type UnparsedWireValue,
  type WireRecord,
} from "../../core.js";
import type { GitHubApp } from "../../github/github-app.js";
import { taskWorkspace } from "../../github/workspace-repository.js";
import { type ModelCatalog, providerModelOf } from "../../providers/model-catalog.js";
import { HOSTED_TOOL_SET } from "../../tasks/brain-tool-set.js";
import { delegatedChildOf, type HostAdmission, hostAdmission } from "../agent-runtime/host-core.js";
import { type AgentSkill, repositorySkills } from "../agent-runtime/skills.js";
import type { CoderModelSelection } from "../coder-host/model.js";
import { titleSubagent } from "../coder-host/title.js";
import { AGENT_CALLER } from "../coding-agent-tools.js";
import { MeterUnavailable, ResearchBudget } from "../public-research.js";
import type { RepositorySkill } from "../repository-skills.js";
import { turnKindOf } from "./auth.js";
import {
  BRAIN_HOST,
  BRAIN_HOST_MODEL_FIXTURE,
  BRAIN_HOST_REFUSAL,
  BRAIN_HOST_TURN_KIND,
  type BrainHostTurn,
  RELAY_TURN,
} from "./bounds.js";
import {
  BRAIN_INSTRUCTIONS,
  brainStandingContext,
  brainToolDeclarations,
  EVE_DELEGATION_TOOL,
  type HostedToolDeclaration,
  runBrainTool,
} from "./brain.js";
import { ChatPostTally, chatSince, chatTakenIn, lukeOn } from "./chat.js";
import { wakingDoors } from "./chat-wake.js";
import { readRecentMessages } from "./context.js";
import {
  type AdmittedConversation,
  admitConversation,
  openChildConversation,
  SESSION_STANDING,
} from "./conversation.js";
import { EVE_MOUNT, eveSessionsComposer } from "./eve-sessions.js";
import { brainModelSelection } from "./model.js";
import type { BrainHostSeams } from "./production.js";
import { type RelayStanding, type RelayStateStore, StreamRelay } from "./relay.js";
import { rotationSeedText } from "./seed.js";
import { carryStop } from "./stop-carrier.js";

/**
 * The hosted brain composed over eve and the store: what the eve project's
 * authored files call, one function per thing eve asks the host for. eve is
 * the runtime and the event emitter — the loop, the sessions, the queue, the
 * stream — and the host is everything eve leaves to its author: who a
 * session is for, the prompt its turns run under, the standing context each
 * turn opens with, the tools it is offered and what they reach, the model
 * with the meter in front of it, and the relay from eve's stream into the
 * store's writer, which is the sole consumer and the only thing that writes
 * a message row. A conversation is a plan's: its turns run under the
 * planning model's instructions, its saved document as the standing context,
 * and the planning tools (`brain.ts`), and every write runs under the
 * conversation the session was admitted for. A worker is named from the
 * task it is handed by the same small call that names a coding agent
 * (`coder-host/title.ts`), on its child conversation.
 */

/** The turn a resolver or a tool runs in, as eve names it and as the store keys it; plain data, so a tool may capture it. */
interface HostedTurn {
  readonly kind: BrainHostTurn;
  readonly trigger: BrainTurnTrigger;
  readonly turnId: string;
}

/** What a tool eve runs is bound to: the conversation and the turn, as data eve can keep across its steps. */
export interface HostedToolBinding {
  readonly target: ConversationTarget;
  readonly turn: HostedTurn;
}

/** The kind of turn the current request opened, with the trigger the run stream names it by. */
interface HostedTurnKind {
  readonly kind: BrainHostTurn;
  readonly trigger: BrainTurnTrigger;
}

/** The prompt a session runs under and the content address its turns are recorded under. */
interface HostedSessionPrompt {
  readonly text: string;
  readonly hash: string;
}

/**
 * What the eve project keeps of the session's prompt between the start that
 * composed it and the turns that run under it: the content address alone,
 * absent until the session has composed one. It lives in eve's durable
 * session state, because the prompt applies at session scope and the turn
 * row must name the prompt the model actually reads.
 */
export interface SessionPromptRecord {
  readonly hash?: string;
}

/**
 * What the eve project keeps of the chat a turn was handed, between the
 * turn's start that read it and the turn's settling: eve's id for the turn
 * and the place Luke has read through once it settles, absent where the
 * turn was handed none. It lives in eve's durable session state, because
 * the turn may settle on another instance than the one it opened on.
 */
export interface ChatHandedRecord {
  readonly eveTurnId?: string;
  readonly through?: number;
}

/** What a turn opens with: the standing context's words, and the place in the chat Luke has read through once the turn settles, where it was handed any. */
export interface TurnStanding {
  readonly text: string;
  readonly chatThrough?: number;
}

/** The turn id eve's `turn.started` event carries, read off the event a resolver is handed; nothing for any other shape. */
export function eveTurnIdOf(event: UnparsedWireValue): string | undefined {
  if (!isRecord(event) || !isRecord(event.data)) return undefined;
  return isWireString(event.data.turnId) ? event.data.turnId : undefined;
}

/**
 * The eve session a conversation's record names for this session: its own id
 * for a root session, and its root's for a subagent's child session. Note that
 * a child's tool call is admitted through its root, because eve mints a child
 * its own session id that no conversation records and hands a tool the
 * child's lineage, so the root standing as the conversation's current session
 * is what lets the call land. A resolver is handed no lineage, so a child's
 * resolvers take `admitDelegated` instead.
 */
function conversationSessionOf(session: Pick<SessionContext["session"], "id" | "parent">): string {
  return session.parent?.rootSessionId ?? session.id;
}

/** What a host function answers: an effect over the ambient client, which eve's own authored files run at the web's edge. */
type HostEffect<A> = Effect.Effect<A, QueryError | Schema.SchemaError, DatabaseServices>;

export interface BrainHost extends HostAdmission {
  /** The kind of turn the current request opened, or nothing for a request that named none. */
  turnKindOf(auth: SessionAuth): HostedTurnKind | undefined;
  /** The turn eve just started, keyed as the store keys it; nothing for a request that named no kind. */
  turnOf(auth: SessionAuth, sessionId: string, eveTurnId: string): HostedTurn | undefined;
  /** The prompt a session runs under, with the hash its turns are recorded under; the text itself is stored nowhere. */
  prompt(): HostedSessionPrompt;
  /** The standing context one turn opens with: the plan's name and saved document, as data, and what the turn was handed of the chat. */
  standingContext(admitted: AdmittedConversation): HostEffect<TurnStanding>;
  /** The conversation so far, for a session opened over a conversation with words already said; nothing otherwise. */
  seed(admitted: AdmittedConversation): HostEffect<string | undefined>;
  /** The tools every turn is offered, as declarations; the eve project binds each to `runTool`. */
  toolDeclarations(): readonly HostedToolDeclaration[];
  /** Carries one call of one declared tool under the binding the tool captured and the standing eve hands it, whose sandbox a repository read runs in. */
  runTool(
    name: string,
    binding: HostedToolBinding,
    input: UnparsedWireValue,
    context: EveToolContext,
  ): Effect.Effect<
    WireRecord,
    QueryError | Schema.SchemaError,
    DatabaseServices | HttpClient.HttpClient | GitHubApp | ModelCatalog
  >;
  /**
   * The model one inference runs on and the effort it is asked for, as a
   * coding agent's step is told its own, the meter spent for the account
   * first; or why none runs: the deployment holds no key, or names a model
   * outside the providers Luke runs.
   */
  model(admitted: AdmittedConversation): Result.Result<CoderModelSelection, string>;
  /**
   * Relays one event of a subagent's session into the child conversation of
   * the call that started it, as a child turn; a session with no parent, or
   * one the caller does not reach, relays nothing.
   */
  relayChild(
    event: MessageStreamEvent,
    session: SessionContext["session"],
    state: RelayStateStore,
  ): Effect.Effect<void, QueryError | Schema.SchemaError, DatabaseServices | HttpClient.HttpClient>;
  /**
   * A subagent's title generated from the first task it received, read from
   * the child conversation of the call that started it, and written there
   * where none stands yet; a session with no parent, one the caller does
   * not reach, a child whose first task has not landed, a deployment with no
   * title model, and a failed call each write nothing.
   */
  titleChild(session: SessionContext["session"]): HostEffect<void>;
  /**
   * The skills the plan's repository keeps, offered to the session as it
   * starts (`../agent-runtime/skills.ts`), each body saying where it stands
   * in the repository `run_in_repository` reads; none for a plan with no
   * repository, one the App does not reach, or a read that failed.
   */
  skills(
    admitted: AdmittedConversation,
  ): Effect.Effect<
    readonly AgentSkill[],
    QueryError | Schema.SchemaError,
    DatabaseServices | HttpClient.HttpClient | GitHubApp
  >;
  /**
   * Relays one event of the session's stream into the store, under the state
   * the caller keeps for the session and the prompt it composed; a turn that
   * completes marks the chat it was handed read, and one that fails or is
   * stopped leaves it unread for the next.
   */
  relay(
    event: MessageStreamEvent,
    admitted: AdmittedConversation,
    session: SessionContext["session"],
    state: RelayStateStore,
    prompt: SessionPromptRecord,
    chat: ChatHandedRecord,
  ): Effect.Effect<void, QueryError | Schema.SchemaError, DatabaseServices | HttpClient.HttpClient>;
}

/** The body a planning skill loads as: where it stands in the plan's repository, which \`run_in_repository\` reads, and then its own words. */
function brainSkillMarkdown(skill: RepositorySkill): string {
  return `This skill is \`${skill.folder}/SKILL.md\` in the task's repository; read the files it names with \`run_in_repository\`, relative to \`${skill.folder}/\`.\n\n${skill.markdown}`;
}

/** Where a child's first task is read from: before every row of its conversation. */
const FROM_THE_START: MessageCursor = { seq: 0, revision: 0 };

/** The rows a child's first task is found among: its first turn's line and that turn's journal, in whichever order the relay wrote them. */
const FIRST_TASK_ROWS = 2;

/** The first task a subagent received, the line its child conversation opened with; nothing before that line lands, or where it does not read. */
function firstTaskOf(child: ConversationTarget): HostEffect<string | undefined> {
  return Effect.map(
    listMessagesPast(
      child.userId,
      child.conversationId,
      HOSTED_TOOL_SET,
      FROM_THE_START,
      FIRST_TASK_ROWS,
    ),
    (page) => {
      if (!page.read.ok) return undefined;
      const line = page.read.value.find((record) => record.message.role === MESSAGE_ROLE.USER);
      return line?.message.parts.find(isTextUIPart)?.text;
    },
  );
}

/** The host over the deployment's seams; the research budget it keeps stands for the host's life. */
export function brainHost(seams: BrainHostSeams): BrainHost {
  const research = new ResearchBudget();
  const chatPosts = new ChatPostTally();

  /** The caller's metered model and its effort, or why none runs. */
  const modelFor = (admitted: AdmittedConversation): Result.Result<CoderModelSelection, string> => {
    const access = seams.openAi();
    if (!access) return Result.fail(BRAIN_HOST_REFUSAL.NO_MODEL);
    return brainModelSelection(access, {
      spend: () => seams.spend(admitted.caller),
      report: (message) => console.warn(message),
    });
  };

  /** The web search's access: Luke's key and the brain's model as OpenAI's own API names it; nothing without a key. */
  const researchAccess = () => {
    const access = seams.openAi();
    const named = access === undefined ? undefined : providerModelOf(access.choice.model);
    return access === undefined || named === undefined
      ? undefined
      : { apiKey: access.apiKey, modelId: named.modelId };
  };

  /** The plan the admitted conversation belongs to, as the caller reaches it now; nothing once it is deleted or out of reach. */
  const taskOf = (admitted: AdmittedConversation) =>
    Effect.map(
      readTaskOfConversation(admitted.caller, admitted.target.conversationId),
      Option.getOrUndefined,
    );

  /**
   * Relays one event of a session's stream into the conversation and turn
   * kind the caller admitted it under: the planning session's own, or a
   * subagent's child conversation.
   */
  const relayEvent = (
    event: MessageStreamEvent,
    standing: Pick<RelayStanding, "sessionId" | "target" | "turn" | "state"> & {
      readonly promptHash?: string;
    },
  ) =>
    Effect.gen(function* () {
      // The turn row names the model and effort the inferences are asked for, as a coding
      // agent's does; the fixture's own id under the scripted model, which is asked no effort.
      const choice = seams.scriptedModel() ? undefined : seams.openAi()?.choice;
      const model = seams.scriptedModel()
        ? BRAIN_HOST_MODEL_FIXTURE.SCRIPTED_MODEL_ID
        : choice?.model;
      // The tool set's hash is taken as each turn starts, from the same
      // declarations the tools resolver hands eve, so the hash names what
      // the model is offered and not a list kept beside it.
      const toolSetHash =
        event.type === "turn.started" ? toolSetHashOf(brainToolDeclarations()) : undefined;
      const writer = yield* seams.writer();
      const eve = yield* eveSessionsComposer;
      const relay = new StreamRelay({
        writer,
        asks: {
          binding: askRecord(),
          // A Stop an ask took while it waited is carried the moment its turn starts, by the
          // deployment acting for the account, since the hook that sees the start holds no bearer
          // of the account's; a deployment with no secret or no origin for eve reports the Stop it
          // could not carry.
          stopTurn: (target, sessionId, eveTurnId, turnId) =>
            Effect.suspend(() => {
              const secret = seams.deploymentSecret();
              const origin = seams.eveOrigin();
              if (secret === undefined || origin === undefined) {
                return Effect.logWarning(
                  `The Stop on turn ${eveTurnId} of session ${sessionId} could not be carried.`,
                );
              }
              return carryStop(
                {
                  eve: eve({ origin, caller: { secret, account: target.userId } }),
                  writer,
                  now: seams.now,
                  report: (message) => console.warn(message),
                },
                target,
                sessionId,
                eveTurnId,
                turnId,
              );
            }),
        },
        now: seams.now,
        report: (message) => console.warn(message),
      });
      yield* relay.handle(event, {
        ...standing,
        ...(model !== undefined ? { model } : undefined),
        ...(choice !== undefined ? { reasoningEffort: choice.effort } : undefined),
        ...(toolSetHash !== undefined ? { toolSetHash } : undefined),
      });
    });

  return {
    ...hostAdmission(seams.now),

    turnKindOf(auth) {
      const kind = turnKindOf(auth.current);
      return kind === undefined ? undefined : { kind, trigger: BRAIN_HOST_TURN_KIND[kind].trigger };
    },

    turnOf(auth, sessionId, eveTurnId) {
      const kind = turnKindOf(auth.current);
      if (kind === undefined) return undefined;
      return {
        kind,
        trigger: BRAIN_HOST_TURN_KIND[kind].trigger,
        turnId: hostTurnId(sessionId, eveTurnId),
      };
    },

    prompt: () => ({ text: BRAIN_INSTRUCTIONS, hash: promptHashOf(BRAIN_INSTRUCTIONS) }),

    standingContext: (admitted) =>
      Effect.gen(function* () {
        const task = yield* taskOf(admitted);
        const board =
          task === undefined ? Option.none() : yield* readBoard(admitted.caller, task.task.id);
        // Read as the turn opens and marked read once it settles (`relay`), so a turn that fails
        // hands the next the same lines.
        const chat =
          task === undefined
            ? { messages: [], more: false }
            : yield* chatSince(admitted.caller, task.task.id);
        const text = brainStandingContext(
          task,
          Option.getOrElse(board, () => EMPTY_BOARD),
          chat,
          seams.now(),
        );
        return chat.through === undefined ? { text } : { text, chatThrough: chat.through };
      }),

    seed: (admitted) =>
      Effect.map(
        readRecentMessages(admitted.target, HOSTED_TOOL_SET, BRAIN_HOST.SEED_MESSAGES),
        (recent) => rotationSeedText(recent, seams.now()),
      ),

    toolDeclarations: () => brainToolDeclarations(),

    runTool: (name, binding, input, context) =>
      Effect.gen(function* () {
        // Admitted again as the call runs, not only as the tools were resolved:
        // a conversation that rotated to a newer session mid-turn refuses the
        // old session's calls here, so no effect lands without a turn record.
        const standing = yield* admitConversation(context.session.auth, {
          id: conversationSessionOf(context.session),
          standing: SESSION_STANDING.CURRENT,
        });
        if (Result.isFailure(standing)) {
          return { status: ACTION_RESULT_STATUS.REJECTED, reason: standing.failure };
        }
        // The plan is found again as the call runs, so a plan deleted mid-turn saves nothing.
        // The caller is who acts: the plan, its repository, the research meter, and the agents are
        // reached and paid for as the member speaking, whoever opened the conversation.
        const { caller } = standing.success;
        const task = yield* taskOf(standing.success);
        // A message to a coding agent reaches its session as the deployment acting for the
        // caller, as a Stop does above: the planning session holds no bearer of the caller's.
        const secret = seams.deploymentSecret();
        const origin = seams.eveOrigin();
        const eve = yield* eveSessionsComposer;
        const coder =
          secret === undefined || origin === undefined
            ? undefined
            : eve({ origin, caller: { secret, account: caller }, mount: EVE_MOUNT.CODER });
        // A chat notice reaches an agent's session as the deployment acting for the account that
        // started it, each notice minted for that starter; nothing where the deployment reaches no eve.
        const eveFor = (starter: string) =>
          secret === undefined || origin === undefined
            ? undefined
            : eve({ origin, caller: { secret, account: starter }, mount: EVE_MOUNT.CODER });
        // A message to another plan's Luke wakes it on its planning brain, as the deployment for the caller.
        const brainEveFor = (account: string) =>
          secret === undefined || origin === undefined
            ? undefined
            : eve({ origin, caller: { secret, account } });
        return yield* runBrainTool(
          name,
          task === undefined
            ? undefined
            : {
                task: { userId: caller, taskId: task.task.id },
                // The repository as the row holds it now, so a plan given one mid-conversation reads it on its next call.
                repository: {
                  task: { userId: caller, taskId: task.task.id },
                  repository: task.task.repository,
                  sandbox: () => context.getSandbox(),
                },
                research: {
                  turnId: binding.turn.turnId,
                  budget: research,
                  openAi: researchAccess(),
                  spend: Effect.tryPromise({
                    try: () => seams.spend(caller),
                    catch: (cause) => new MeterUnavailable({ cause }),
                  }),
                },
                agents: {
                  caller: {
                    kind: AGENT_CALLER.LUKE,
                    plan: { userId: caller, taskId: task.task.id },
                  },
                  eve: coder,
                  writer: seams.writer(),
                  clientKey: context.callId,
                },
                // Luke reaches the chat on the standing of the member speaking.
                chat: {
                  luke: {
                    ...lukeOn(caller, task.task.id),
                    repository: task.task.repository,
                    telling: { eveFor, writer: seams.writer(), doors: wakingDoors(brainEveFor) },
                  },
                  clientKey: context.callId,
                  turnId: binding.turn.turnId,
                  tally: chatPosts,
                  sandbox: () => context.getSandbox(),
                },
              },
          input,
        );
      }),

    model: (admitted) => modelFor(admitted),

    relay: (event, admitted, session, state, prompt, chat) =>
      Effect.gen(function* () {
        yield* relayEvent(event, {
          sessionId: session.id,
          target: admitted.target,
          turn: turnKindOf(session.auth.current),
          state,
          ...(prompt.hash !== undefined ? { promptHash: prompt.hash } : undefined),
        });
        // Only the turn the chat was handed to, and only once it completed, marks it read.
        if (event.type !== "turn.completed" || event.data.turnId !== chat.eveTurnId) return;
        const task = yield* taskOf(admitted);
        if (task === undefined || chat.through === undefined) return;
        yield* chatTakenIn(admitted.caller, task.task.id, chat.through);
      }),

    relayChild: (event, session, state) =>
      Effect.gen(function* () {
        const found = yield* delegatedChildOf(session);
        if (Option.isNone(found)) return;
        const { parent, child } = found.value;
        // The child conversation is opened as each of its turns starts, so a start the store
        // missed is opened by the next, and every event after finds it standing.
        if (event.type === "turn.started") {
          yield* openChildConversation(parent, child.conversationId, EVE_DELEGATION_TOOL.WORKER);
        }
        yield* relayEvent(event, {
          sessionId: session.id,
          target: child,
          turn: RELAY_TURN.CHILD,
          state,
        });
      }),

    skills: (admitted) =>
      Effect.gen(function* () {
        const task = yield* taskOf(admitted);
        const repository = task?.task.repository ?? null;
        if (task === undefined || repository === null) return [];
        // The repository is read through the plan's workspace installation, as every planning read of it is.
        return yield* repositorySkills(
          { userId: admitted.caller, conversationId: admitted.target.conversationId },
          taskWorkspace(admitted.caller, task.task.id),
          repository,
          brainSkillMarkdown,
        );
      }),

    titleChild: (session) =>
      Effect.gen(function* () {
        const found = yield* delegatedChildOf(session);
        if (Option.isNone(found)) return;
        const { caller, parent, child } = found.value;
        // The title is metered to the member the worker acts for, as the planner's own steps are.
        const model = seams.titleModel(caller);
        if (model === undefined) return;
        // Note that the task named is the child's first, whichever task woke this, because a
        // later task's call racing the first one's must not name the worker for the later.
        const task = yield* firstTaskOf(child);
        if (task === undefined) return;
        yield* titleSubagent(model, parent, child.conversationId, task);
      }),
  };
}
