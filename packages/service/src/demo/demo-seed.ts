import type { DB } from "@better-auth/drizzle-adapter";
import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { type Agent, createAgent } from "@repo/database/models/agent-store";
import { enrollOwnDevice } from "@repo/database/models/host-store";
import {
  actOnDescriptionCommentThread,
  DESCRIPTION_COMMENT_OUTCOME,
  type DescriptionCommentOutcome,
  type DescriptionCommentWriterRef,
  startDescriptionCommentThread,
} from "@repo/database/models/description-comments";
import { writePage } from "@repo/database/models/task-pages";
import { parseKeyRing, sealProviderKey } from "@repo/database/models/provider-key-seal";
import { saveProviderKey, setProviderKeyForAgents } from "@repo/database/models/provider-key-store";
import { keepRunsOnPick } from "@repo/database/models/runs-on-pick";
import {
  addTaskBlock,
  type TaskBlockAcrossWorkspaces,
  type TaskBlockCycle,
  type TaskBlockSelf,
} from "@repo/database/models/task-block-store";
import {
  createTaskOnce,
  saveDescriptionText,
  type TaskAssigneeNotMember,
  type TaskTreeRepositoryLocked,
  updateTask,
} from "@repo/database/models/task-store";
import { type WorkspaceSeams, workspaceSeams } from "@repo/database/models/workspace-seams";
import { createWorkspace, ensurePersonalWorkspace } from "@repo/database/models/workspace-store";
import {
  type ConversationTarget,
  type LineSender,
  type StoreWriter,
  storeWriter,
} from "@repo/database/models/writer";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { AGENT_MACHINE, type AgentMachineKind, MESSAGE_SENDER } from "@repo/features/agent-wire";
import { HOST_WIRE } from "@repo/features/host-wire";
import { INBOX_REPLY, openAskOf } from "@repo/features/inbox-wire";
import { PAGE_OWNER, PAGE_SHOWER } from "@repo/features/page-wire";
import {
  DESCRIPTION_COMMENT_ACTION,
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_SCOPE,
} from "@repo/features/description-comment-wire";
import { type PROVIDER_KEY_KIND, PROVIDER_KEY_PROVIDER } from "@repo/features/provider-key-wire";
import { DESCRIPTION_ACTOR, TASK_STATUS, type TaskOrigin } from "@repo/features/task-wire";
import { ACTION_RESULT_STATUS, MESSAGE_CHANNEL, START_LINE_BRIEF } from "@repo/wire";
import { sentLineId } from "@repo/wire/host-ids";
import { betterAuth } from "better-auth";
import { admin, organization as organizationPlugin } from "better-auth/plugins";
import { type Cause, Clock, Data, Effect, Option, type Redacted, Result } from "effect";
import { agentRuntimeChoice } from "../agents/coder-host/agent-runtime-choice.js";
import { agentLineSender } from "../agents/coder-host/steer.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { authDatabaseAdapter } from "../auth/auth-database.js";
import { ADMIN_OPTIONS, ORGANIZATION_OPTIONS } from "../auth/auth-policy.js";
import { HOST_VERSION, type MintedSecret, mintHostSecret } from "../auth/device-secret.js";
import {
  RUN_EVENT,
  RUN_STATUS,
  RUN_TURN_ORIGIN,
  type RunEvent,
  type RunEventBody,
  sessionKey,
  TOOL_CALL_SETTLEMENT,
  TURN_ORIGIN,
  TURN_TRIGGER,
} from "../core.js";
import {
  acknowledgeInboxItem,
  answerInboxAsk,
  INBOX_ASK_ANSWER,
  type InboxAgent,
  postInboxMessage,
  postInboxThread,
  replyInboxItem,
  startInboxThread,
} from "../inbox/inbox-store.js";
import { providerKeyHint } from "../providers/provider-key-check.js";
import {
  DEMO_AGENTS,
  DEMO_BLOCKS,
  DEMO_DEAN,
  DEMO_HOST,
  DEMO_ID_KIND,
  DEMO_JOINED_AGO,
  DEMO_MEMBER_THREADS,
  DEMO_MINUTE,
  DEMO_PEOPLE,
  DEMO_TASKS,
  DEMO_THREADS,
  DEMO_WORKSPACE_NAME,
  type DemoAgent,
  type DemoCall,
  type DemoCommentWords,
  type DemoIdKind,
  type DemoPage,
  type DemoPerson,
  type DemoTask,
  type DemoThread,
  type DemoToolCall,
  type DemoTurn,
  demoId,
} from "./demo-world.js";

