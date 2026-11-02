import type { DB } from "@better-auth/drizzle-adapter";
import type { DatabaseServices, StoreFailure } from "@luke/database/core/query";
import { type Agent, createAgent } from "@luke/database/models/agent-store";
import { createChannel } from "@luke/database/models/channel-store";
import { enrollOwnDevice } from "@luke/database/models/host-store";
import {
  actOnPlanCommentThread,
  PLAN_COMMENT_OUTCOME,
  type PlanCommentOutcome,
  startPlanCommentThread,
} from "@luke/database/models/plan-comments";
import { parseKeyRing, sealProviderKey } from "@luke/database/models/provider-key-seal";
import { saveProviderKey, setProviderKeyForAgents } from "@luke/database/models/provider-key-store";
import { keepRunsOnPick } from "@luke/database/models/runs-on-pick";
import {
  createTaskOnce,
  savePlanText,
  TASK_RUNS_IN_CLOUD,
  type TaskAssigneeNotMember,
  type TaskRunsOnWrite,
  type TaskTreeRepositoryLocked,
  updateTask,
} from "@luke/database/models/task-store";
import { type WorkspaceSeams, workspaceSeams } from "@luke/database/models/workspace-seams";
import { createWorkspace, ensurePersonalWorkspace } from "@luke/database/models/workspace-store";
import {
  type ConversationTarget,
  type StoreWriter,
  storeWriter,
} from "@luke/database/models/writer";
import { CONVERSATION_RUNTIME } from "@luke/database/storage-vocabulary";
import { AGENT_MACHINE, MESSAGE_SENDER } from "@luke/features/agent-wire";
import { HOST_WIRE } from "@luke/features/host-wire";
import { INBOX_REPLY, openAskOf } from "@luke/features/inbox-wire";
import {
  PLAN_COMMENT_ACTION,
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_SCOPE,
} from "@luke/features/plan-comment-wire";
import { type PROVIDER_KEY_KIND, PROVIDER_KEY_PROVIDER } from "@luke/features/provider-key-wire";
import { TASK_STATUS } from "@luke/features/task-wire";
import { MESSAGE_CHANNEL, START_LINE_BRIEF } from "@luke/wire";
import { sentLineId } from "@luke/wire/host-ids";
import { betterAuth } from "better-auth";
import { organization as organizationPlugin } from "better-auth/plugins";
import { type Cause, Clock, Data, Effect, Option, type Redacted, Result } from "effect";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { authDatabaseAdapter } from "../auth/auth-database.js";
import { ORGANIZATION_OPTIONS, USER_FIELDS } from "../auth/auth-policy.js";
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
  DEMO_CHANNELS,
  DEMO_CHANNELS_AGO,
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
  type DemoComment,
  type DemoIdKind,
  type DemoPerson,
  type DemoTask,
  type DemoThread,
  type DemoTurn,
  demoId,
} from "./demo-world.js";

/**
 * demo-seed.ts -- the demo's seed: the acme world (`demo-world.ts`) written into a freshly migrated database through the store's own models, with Dean's model credential and his host on this Mac where the run hands them in.
 *
 * `run.sh --demo` signs in as `DEMO_DEAN` and opens on what this writes:
 * Dean's own workspace and acme beside it, with Dana, Jordan, Priya, and
 * Theo as members; #product, #engineering, and #design; seven tasks across
 * every status, each with a plan and comments on it; three finished coding
 * agents with their transcripts; and their threads, with an Inbox of asks
 * waiting on Dean and one he answered.
 *
 * How to run it: `DATABASE_URL=<a Postgres on loopback> pnpm --filter
 * @luke/web demo:seed` (`apps/web/server/demo-seed.ts`), once the database
 * is migrated and `auth:seed` has run. It refuses any database that is not
 * on loopback (`demo-database.ts`). Where `LUKE_DEMO_CLAUDE_TOKEN` (a
 * `claude setup-token`) or `LUKE_DEMO_ANTHROPIC_API_KEY` is set, it is saved
 * as Dean's, for his agents, sealed under `PROVIDER_KEY_ENCRYPTION_KEYS`,
 * which the local server must then be handed too, or it cannot open it. The
 * token is never logged, written to a fixture, or traced: it goes from the
 * environment to its sealed row alone. Where the run starts a host on this
 * Mac for Dean (`LUKE_DEMO_HOST_STATE`), it is enrolled as his own under
 * `DEMO_HOST`'s id, and every task runs its agents there, with no Runs on
 * to pick.
 *
 * Every write goes through the model a route writes through, so the seed
 * keeps up with the schema. Users are Better Auth's own rows, made by its
 * internal adapter, and workspaces and members its organization plugin's,
 * on a Better Auth of the seed's own (`demoAuth`) whose id generator counts
 * up from fixed ids, so two seeds of two fresh databases write the same
 * accounts, workspaces, members, tasks, and channels. Note that the agents,
 * their messages, the threads, and the comments take the ids their models
 * mint, because no model takes one from its caller, and a demo run starts
 * from an empty profile that holds none of them.
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
  readonly channelIds: readonly string[];
}

/** Every way the seed fails: a refused step, Better Auth's own failure, or the store's. */
type DemoSeedEffect<A> = Effect.Effect<
  A,
  | DemoSeedRefused
  | Cause.UnknownError
  | StoreFailure
  | TaskAssigneeNotMember
  | TaskTreeRepositoryLocked,
  DatabaseServices
