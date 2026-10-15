import { hostTurnId } from "@luke/database/models/ids";
import type { ModelChoice } from "@luke/features/models-wire";
import { edgeKit } from "@luke/service/agents/agent-runtime/edge";
import { AGENT_ROLE } from "@luke/service/agents/agent-runtime/role";
import type { AgentSkill } from "@luke/service/agents/agent-runtime/skills";
import type { DelegationAsk } from "@luke/service/agents/coder-host/delegation";
import {
  type AgentToolCall,
  type CoderHost,
  coderHost,
  type InboxCall,
} from "@luke/service/agents/coder-host/host";
import { type InboxToolResult, inboxRejected } from "@luke/service/agents/coder-host/inbox";
import type { InboxSandboxDoor } from "@luke/service/agents/coder-host/inbox-image";
import type { CoderModelSelection } from "@luke/service/agents/coder-host/model";
import { type PlanEditResult, planEditRejected } from "@luke/service/agents/coder-host/plan-edit";
import {
  type CoderHostSeams,
  productionCoderHostSeams,
} from "@luke/service/agents/coder-host/production";
import {
  type PullRequestToolResult,
  pullRequestRejected,
} from "@luke/service/agents/coder-host/pull-request";
import { showImageRejected } from "@luke/service/agents/coder-host/show-image";
import {
  type PullRequestToolResult,
  pullRequestRejected,
} from "@luke/service/agents/coder-host/pull-request";
import { showImageRejected } from "@luke/service/agents/coder-host/show-image";
import {
  type CODER_TOOL,
  type PlanTool,
  planToolsOf,
} from "@luke/service/agents/coder-host/tool-set";
import { agentToolRejected } from "@luke/service/agents/coding-agent-tools";
import {
  MAC_COMMAND_STATUS,
  type MacCommandAnswer,
  RUN_ON_MAC_TOOL,
  runOnMacTool,
} from "@luke/service/agents/mac-command";
import { hostedEnvironment } from "@luke/service/environment";
import { showPageRejected } from "@luke/service/plans/page-tool";
import { type PictureLookResult, pictureNotLooked } from "@luke/service/plans/picture-look";
import { scriptedModel } from "@luke/service/testing/coder-scripted-model";
import {
  ACTION_RESULT_STATUS,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
  type WireRecord,
} from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { Effect, Result, Schema } from "effect";
import type { SessionAuth } from "eve/context";
import { defineTool } from "eve/tools";
import { runAgent } from "./runtime.js";

/**
 * The one host every authored file of this eve project shares, over the
 * deployment's seams, on the same terms as the planning brain's
 * (`apps/luke/host.ts`): the seams are composed here, once, over the same
 * `HostedEnvironment` layer the web runtime builds, and run synchronously
 * because eve loads the authored files as modules and the environment read
 * is a `Config` over `process.env`, which suspends on nothing. The edge's
 * own runner is handed down too: eve's door holds a promise, and it runs on
 * it, so nothing under `server/hosted/` keeps a runner of its own. The
 * worker's authored files and the delegation tool run what they need
 * through the doors below rather than at edges of their own, as the
 * planning worker's do through `apps/luke/host.ts`.
 */
export const seams: CoderHostSeams = Effect.runSync(
  Effect.provide(productionCoderHostSeams(runAgent), hostedEnvironment),
);

export const host: CoderHost = coderHost(seams);

/** What a model resolver reads of eve's `step.started`, which eve hands it unparsed: eve's id for the turn the step is of. */
const StepStartedSchema = Schema.Struct({ data: Schema.Struct({ turnId: Schema.String }) });

/**
 * eve's `step.started` read as a model resolver reads it. Note that an event
 * without eve's turn id throws, because eve names one on every step it
 * starts, and a step whose turn cannot be named has nowhere to mark what it
 * ran at.
 */
export const readStepStarted = Schema.decodeUnknownSync(StepStartedSchema);