/**
 * demo-seed.ts -- the demo's seed: the acme world (`demo-world.ts`) written into a freshly migrated database through the store's own models, with Dean's model credential and his host on this Mac where the run hands them in.
 *
 * `run.sh --demo` signs in as `DEMO_DEAN` and opens on what this writes:
 * Dean's own workspace and acme beside it, with seven teammates as
 * members; twenty-one tasks across every status and priority, one broken
 * into sub-tasks and some waiting on others, each with a description and comments
 * on it, open, answered, and resolved; eight finished coding agents of
 * Dean's with their transcripts, a pilot and the agents it started among
 * them, on his host where the run starts one, and the pages they showed;
 * and their threads and his teammates', with an Inbox of ten waiting on
 * Dean beside those he and they settled.
 *
 * How to run it: `DATABASE_URL=<a Postgres on loopback> pnpm --filter
 * @repo/web demo:seed` (`apps/web/server/demo-seed.ts`), once the database
 * is migrated and `auth:seed` has run. It refuses any database that is not
 * on loopback (`demo-database.ts`). Where `APP_DEMO_CLAUDE_TOKEN` (a
 * `claude setup-token`) or `APP_DEMO_ANTHROPIC_API_KEY` is set, it is saved
 * as Dean's, for his agents, sealed under `PROVIDER_KEY_ENCRYPTION_KEYS`,
 * which the local server must then be handed too, or it cannot open it. The
 * token is never logged, written to a fixture, or traced: it goes from the
 * environment to its sealed row alone. Where the run starts a host on this
 * Mac for Dean (`APP_DEMO_HOST_STATE`), it is enrolled as his own under
 * `DEMO_HOST`'s id, and every agent runs there, kept as his last pick, the
 * seeded ones among them, so a follow-up to one runs on the
 * Mac. Note that Dean started every agent, those on his teammates' tasks
 * and those his pilot started too, because a host runs its owner's agents
 * alone, and an agent on a host takes words from its starter alone
 * (`agent-reach.ts`'s `controlsAgent`).
 *
 * Every write goes through the model a route writes through, so the seed
 * keeps up with the schema. Users are Better Auth's own rows, made by its
 * internal adapter, and workspaces and members its organization plugin's,
 * on a Better Auth of the seed's own (`demoAuth`) whose id generator counts
 * up from fixed ids, so two seeds of two fresh databases write the same
 * accounts, workspaces, members, and tasks. Note that the agents, their
 * messages, the pages, the threads, and the comments take the ids their
 * models mint, because no model takes one from its caller, and a demo run
 * starts from an empty profile that holds none of them.
 *
 * Each write runs under a clock standing at its own instant, counted back
 * from the seed's start, since every model stamps its rows from the clock:
 * the world reads minutes, hours, and days old whenever it is seeded.
 */

/** The secret the seed's Better Auth is built with; it seals and signs nothing, since the seed mints no session or token. */
const SEED_AUTH_SECRET = "demo-seed-better-auth-signs-nothing-with-this";

/** What a step of the seed was refused, where a model answered that it wrote nothing. */
export class DemoSeedRefused extends Data.TaggedError("DemoSeedRefused")<{
  readonly step: string;
}> {
  override get message(): string {
    return `The demo seed wrote nothing for ${this.step}`;
  }
}

/** The writes the seed makes through Better Auth: an account, a workspace, and a member of it. */
export interface DemoAuth {
  /** How many accounts the database holds already. */
  readonly countUsers: Effect.Effect<number, Cause.UnknownError>;
  readonly createUser: (person: DemoPerson, at: Date) => Effect.Effect<void, Cause.UnknownError>;
  readonly workspaces: WorkspaceSeams;
  /** The person added to the workspace in their role, answering the member's id. */
  readonly addMember: (
    organizationId: string,
    person: DemoPerson,
  ) => Effect.Effect<string, Cause.UnknownError>;
}

/** The demo's model credential: the kind of Anthropic credential it is, the credential, and the ring the local server opens it under. */
export interface DemoCredential {
  readonly kind: typeof PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN | typeof PROVIDER_KEY_KIND.API_KEY;
  readonly key: Redacted.Redacted<string>;
  readonly ring: Redacted.Redacted;
}

/** The host the run starts on this Mac for Dean's agents, by the hash of the device secret its record holds (`demoHostSecret`). */
export interface DemoHost {
  readonly secretHash: string;
}

/** The ids of what the seed wrote that it chose itself, the same for every seed of a fresh database. */
export interface DemoSeeded {
  readonly deanId: string;
  readonly personalWorkspaceId: string;
  readonly workspaceId: string;
  readonly memberIds: readonly string[];
  readonly taskIds: readonly string[];
}

/** Where the seed's agents run: Dean's host, or the cloud where there is none. */
interface DemoPlace {
  readonly machine: AgentMachineKind;
  readonly deviceId: string | undefined;
}

const DEMO_IN_THE_CLOUD: DemoPlace = { machine: AGENT_MACHINE.VERCEL, deviceId: undefined };

/** Every way the seed fails: a refused step, Better Auth's own failure, or the store's. */
type DemoSeedEffect<A> = Effect.Effect<
  A,
  | DemoSeedRefused
  | Cause.UnknownError
  | StoreFailure
  | TaskAssigneeNotMember
  | TaskTreeRepositoryLocked
  | TaskBlockSelf
  | TaskBlockAcrossWorkspaces
  | TaskBlockCycle,
  DatabaseServices
>;