>;

/** The kind of fixed id Better Auth mints for each model it writes the seed's rows of. */
const AUTH_ID_KIND: Readonly<Record<string, DemoIdKind>> = {
  user: DEMO_ID_KIND.USER,
  organization: DEMO_ID_KIND.ORGANIZATION,
  member: DEMO_ID_KIND.MEMBER,
};

/**
 * A Better Auth over the database, with the organization plugin and the
 * user's fields as the deployment's (`auth.ts`), whose ids count up from
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
    user: USER_FIELDS,
    advanced: { database: { generateId } },
    plugins: [organizationPlugin(ORGANIZATION_OPTIONS)],
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

/** #product, #engineering, and #design, each made by its maker, #general minted before them. */
function seedChannels(workspaceId: string, clock: SeedClock) {
  return Effect.forEach(DEMO_CHANNELS, (channel) =>
    Effect.flatMap(
      createChannel(
        channel.by.id,
        workspaceId,
        { id: channel.id, name: channel.name, purpose: channel.purpose, project: false },
        new Date(clock.start - DEMO_CHANNELS_AGO),
      ),
      (made) => Effect.map(written(`#${channel.name}`, made), (row) => row.id),
    ),
  );
}

/* ----- The tasks ----- */

/** The thread a comment started, answered as it stands, or the comment refused. */
function threadOf(step: string, outcome: PlanCommentOutcome) {
  if (outcome.status !== PLAN_COMMENT_OUTCOME.DONE || !("thread" in outcome.answer)) {
    return Effect.fail(new DemoSeedRefused({ step }));
  }
  return Effect.succeed(outcome.answer.thread);
}

/** One comment thread on the task's plan, on the words it quotes, and the replies under it a minute apart. */
function seedComment(task: DemoTask, comment: DemoComment, clock: SeedClock, key: () => string) {
  return Effect.gen(function* () {
    const from = task.plan.indexOf(comment.quote);
    const writer = { actor: PLAN_COMMENT_ACTOR.MEMBER, userId: comment.by.id } as const;
    const started = yield* clock.ago(
      comment.ago,
      startPlanCommentThread(writer, task.id, {
        clientKey: key(),
        scope: PLAN_COMMENT_SCOPE.WORDS,
        quote: comment.quote,
        anchor: { from, to: from + comment.quote.length },
        text: task.plan,
        words: comment.words,
      }),
    );
    const thread = yield* threadOf(`a comment on ${task.name}`, started);
    for (const [index, reply] of comment.replies.entries()) {
      const replied = yield* clock.ago(
        comment.ago - (index + 1) * DEMO_MINUTE,
        actOnPlanCommentThread(
          { actor: PLAN_COMMENT_ACTOR.MEMBER, userId: reply.by.id },
          task.id,
          thread.id,
          {
            action: PLAN_COMMENT_ACTION.REPLY,
            clientKey: key(),
            words: reply.words,
          },
        ),
      );
      yield* threadOf(`a reply on ${task.name}`, replied);
    }
  });
}

/**
 * The task under its fixed id, made by its maker and assigned, running its
 * agents where `runsOn` names, its plan saved, and the comments on it; one
 * that is done or canceled stands to do until it is moved there.
 */
function seedTask(
  workspaceId: string,
  task: DemoTask,
  runsOn: TaskRunsOnWrite,
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
        runsOn,
        text: "",
      }),
    );
    yield* written(task.name, made);
    const saved = yield* clock.ago(
      task.savedAgo,
      savePlanText(task.creator.id, task.id, task.plan),
    );
    yield* written(`${task.name}'s plan`, saved);
    for (const comment of task.comments) yield* seedComment(task, comment, clock, key);
    if (task.settledAgo === undefined) return task.id;
    const settled = yield* clock.ago(
      task.settledAgo,
      updateTask(task.assignee.id, task.id, { status: task.status }),
    );
    yield* written(`${task.name} moved to ${task.status}`, settled);
    return task.id;
  });
}

/* ----- The agents ----- */