/** The store's id for the turn a `step.started` opens a step of in the session. */
export function stepTurnId(sessionId: string, started: typeof StepStartedSchema.Type): string {
  return hostTurnId(sessionId, started.data.turnId);
}

/**
 * The doors this project's authored files open onto the agent runtime
 * (`packages/service/src/agents/agent-runtime/edge.ts`), run here on the edge's runner. A
 * session is offered skills only once its conversation is read as an
 * agent's, whose repository they are read from.
 */
const edge = edgeKit(runAgent, {
  host,
  skills: (admitted) =>
    Effect.gen(function* () {
      const agent = yield* host.agent(admitted);
      if (Result.isFailure(agent)) return [];
      return yield* host.skills(admitted, agent.success);
    }),
});

/**
 * A delegation made under the agent's session: the pair the worker runs on,
 * recorded ahead of its session, or the one sentence refusing the ask,
 * which the delegation tool fails its call with so the agent reads it. A
 * delegation made is named from its task on a fiber of its own, so the
 * worker starts without waiting for its title.
 */
export function makeDelegation(
  auth: SessionAuth,
  sessionId: string,
  callId: string,
  task: string,
  asked: DelegationAsk,
): Promise<Result.Result<ModelChoice, string>> {
  return runAgent(
    Effect.gen(function* () {
      const admitted = yield* host.admit(auth, sessionId);
      if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
      const made = yield* host.delegate(admitted.success, callId, asked);
      // The fiber outlives this step and ends on its own, as the agent's own title's does.
      if (Result.isSuccess(made)) {
        yield* Effect.forkDetach(host.delegationTitle(admitted.success, callId, task));
      }
      return made;
    }),
  );
}

/** The model one step of a worker's turn runs on, the turn named by its store id (`stepTurnId`): the pair its delegation recorded, or the fixture's own under the scripted model; a step no delegation stands for is failed by name. */
export async function selectDelegatedModel(
  auth: SessionAuth,
  sessionId: string,
  parentCallId: string,
  turnId: string,
): Promise<CoderModelSelection> {
  const scripted = seams.scriptedModel() ? { model: scriptedModel() } : undefined;
  const selected = await runAgent(
    Effect.gen(function* () {
      const admitted = yield* host.admitDelegated(auth, sessionId);
      if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
      return yield* host.delegatedModel(admitted.success, parentCallId, scripted, turnId);
    }),
  );
  if (Result.isFailure(selected)) throw new Error(selected.failure);
  return selected.success;
}

/** Relays one event of a worker's session into its child conversation, for the worker's own hook. */
export function relayChildEvent(
  event: Parameters<CoderHost["relayChild"]>[0],
  session: Parameters<CoderHost["relayChild"]>[1],
  state: Parameters<CoderHost["relayChild"]>[2],
): Promise<void> {
  return edge.relayChildEvent(event, session, state);
}

/**
 * The plan's tools the session is offered for the turn it opens, for those
 * tools' own files (`planToolsOf`): none for a session the host does not
 * admit or whose conversation is no agent's.
 */
export function offeredPlanTools(
  auth: SessionAuth,
  sessionId: string,
): Promise<ReadonlySet<PlanTool>> {
  return runAgent(
    Effect.gen(function* () {
      const admitted = yield* host.admit(auth, sessionId);
      if (Result.isFailure(admitted)) return new Set<PlanTool>();
      const agent = yield* host.agent(admitted.success);
      if (Result.isFailure(agent)) return new Set<PlanTool>();
      return planToolsOf(agent.success);
    }),
  );
}