/** The kind of fixed id Better Auth mints for each model it writes the seed's rows of. */
const AUTH_ID_KIND: Readonly<Record<string, DemoIdKind>> = {
  user: DEMO_ID_KIND.USER,
  organization: DEMO_ID_KIND.ORGANIZATION,
  member: DEMO_ID_KIND.MEMBER,
};

/**
 * A Better Auth over the database, with the admin plugin, which writes
 * each account's role, and the organization plugin, as the deployment's
 * (`auth.ts`), whose ids count up from
 * one for each kind. Note that Dean's and his teammates' ids are handed in
 * (`DEMO_PEOPLE`), which the internal adapter keeps; the generator mints
 * the workspaces' and the members', in the order the seed writes them.
 */
export function demoAuth(database: DB): DemoAuth {
  const minted = new Map<DemoIdKind, number>();
  const generateId = ({ model }: { readonly model: string }) => {
    const kind = AUTH_ID_KIND[model] ?? DEMO_ID_KIND.AUTH_ROW;
    const next = (minted.get(kind) ?? 0) + 1;
    minted.set(kind, next);
    return demoId(kind, next);
  };
  const auth = betterAuth({
    database: authDatabaseAdapter(database),
    baseURL: "http://127.0.0.1",
    secret: SEED_AUTH_SECRET,
    advanced: { database: { generateId } },
    plugins: [admin(ADMIN_OPTIONS), organizationPlugin(ORGANIZATION_OPTIONS)],
  });
  return {
    countUsers: Effect.tryPromise(async () =>
      (await auth.$context).internalAdapter.countTotalUsers(),
    ),
    createUser: (person, at) =>
      Effect.tryPromise(async () => {
        const context = await auth.$context;
        await context.internalAdapter.createUser(
          {
            id: person.id,
            name: person.name,
            email: person.email,
            emailVerified: true,
            createdAt: at,
            updatedAt: at,
          },
          { method: "admin" },
        );
      }),
    workspaces: workspaceSeams(auth.api),
    addMember: (organizationId, person) =>
      Effect.map(
        Effect.tryPromise(() =>
          auth.api.addMember({ body: { userId: person.id, organizationId, role: person.role } }),
        ),
        (added) => added.id,
      ),
  };
}

/** A clock standing still at the instant given, which every row written under it is stamped with; it sleeps on the clock it stands in for. */
function clockAt(at: number, real: Clock.Clock): Clock.Clock {
  const nanos = BigInt(at) * 1_000_000n;
  return {
    currentTimeMillisUnsafe: () => at,
    currentTimeMillis: Effect.succeed(at),
    currentTimeNanosUnsafe: () => nanos,
    currentTimeNanos: Effect.succeed(nanos),
    monotonicTimeNanosUnsafe: () => real.monotonicTimeNanosUnsafe(),
    monotonicTimeNanos: real.monotonicTimeNanos,
    sleep: (duration) => real.sleep(duration),
  };
}