/** A turn's events, as Claude Code's runner reports them: each step's words, then its tool call, and the turn's end and usage. */
function turnEvents(
  agent: DemoAgent,
  turn: DemoTurn,
  turnIndex: number,
  conversationId: string,
  startedAt: number,
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
    add({ kind: RUN_EVENT.TEXT_DRAFTED, step: number, text: step.text });
    if (step.tool === undefined) continue;
    const callId = demoId(DEMO_ID_KIND.TOOL_CALL, turnIndex * 100 + number);
    const { name, input, output } = step.tool;
    add({ kind: RUN_EVENT.TOOL_CALL_STARTED, callId, name, input: { ...input } });
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
 * line written awaiting, the turn queued and taking it, and every event of
 * it written, ending settled, so the agent reads finished.
 */
function seedTurn(
  agent: DemoAgent,
  [turnIndex, turn]: readonly [number, DemoTurn],
  writer: StoreWriter,
  target: ConversationTarget,
  clock: SeedClock,
) {
  const write = Effect.gen(function* () {
    const step = `${agent.title}'s turn ${turnIndex + 1}`;
    const opening =
      turnIndex === 0
        ? { channel: MESSAGE_CHANNEL.START, brief: START_LINE_BRIEF.PROMPT }
        : undefined;
    const sender = { kind: MESSAGE_SENDER.MEMBER, userId: turn.from.id } as const;
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
    );
    for (const result of yield* writer.consumeAll(target, events)) yield* landed(step, result);
  });
  return clock.ago(turn.startedAgo, write);
}

/** One finished agent on its task, started by whoever sent its first line, with every turn of its transcript. */
function seedAgent(agent: DemoAgent, writer: StoreWriter, clock: SeedClock) {
  return Effect.gen(function* () {
    const [first] = agent.turns;
    const started = yield* clock.ago(
      first.startedAgo,
      createAgent(first.from.id, {
        taskId: agent.task.id,
        planSnapshot: null,
        prompt: first.line,
        idempotencyKey: agent.key,
        model: agent.model,
        effort: agent.effort,
        repository: null,
        title: agent.title,
        runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
      }),
    );
    const { agent: row } = yield* written(agent.title, started);
    const target = { userId: row.userId, conversationId: row.conversationId };
    for (const turn of agent.turns.entries()) yield* seedTurn(agent, turn, writer, target, clock);
    return row;
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

/** One thread the agent posted to its channel, the answer to its ask, its word after, and the members' replies. */
function seedThread(thread: DemoThread, poster: InboxAgent, clock: SeedClock, key: () => string) {
  return Effect.gen(function* () {
    const posted = yield* clock.ago(
      thread.ago,
      postInboxThread(poster, {
        key: thread.key,
        title: thread.title,
        body: thread.body,
        ask: thread.ask,
        needsReply: thread.needsReply,
        channelId: thread.channel.id,
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
  });
}

/** Every agent's threads, and the threads members opened with an agent. */
function seedThreads(
  posters: ReadonlyMap<DemoAgent, InboxAgent>,
  clock: SeedClock,
  key: () => string,
) {
  return Effect.gen(function* () {
    const posterOf = (agent: DemoAgent) =>
      written(`${agent.title}'s threads`, Option.fromNullishOr(posters.get(agent)));
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
 * task; where every task runs its agents. Note that Bring your own host is
 * left off for him, because with it on the app keeps the Mac's one account
 * install (~/.local/state/luke-host) running for the account signed in, and
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
    const runsOn = { machine: AGENT_MACHINE.DEVICE, deviceId: DEMO_HOST.id } as const;
    yield* keepRunsOnPick(DEMO_DEAN.id, runsOn);
    return runsOn;
  });
}

/* ----- The seed ----- */

/**
 * Writes the acme world into a freshly migrated database, and Dean's
 * credential and host where they are handed in, every task running its
 * agents on that host, or in the cloud where there is none; the ids it
 * chose. A database that holds any account already is refused, a seeded
 * one among them, so a seed runs once per database. Note that the seed is
 * no one transaction, since Better Auth writes through a pool of its own,
 * so one that fails partway leaves a database to throw away, as `run.sh
 * --demo` throws its own away on every exit; the credential is sealed
 * first, so a ring that does not parse fails it before anything is
 * written.
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
    const runsOn = Option.isSome(host) ? yield* seedHost(host.value) : TASK_RUNS_IN_CLOUD;
    const channelIds = yield* seedChannels(workspaceId, clock);
    const taskIds = yield* Effect.forEach(DEMO_TASKS, (task) =>
      seedTask(workspaceId, task, runsOn, clock, key),
    );
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const posters = new Map<DemoAgent, InboxAgent>();
    for (const agent of DEMO_AGENTS) {
      const row: Agent = yield* seedAgent(agent, writer, clock);
      posters.set(agent, { userId: row.userId, taskId: agent.task.id, agentId: row.id });
    }
    yield* seedThreads(posters, clock, key);
    if (Option.isSome(sealed)) yield* seedCredential(sealed.value);
    return {
      deanId: DEMO_DEAN.id,
      personalWorkspaceId,
      workspaceId,
      memberIds,
      taskIds,
      channelIds,
    };
  });
}

export { DEMO_DEAN, DEMO_HOST };