/** One `edit_plan` call's notes taken into the agent's plan, its pictures read through the session's sandbox door, for the tool, which runs here rather than at an edge of its own. */
export function editPlanNotes(
  auth: SessionAuth,
  sessionId: string,
  input: UnparsedWireValue,
  takenInTurn: number,
  sandbox: InboxSandboxDoor,
): Promise<PlanEditResult> {
  return runAgent(
    Effect.gen(function* () {
      const admitted = yield* host.admit(auth, sessionId);
      if (Result.isFailure(admitted)) return planEditRejected(admitted.failure);
      return yield* host.editPlan(admitted.success, input, takenInTurn, sandbox);
    }),
  );
}

/** One `open_pull_request` call run under the agent's session, for the tool, which runs here rather than at an edge of its own. */
export function runPullRequestTool(
  auth: SessionAuth,
  sessionId: string,
  input: UnparsedWireValue,
): Promise<PullRequestToolResult> {
  return runAgent(
    Effect.gen(function* () {
      const admitted = yield* host.admit(auth, sessionId);
      if (Result.isFailure(admitted)) return pullRequestRejected(admitted.failure);
      return yield* host.openPullRequest(admitted.success, input);
    }),
  );
}

/** One `open_pull_request` call run under the agent's session, for the tool, which runs here rather than at an edge of its own. */
export function runPullRequestTool(
  auth: SessionAuth,
  sessionId: string,
  input: UnparsedWireValue,
): Promise<PullRequestToolResult> {
  return runAgent(
    Effect.gen(function* () {
      const admitted = yield* host.admit(auth, sessionId);
      if (Result.isFailure(admitted)) return pullRequestRejected(admitted.failure);
      return yield* host.openPullRequest(admitted.success, input);
    }),
  );
}

/** One call of the agent's inbox tools run under its session, for the tool, which runs here rather than at an edge of its own. */
export function runInboxTool(
  auth: SessionAuth,
  sessionId: string,
  call: InboxCall,
): Promise<InboxToolResult> {
  return runAgent(
    Effect.gen(function* () {
      const admitted = yield* host.admit(auth, sessionId);
      if (Result.isFailure(admitted)) return inboxRejected(admitted.failure);
      return yield* host.inbox(admitted.success, call);
    }),
  );
}

/** One `look_at_picture` call run under the agent's session, for the tool, which runs here rather than at an edge of its own. */
export function lookAtPlanPicture(
  auth: SessionAuth,
  sessionId: string,
  input: UnparsedWireValue,
): Promise<PictureLookResult> {
  return runAgent(
    Effect.gen(function* () {
      const admitted = yield* host.admit(auth, sessionId);
      if (Result.isFailure(admitted)) return pictureNotLooked(admitted.failure);
      return yield* host.lookAtPicture(admitted.success, input);
    }),
  );
}

/** One call of the agent's tools about the workspace's coding agents, run under its session, for the tool, which runs here rather than at an edge of its own. */
export function runAgentTool(
  auth: SessionAuth,
  sessionId: string,
  call: AgentToolCall,
): Promise<WireRecord> {
  return runAgent(
    Effect.gen(function* () {
      const admitted = yield* host.admit(auth, sessionId);
      if (Result.isFailure(admitted)) return agentToolRejected(admitted.failure);
      return yield* host.agentTools(admitted.success, call);
    }),
  );
}

/** One `show_page` call run under the agent's session, its path read through the session's sandbox door, for the tool, which runs here rather than at an edge of its own. */
export function runShowPageTool(
  auth: SessionAuth,
  sessionId: string,
  input: UnparsedWireValue,
  sandbox: InboxSandboxDoor,
): Promise<WireRecord> {
  return runAgent(
    Effect.gen(function* () {
      const admitted = yield* host.admit(auth, sessionId);
      if (Result.isFailure(admitted)) return showPageRejected(admitted.failure);
      return yield* host.showPage(admitted.success, input, sandbox);
    }),
  );
}