/** The seed's instants, counted back from its start. */
interface SeedClock {
  readonly start: number;
  /** The write run under a clock standing `ago` milliseconds before the start. */
  readonly ago: <A, E, R>(ago: number, write: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}

const seedClock = Effect.gen(function* () {
  const real = yield* Clock.Clock;
  const start = real.currentTimeMillisUnsafe();
  const clock: SeedClock = {
    start,
    ago: (ago, write) => Effect.provideService(write, Clock.Clock, clockAt(start - ago, real)),
  };
  return clock;
});

/** The value a step wrote, or the step refused by name where its model wrote nothing. */
function written<A>(step: string, outcome: Option.Option<A> | Result.Result<A, unknown>) {
  const value = Option.isOption(outcome) ? outcome : Result.getSuccess(outcome);
  return Option.match(value, {
    onNone: () => Effect.fail(new DemoSeedRefused({ step })),
    onSome: Effect.succeed,
  });
}

/** The keys a member's writes are taken under, counted up, so a seed takes the same keys each time. */
function clientKeys(): () => string {
  let taken = 0;
  return () => {
    taken += 1;
    return demoId(DEMO_ID_KIND.CLIENT_KEY, taken);
  };
}

/** Every call an agent's steps made, in the order its transcript makes them. */
function callsOf(agent: DemoAgent): readonly DemoCall[] {
  return agent.turns.flatMap((turn) =>
    turn.steps.flatMap((step) => (step.call === undefined ? [] : [step.call])),
  );
}

/** The sub-tasks the agent made, as its steps make them. */
function tasksMadeBy(agent: DemoAgent): readonly DemoTask[] {
  return callsOf(agent).flatMap((call) => ("creates" in call ? [call.creates] : []));
}

/** The agent whose steps started this one, where another did; none for one Dean started himself. */
function starterOf(agent: DemoAgent): DemoAgent | undefined {
  return DEMO_AGENTS.find((other) =>
    callsOf(other).some((call) => "starts" in call && call.starts === agent),
  );
}

/* ----- The people and the workspaces ----- */

/**
 * Every person's account, Dean's own workspace, and acme with everyone in
 * it; the workspaces' and members' ids. Note that a database holding any
 * account is refused before anything is written, because the seed is for a
 * fresh one, and an account there is someone's rather than the demo's.
 */
function seedPeople(auth: DemoAuth, clock: SeedClock) {
  return Effect.gen(function* () {
    if ((yield* auth.countUsers) > 0) {
      return yield* Effect.fail(new DemoSeedRefused({ step: "a database that holds accounts" }));
    }
    const joined = new Date(clock.start - DEMO_JOINED_AGO);
    for (const person of DEMO_PEOPLE) yield* auth.createUser(person, joined);
    const personal = yield* clock.ago(
      DEMO_JOINED_AGO,
      ensurePersonalWorkspace(DEMO_DEAN.id, auth.workspaces),
    );
    const personalWorkspaceId = yield* written("Dean's own workspace", personal);
    const workspaceId = yield* clock.ago(
      DEMO_JOINED_AGO,
      createWorkspace(DEMO_DEAN.id, DEMO_WORKSPACE_NAME, auth.workspaces),
    );
    const memberIds: string[] = [];
    for (const person of DEMO_PEOPLE) {
      if (person.id !== DEMO_DEAN.id) memberIds.push(yield* auth.addMember(workspaceId, person));
    }
    return { personalWorkspaceId, workspaceId, memberIds };
  });
}

/* ----- The tasks ----- */

/** The thread a comment started, answered as it stands, or the comment refused. */
function threadOf(step: string, outcome: DescriptionCommentOutcome) {
  if (outcome.status !== DESCRIPTION_COMMENT_OUTCOME.DONE || !("thread" in outcome.answer)) {
    return Effect.fail(new DemoSeedRefused({ step }));
  }
  return Effect.succeed(outcome.answer.thread);
}

/**
 * One comment thread on the task's description, started by its writer on the words
 * it quotes, the replies under it a minute apart, and resolved where it
 * stands resolved.
 */
function seedComment(
  task: DemoTask,
  writer: DescriptionCommentWriterRef,
  comment: DemoCommentWords,
  clock: SeedClock,
  key: () => string,
) {
  return Effect.gen(function* () {
    const from = task.description.indexOf(comment.quote);
    const started = yield* clock.ago(
      comment.ago,
      startDescriptionCommentThread(writer, task.id, {
        clientKey: key(),
        scope: DESCRIPTION_COMMENT_SCOPE.WORDS,
        quote: comment.quote,
        anchor: { from, to: from + comment.quote.length },
        text: task.description,
        words: comment.words,
      }),
    );
    const thread = yield* threadOf(`a comment on ${task.name}`, started);
    const member = (person: DemoPerson) =>
      ({ actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, userId: person.id }) as const;
    for (const [index, reply] of comment.replies.entries()) {
      const replied = yield* clock.ago(
        comment.ago - (index + 1) * DEMO_MINUTE,
        actOnDescriptionCommentThread(member(reply.by), task.id, thread.id, {
          action: DESCRIPTION_COMMENT_ACTION.REPLY,
          clientKey: key(),
          words: reply.words,
        }),
      );
      yield* threadOf(`a reply on ${task.name}`, replied);
    }
    if (comment.resolved === undefined) return;
    const resolved = yield* clock.ago(
      comment.resolved.ago,
      actOnDescriptionCommentThread(member(comment.resolved.by), task.id, thread.id, {
        action: DESCRIPTION_COMMENT_ACTION.RESOLVE,
      }),
    );
    yield* threadOf(`a comment resolved on ${task.name}`, resolved);
  });
}

/**
 * The task under its fixed id, made by its maker, or by the agent named,
 * under its parent and assigned, its description saved, and the comments on it; one that is done or canceled
 * stands to do until it is moved there.
 */
function seedTask(
  workspaceId: string,
  task: DemoTask,
  origin: TaskOrigin | undefined,
  clock: SeedClock,
  key: () => string,
) {
  return Effect.gen(function* () {
    const made = yield* clock.ago(
      task.createdAgo,
      createTaskOnce(task.creator.id, {
        id: task.id,
        organizationId: workspaceId,
        name: task.name,
        status: task.settledAgo === undefined ? task.status : TASK_STATUS.TODO,
        priority: task.priority,
        assigneeId: task.assignee.id,
        text: "",
        ...(task.parent === undefined ? undefined : { parentTaskId: task.parent.id }),
        ...(origin === undefined ? undefined : { origin }),
      }),
    );
    yield* written(task.name, made);
    const saved = yield* clock.ago(
      task.savedAgo,
      saveDescriptionText(task.creator.id, task.id, task.description),
    );
    yield* written(`${task.name}'s description`, saved);
    for (const comment of task.comments) {
      const writer = { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, userId: comment.by.id } as const;
      yield* seedComment(task, writer, comment, clock, key);
    }
    if (task.settledAgo === undefined) return task.id;
    const settled = yield* clock.ago(
      task.settledAgo,
      updateTask(task.assignee.id, task.id, { status: task.status }),
    );
    yield* written(`${task.name} moved to ${task.status}`, settled);
    return task.id;
  });
}

/** Every block between the tasks, added by the member who said so. */
function seedBlocks(clock: SeedClock) {
  return Effect.forEach(DEMO_BLOCKS, (block) =>
    Effect.flatMap(
      clock.ago(
        block.ago,
        addTaskBlock(block.by.id, {
          blockerTaskId: block.blocker.id,
          blockedTaskId: block.blocked.id,
        }),
      ),
      (added) => written(`${block.blocker.name} blocking ${block.blocked.name}`, added),
    ),
  );
}

/* ----- The agents ----- */

/** What the seed wrote that a transcript's calls name: each agent's row, and each page's id. */
interface SeedWritten {
  readonly agents: ReadonlyMap<DemoAgent, Agent>;
  readonly pages: ReadonlyMap<DemoPage, string>;
}

/** A call of one of our workspace tools as it was answered, from what it wrote: a sub-task, an agent started, a page shown, or a thread posted. */
function toolCallOf(call: DemoCall, seeded: SeedWritten): DemoToolCall {
  const accepted = { status: ACTION_RESULT_STATUS.ACCEPTED };
  if ("creates" in call) {
    const task = call.creates;
    return {
      name: AGENT_TOOL.CREATE_TASK,
      input: {
        name: task.name,
        priority: task.priority,
        ...(task.parent === undefined ? undefined : { parentTaskId: task.parent.id }),
      },
      output: { ...accepted, task: { id: task.id, name: task.name } },
    };
  }
  if ("starts" in call) {
    const agent = call.starts;
    const row = seeded.agents.get(agent);
    return {
      name: AGENT_TOOL.START_AGENT,
      input: {
        taskId: agent.task.id,
        title: agent.title,
        prompt: agent.turns[0].line,
        model: agent.model,
        effort: agent.effort,
      },
      output: {
        ...accepted,
        agent: { ...(row === undefined ? undefined : { id: row.id }), title: agent.title },
      },
    };
  }
  if ("page" in call) {
    const { title, path } = call.page;
    const id = seeded.pages.get(call.page);
    return {
      name: AGENT_TOOL.SHOW_PAGE,
      input: { title, path },
      output: { ...accepted, page: { ...(id === undefined ? undefined : { id }), version: 1 } },
    };
  }
  if ("posts" in call) {
    const { key, title, body, ask } = call.posts;
    return {
      name: AGENT_TOOL.POST_THREAD,
      input: { key, title, body, ...(ask === undefined ? undefined : { ask }) },
      output: accepted,
    };
  }
  return call;
}

/** A turn's events, as Claude Code's runner reports them: each step's words, then its tool call, and the turn's end and usage. */
function turnEvents(
  agent: DemoAgent,
  turn: DemoTurn,
  turnIndex: number,
  conversationId: string,
  startedAt: number,
  seeded: SeedWritten,
): RunEvent[] {
  const base = { conversationId: sessionKey(conversationId), turnId: turn.id };
  const bodies: RunEvent[] = [];
  const add = (body: RunEventBody) =>
    bodies.push({ ...body, ...base, sequence: bodies.length + 1 });
  add({
    kind: RUN_EVENT.TURN_STARTED,
    origin: RUN_TURN_ORIGIN.TYPED,
    trigger: TURN_TRIGGER.ASK,
    at: startedAt,
  });
  for (const [index, step] of turn.steps.entries()) {
    const number = index + 1;
    add({ kind: RUN_EVENT.STEP_STARTED, step: number });
    if (step.text !== "") add({ kind: RUN_EVENT.TEXT_DRAFTED, step: number, text: step.text });
    if (step.call === undefined) continue;
    const callId = demoId(DEMO_ID_KIND.TOOL_CALL, turnIndex * 100 + number);
    const { name, input, output } = toolCallOf(step.call, seeded);
    add({ kind: RUN_EVENT.TOOL_CALL_STARTED, callId, name, input });
    add({
      kind: RUN_EVENT.TOOL_CALL_SETTLED,
      callId,
      name,
      settlement: { state: TOOL_CALL_SETTLEMENT.OUTPUT_AVAILABLE, output },
    });
  }
  const usage = {
    inputTokens: turn.tokens.input,
    outputTokens: turn.tokens.output,
    cachedInputTokens: turn.tokens.cached,
    reasoningTokens: 0,
  };
  add({
    kind: RUN_EVENT.TURN_ENDED,
    status: RUN_STATUS.SUCCEEDED,
    usage,
    usageByModel: [{ model: agent.model, ...usage }],
    responseIds: [],
    at: startedAt + turn.ranFor,
  });
  return bodies;
}

/** A store writer's answer, or the step refused by name where it refused the write. */
function landed<A, E>(step: string, result: Result.Result<A, E>) {
  return Result.isFailure(result) ? Effect.fail(new DemoSeedRefused({ step })) : Effect.void;
}

/**
 * One turn, as a Start's first line or a member's later one opens it: the
 * line written awaiting, sent by its member or, for a Start's, by the
 * agent that started it, the turn queued and taking it, and every event of
 * it written, ending settled, so the agent reads finished.
 */
function seedTurn(
  agent: DemoAgent,
  [turnIndex, turn]: readonly [number, DemoTurn],
  writer: StoreWriter,
  row: Agent,
  seeded: SeedWritten,
  clock: SeedClock,
) {
  const write = Effect.gen(function* () {
    const step = `${agent.title}'s turn ${turnIndex + 1}`;
    const target: ConversationTarget = { userId: row.userId, conversationId: row.conversationId };
    const opening =
      turnIndex === 0
        ? { channel: MESSAGE_CHANNEL.START, brief: START_LINE_BRIEF.PROMPT }
        : undefined;
    const starter = turnIndex === 0 ? starterOf(agent) : undefined;
    const starterRow = starter === undefined ? undefined : seeded.agents.get(starter);
    const sender: LineSender =
      starterRow === undefined
        ? { kind: MESSAGE_SENDER.MEMBER, userId: turn.from.id }
        : agentLineSender(starterRow);
    const line = { text: turn.line, clientKey: turn.id, sender, metadata: opening };
    yield* landed(step, yield* writer.writeAwaitingLine(target, line, Effect.succeed(true)));
    const enqueue = {
      turnId: turn.id,
      eveTurnId: turn.id,
      origin: TURN_ORIGIN.TYPED,
      model: agent.model,
      reasoningEffort: agent.effort,
    };
    yield* landed(step, yield* writer.enqueueTurn(target, enqueue));
    const take = { clientId: sentLineId(turn.id), turnId: turn.id };
    yield* landed(step, yield* writer.takeAwaitingLine(target, take));
    const events = turnEvents(
      agent,
      turn,
      turnIndex,
      target.conversationId,
      clock.start - turn.startedAgo,
      seeded,
    );
    for (const result of yield* writer.consumeAll(target, events)) yield* landed(step, result);
  });
  return clock.ago(turn.startedAgo, write);
}

/**
 * The runtime and payer a Start of the model by the member records
 * (`start.ts`'s `startRuntimeOf`): the member's saved credential, on a host
 * as in the cloud. Note that one with no credential to pay, which a Start
 * refuses, records Claude Code with no payer, as an agent from before
 * payers does, because a seeded agent finished and stands; its next turn
 * is paid for by what pays as it launches (`claude-code-sessions.ts`).
 */
function seededRuntime(userId: string, model: string) {
  return Effect.catchTag(agentRuntimeChoice(userId, model), "AgentCredentialMissing", () =>
    Effect.succeed({ runtime: CONVERSATION_RUNTIME.CLAUDE_CODE, payer: undefined }),
  );
}

/**
 * One finished agent's row on its task, started by whoever sent its first
 * line, and by the agent whose steps started it where one did, of its kind,
 * running where `place` names and paid for as a Start there
 * records it. Its transcript is written once every agent stands, since a
 * pilot's names the agents it started.
 */
function seedAgent(
  agent: DemoAgent,
  starter: Agent | undefined,
  place: DemoPlace,
  clock: SeedClock,
) {
  return Effect.gen(function* () {
    const [first] = agent.turns;
    const { runtime, payer } = yield* seededRuntime(first.from.id, agent.model);
    const started = yield* clock.ago(
      first.startedAgo,
      createAgent(first.from.id, {
        taskId: agent.task.id,
        ...(agent.kind === undefined ? undefined : { kind: agent.kind }),
        descriptionSnapshot: null,
        prompt: first.line,
        idempotencyKey: agent.key,
        startedByAgentId: starter?.id,
        model: agent.model,
        effort: agent.effort,
        repository: null,
        title: agent.title,
        runtime,
        payer,
        machine: place.machine,
        deviceId: place.deviceId,
      }),
    );
    const { agent: row } = yield* written(agent.title, started);
    return row;
  });
}

/**
 * The pages the agent's steps showed, on its task as shown by it, each at
 * the moment its turn reached it a minute apart; each page's id.
 */
function seedPages(agent: DemoAgent, row: Agent, clock: SeedClock) {
  return Effect.gen(function* () {
    const ids = new Map<DemoPage, string>();
    for (const turn of agent.turns) {
      for (const [index, step] of turn.steps.entries()) {
        if (step.call === undefined || !("page" in step.call)) continue;
        const { page } = step.call;
        const shown = yield* clock.ago(
          turn.startedAgo - (index + 1) * DEMO_MINUTE,
          writePage(
            row.userId,
            { kind: PAGE_OWNER.TASK, taskId: agent.task.id },
            { title: page.title, html: page.html },
            { kind: PAGE_SHOWER.AGENT, agentId: row.id },
          ),
        );
        ids.set(page, (yield* written(`${agent.title}'s page ${page.title}`, shown)).id);
      }
    }
    return ids;
  });
}

/**
 * Every agent: its row, then the sub-tasks its steps made, under its id,
 * so the agents started on them find them; then the blocks between the
 * tasks, and each agent's pages and transcript, and the comments it
 * started on its task's description. Answers each agent's row and the sub-tasks'
 * ids.
 */
function seedAgents(
  workspaceId: string,
  place: DemoPlace,
  writer: StoreWriter,
  clock: SeedClock,
  key: () => string,
) {
  return Effect.gen(function* () {
    const agents = new Map<DemoAgent, Agent>();
    const madeIds: string[] = [];
    for (const agent of DEMO_AGENTS) {
      const starter = starterOf(agent);
      const starterRow = starter === undefined ? undefined : agents.get(starter);
      const row = yield* seedAgent(agent, starterRow, place, clock);
      agents.set(agent, row);
      const origin = { actor: DESCRIPTION_ACTOR.AGENT, agentId: row.id } as const;
      for (const task of tasksMadeBy(agent)) {
        madeIds.push(yield* seedTask(workspaceId, task, origin, clock, key));
      }
    }
    yield* seedBlocks(clock);
    const pages = new Map<DemoPage, string>();
    for (const [agent, row] of agents) {
      for (const [page, id] of yield* seedPages(agent, row, clock)) pages.set(page, id);
    }
    const seeded: SeedWritten = { agents, pages };
    for (const [agent, row] of agents) {
      for (const turn of agent.turns.entries()) {
        yield* seedTurn(agent, turn, writer, row, seeded, clock);
      }
      const asAgent = {
        actor: DESCRIPTION_COMMENT_ACTOR.AGENT,
        userId: row.userId,
        agentId: row.id,
      };
      for (const comment of agent.comments ?? []) {
        yield* seedComment(agent.task, asAgent, comment, clock, key);
      }
    }
    return { agents, madeIds };
  });
}

/* ----- The threads ----- */

/** The thread's ask answered as its member chose, a reply in their words beside it. */
function seedAnswer(
  thread: DemoThread,
  itemId: string,
  askId: string,
  clock: SeedClock,
  key: () => string,
) {
  return Effect.gen(function* () {
    const { answer } = thread;
    if (answer === undefined) return;
    const answered = yield* clock.ago(
      answer.ago,
      answerInboxAsk(answer.by.id, itemId, {
        answers: { ask: askId, reply: INBOX_REPLY.CHOSE, choices: [...answer.choices] },
        text: answer.text,
        clientKey: key(),
      }),
    );
    const taken = yield* written(`the answer to ${thread.title}`, answered);
    if (taken.outcome !== INBOX_ASK_ANSWER.TAKEN) {
      return yield* Effect.fail(new DemoSeedRefused({ step: `the answer to ${thread.title}` }));
    }
  });
}

/**
 * One thread the agent posted, the answer to its ask, its word after, the
 * members' replies, and the nod that settled it, where one did. Note that
 * the nod names the revision the post left, since no message after it
 * moves the revision on.
 */
function seedThread(thread: DemoThread, poster: InboxAgent, clock: SeedClock, key: () => string) {
  return Effect.gen(function* () {
    const posted = yield* clock.ago(
      thread.ago,
      postInboxThread(poster, {
        key: thread.key,
        title: thread.title,
        body: thread.body,
        ask: thread.ask,
        needsReply: thread.ask !== undefined,
        addresseeId: thread.addressee?.id,
      }),
    );
    const item = yield* written(thread.title, posted);
    const askId = openAskOf(item.thread ?? [])?.message.id;
    if (askId !== undefined) yield* seedAnswer(thread, item.id, askId, clock, key);
    if (thread.followUp !== undefined) {
      const said = yield* clock.ago(
        thread.followUp.ago,
        replyInboxItem(poster, thread.key, thread.followUp.text),
      );
      yield* written(`the word after ${thread.title}`, said);
    }
    for (const reply of thread.replies) {
      const message = { text: reply.text, clientKey: key() };
      const replied = yield* clock.ago(reply.ago, postInboxMessage(reply.by.id, item.id, message));
      yield* written(`a reply on ${thread.title}`, replied);
    }
    if (thread.acknowledged === undefined) return;
    const { by, ago } = thread.acknowledged;
    const nodded = yield* clock.ago(
      ago,
      acknowledgeInboxItem(by.id, item.id, item.revision, key()),
    );
    yield* written(`the nod on ${thread.title}`, nodded);
  });
}

/** Every agent's threads, and the threads members opened with an agent. */
function seedThreads(agents: ReadonlyMap<DemoAgent, Agent>, clock: SeedClock, key: () => string) {
  return Effect.gen(function* () {
    const posterOf = (agent: DemoAgent) =>
      Effect.map(
        written(`${agent.title}'s threads`, Option.fromNullishOr(agents.get(agent))),
        (row): InboxAgent => ({ userId: row.userId, taskId: agent.task.id, agentId: row.id }),
      );
    for (const thread of DEMO_THREADS) {
      yield* seedThread(thread, yield* posterOf(thread.agent), clock, key);
    }
    for (const opened of DEMO_MEMBER_THREADS) {
      const started = yield* clock.ago(
        opened.ago,
        startInboxThread(opened.by.id, yield* posterOf(opened.agent), {
          title: opened.title,
          text: opened.text,
          clientKey: key(),
        }),
      );
      yield* written(opened.title, started);
    }
  });
}

/* ----- The credential ----- */

/**
 * Dean's credential sealed under the ring the local server opens it with.
 * Note that it is sealed before anything is written, because a ring that
 * does not parse should refuse the seed while the database is still empty.
 */
function sealedCredential(credential: DemoCredential) {
  const ring = parseKeyRing(credential.ring);
  if (Result.isFailure(ring)) {
    return Effect.fail(new DemoSeedRefused({ step: "the provider key ring" }));
  }
  const owner = {
    userId: DEMO_DEAN.id,
    provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
    kind: credential.kind,
  };
  return Effect.succeed({
    owner,
    sealed: sealProviderKey(ring.success, owner, credential.key),
    hint: providerKeyHint(credential.key),
  });
}

/** Dean's sealed credential saved, and marked his agents' payer. */
function seedCredential({
  owner,
  sealed,
  hint,
}: Effect.Success<ReturnType<typeof sealedCredential>>) {
  return Effect.gen(function* () {
    const now = yield* Effect.map(Clock.currentTimeMillis, (at) => new Date(at));
    yield* saveProviderKey(owner.userId, owner.provider, owner.kind, sealed, hint, null, now);
    const marked = yield* setProviderKeyForAgents(owner.userId, owner.provider, owner.kind, true);
    if (!marked) {
      return yield* Effect.fail(new DemoSeedRefused({ step: "the credential's mark for agents" }));
    }
  });
}

/* ----- The host ----- */

/** A device secret for the demo's host, and the hash the seed keeps of it (`DemoHost`); the secret goes to the host's record alone. */
export function demoHostSecret(): MintedSecret {
  return mintHostSecret(HOST_WIRE.DEVICE_SECRET_PREFIX);
}

/**
 * The demo's host enrolled as Dean's own under its fixed id, keyed with the
 * hash of the secret its record holds, and kept as where he last ran a
 * task, where every agent the seed makes runs. Note that Bring your own host is
 * left off for him, because with it on the app keeps the Mac's one account
 * install (~/.local/state/vespin-host) running for the account signed in, and
 * would enroll a Mac with none with the run's server; and that the host is
 * enrolled at the service's floor, because its first call records the
 * version it runs.
 */
function seedHost(host: DemoHost) {
  return Effect.gen(function* () {
    const enrolled = yield* enrollOwnDevice(DEMO_DEAN.id, {
      id: DEMO_HOST.id,
      version: HOST_VERSION.FLOOR,
      secretHash: host.secretHash,
      machine: { name: DEMO_HOST.name, platform: DEMO_HOST.platform, arch: DEMO_HOST.arch },
    });
    if (!enrolled) return yield* Effect.fail(new DemoSeedRefused({ step: "the demo's host" }));
    const place = { machine: AGENT_MACHINE.DEVICE, deviceId: DEMO_HOST.id } as const;
    yield* keepRunsOnPick(DEMO_DEAN.id, place);
    return place;
  });
}

/* ----- The seed ----- */

/**
 * Writes the acme world into a freshly migrated database, and Dean's
 * credential and host where they are handed in, every agent running on
 * that host, or in the cloud where there is none; the ids it
 * chose. A database that holds any account already is refused, a seeded
 * one among them, so a seed runs once per database. Note that the seed is
 * no one transaction, since Better Auth writes through a pool of its own,
 * so one that fails partway leaves a database to throw away, as `run.sh
 * --demo` throws its own away on every exit; the credential is sealed
 * first, so a ring that does not parse fails it before anything is
 * written, and saved before the agents, because each records the payer a
 * Start would by what Dean keeps. The tasks an agent made are written
 * after it, under its id (`seedAgents`).
 */
export function seedDemoWorld(
  auth: DemoAuth,
  credential: Option.Option<DemoCredential>,
  host: Option.Option<DemoHost>,
): DemoSeedEffect<DemoSeeded> {
  return Effect.gen(function* () {
    const sealed = yield* Effect.transposeOption(Option.map(credential, sealedCredential));
    const clock = yield* seedClock;
    const key = clientKeys();
    const { personalWorkspaceId, workspaceId, memberIds } = yield* seedPeople(auth, clock);
    const place = Option.isSome(host) ? yield* seedHost(host.value) : DEMO_IN_THE_CLOUD;
    const madeByAgents = new Set(DEMO_AGENTS.flatMap(tasksMadeBy));
    const madeByMembers = DEMO_TASKS.filter((task) => !madeByAgents.has(task));
    const taskIds = yield* Effect.forEach(madeByMembers, (task) =>
      seedTask(workspaceId, task, undefined, clock, key),
    );
    if (Option.isSome(sealed)) yield* seedCredential(sealed.value);
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const { agents, madeIds } = yield* seedAgents(workspaceId, place, writer, clock, key);
    yield* seedThreads(agents, clock, key);
    return {
      deanId: DEMO_DEAN.id,
      personalWorkspaceId,
      workspaceId,
      memberIds,
      taskIds: [...taskIds, ...madeIds],
    };
  });
}

export { DEMO_DEAN, DEMO_HOST };
