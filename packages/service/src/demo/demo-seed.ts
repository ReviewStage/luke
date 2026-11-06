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

const SEED_AUTH_SECRET = "demo-seed-better-auth-signs-nothing-with-this";

export class DemoSeedRefused extends Data.TaggedError("DemoSeedRefused")<{
  readonly step: string;
}> {
  override get message(): string {
    return `The demo seed wrote nothing for ${this.step}`;
  }
}

export interface DemoAuth {
  readonly countUsers: Effect.Effect<number, Cause.UnknownError>;
  readonly createUser: (person: DemoPerson, at: Date) => Effect.Effect<void, Cause.UnknownError>;
  readonly workspaces: WorkspaceSeams;
  readonly addMember: (
    organizationId: string,
    person: DemoPerson,
  ) => Effect.Effect<string, Cause.UnknownError>;
}

export interface DemoCredential {
  readonly kind: typeof PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN | typeof PROVIDER_KEY_KIND.API_KEY;
  readonly key: Redacted.Redacted<string>;
  readonly ring: Redacted.Redacted;
}

export interface DemoHost {
  readonly secretHash: string;
}

export interface DemoSeeded {
  readonly deanId: string;
  readonly personalWorkspaceId: string;
  readonly workspaceId: string;
  readonly memberIds: readonly string[];
  readonly taskIds: readonly string[];
}

interface DemoPlace {
  readonly machine: AgentMachineKind;
  readonly deviceId: string | undefined;
}

const DEMO_IN_THE_CLOUD: DemoPlace = { machine: AGENT_MACHINE.VERCEL, deviceId: undefined };

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

const AUTH_ID_KIND: Readonly<Record<string, DemoIdKind>> = {
  user: DEMO_ID_KIND.USER,
  organization: DEMO_ID_KIND.ORGANIZATION,
  member: DEMO_ID_KIND.MEMBER,
};

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

interface SeedClock {
  readonly start: number;
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

function written<A>(step: string, outcome: Option.Option<A> | Result.Result<A, unknown>) {
  const value = Option.isOption(outcome) ? outcome : Result.getSuccess(outcome);
  return Option.match(value, {
    onNone: () => Effect.fail(new DemoSeedRefused({ step })),
    onSome: Effect.succeed,
  });
}

function clientKeys(): () => string {
  let taken = 0;
  return () => {
    taken += 1;
    return demoId(DEMO_ID_KIND.CLIENT_KEY, taken);
  };
}

function callsOf(agent: DemoAgent): readonly DemoCall[] {
  return agent.turns.flatMap((turn) =>
    turn.steps.flatMap((step) => (step.call === undefined ? [] : [step.call])),
  );
}

function tasksMadeBy(agent: DemoAgent): readonly DemoTask[] {
  return callsOf(agent).flatMap((call) => ("creates" in call ? [call.creates] : []));
}

function starterOf(agent: DemoAgent): DemoAgent | undefined {
  return DEMO_AGENTS.find((other) =>
    callsOf(other).some((call) => "starts" in call && call.starts === agent),
  );
}

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

function threadOf(step: string, outcome: DescriptionCommentOutcome) {
  if (outcome.status !== DESCRIPTION_COMMENT_OUTCOME.DONE || !("thread" in outcome.answer)) {
    return Effect.fail(new DemoSeedRefused({ step }));
  }
  return Effect.succeed(outcome.answer.thread);
}

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

interface SeedWritten {
  readonly agents: ReadonlyMap<DemoAgent, Agent>;
  readonly pages: ReadonlyMap<DemoPage, string>;
}

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

function landed<A, E>(step: string, result: Result.Result<A, E>) {
  return Result.isFailure(result) ? Effect.fail(new DemoSeedRefused({ step })) : Effect.void;
}

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

function seededRuntime(userId: string, model: string) {
  return Effect.catchTag(agentRuntimeChoice(userId, model), "AgentCredentialMissing", () =>
    Effect.succeed({ runtime: CONVERSATION_RUNTIME.CLAUDE_CODE, payer: undefined }),
  );
}

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

export function demoHostSecret(): MintedSecret {
  return mintHostSecret(HOST_WIRE.DEVICE_SECRET_PREFIX);
}

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