/** One `show_image` call run under the agent's session, its pictures read through the session's sandbox door, for the tool, which runs here rather than at an edge of its own. */
export function runShowImageTool(
  auth: SessionAuth,
  sessionId: string,
  input: UnparsedWireValue,
  sandbox: InboxSandboxDoor,
): Promise<WireRecord> {
  return runAgent(
    Effect.gen(function* () {
      const admitted = yield* host.admit(auth, sessionId);
      if (Result.isFailure(admitted)) return showImageRejected(admitted.failure);
      return yield* host.showImage(admitted.success, input, sandbox);
    }),
  );
}

/** One of a worker's `show_image` calls, its pictures kept beside the worker's own transcript, for the worker's tool. */
export function runDelegatedShowImageTool(
  session: Parameters<CoderHost["showDelegatedImage"]>[0],
  input: UnparsedWireValue,
  sandbox: InboxSandboxDoor,
): Promise<WireRecord> {
  return runAgent(host.showDelegatedImage(session, input, sandbox));
}

/**
 * One public read of the agent's or a worker's, for its `search_web` or
 * `read_web_page` tool, under the admission that agent's model runs under,
 * which runs here rather than at an edge of its own; a session the host
 * does not admit is refused in the read's own words.
 */
export function runResearchTool(
  admit: (auth: SessionAuth, sessionId: string) => ReturnType<CoderHost["admit"]>,
  tool: typeof CODER_TOOL.SEARCH_WEB | typeof CODER_TOOL.READ_WEB_PAGE,
  context: { readonly auth: SessionAuth; readonly sessionId: string; readonly turnId: string },
  input: UnparsedWireValue,
): Promise<UnparsedWireValue> {
  return runAgent(
    Effect.gen(function* () {
      const admitted = yield* admit(context.auth, context.sessionId);
      if (Result.isFailure(admitted)) {
        return { status: ACTION_RESULT_STATUS.REJECTED, reason: admitted.failure };
      }
      const turn = { sessionId: context.sessionId, eveTurnId: context.turnId };
      const answer = yield* host.research(admitted.success, tool, turn, input);
      return { ...answer };
    }),
  );
}

/**
 * The skills the session is offered as it starts, for the agent's own
 * `skills/repository.ts`: the ones its repository keeps, or none for a
 * session the host does not admit or whose conversation is no agent's.
 */
export function sessionSkills(
  auth: SessionAuth,
  sessionId: string,
): Promise<readonly AgentSkill[]> {
  return edge.sessionSkills(AGENT_ROLE.CODER, auth, sessionId);
}

/**
 * Every integration one of this project's agents is handed, for that
 * agent's own `connections/integrations.ts`: a turn is handed only the
 * servers the agent has switched on (`packages/service/src/agents/agent-runtime/servers.ts`).
 */
export function integrationConnectionsFor(
  role: typeof AGENT_ROLE.CODER | typeof AGENT_ROLE.CODER_WORKER,
) {
  return edge.integrationConnections(role);
}

/**
 * `run_on_mac` as the agent and its worker are offered it, each admitted on
 * its own terms (the worker's on ownership, as its resolvers are), and run
 * through the one door every agent's call goes through
 * (`packages/service/src/agents/mac-command.ts`). A session the host does not admit runs
 * nothing.
 */
export function runOnMacFor(admit: CoderHost["admit"]) {
  return defineTool({
    description: RUN_ON_MAC_TOOL.description,
    inputSchema: emitJsonSchema(RUN_ON_MAC_TOOL.inputSchema),
    execute: (input, ctx): Promise<MacCommandAnswer> =>
      runAgent(
        Effect.gen(function* () {
          const admitted = yield* admit(ctx.session.auth, ctx.session.id);
          if (Result.isFailure(admitted)) {
            return { status: MAC_COMMAND_STATUS.NOT_RUN, reason: admitted.failure };
          }
          // SAFETY: eve hands a tool the JSON object the model emitted; the door parses it as wire input.
          const call = unparsedWire(input as WireBoundaryInput);
          return yield* runOnMacTool(admitted.success.target.userId, call);
        }),
      ),
  });
}
