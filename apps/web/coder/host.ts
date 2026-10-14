import { hostTurnId } from "@luke/database/models/ids";
import type { ModelChoice } from "@luke/features/models-wire";
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
import { edgeKit } from "../server/hosted/agent-runtime/edge.js";
import { AGENT_ROLE } from "../server/hosted/agent-runtime/role.js";
import type { AgentSkill } from "../server/hosted/agent-runtime/skills.js";
import type { DelegationAsk } from "../server/hosted/coder-host/delegation.js";
import { type CoderHost, coderHost, type InboxCall } from "../server/hosted/coder-host/host.js";
import { type InboxToolResult, inboxRejected } from "../server/hosted/coder-host/inbox.js";
import type { InboxSandboxDoor } from "../server/hosted/coder-host/inbox-image.js";
import type { CoderModelSelection } from "../server/hosted/coder-host/model.js";
import { type PlanEditResult, planEditRejected } from "../server/hosted/coder-host/plan-edit.js";
import {
  type CoderHostSeams,
  productionCoderHostSeams,
} from "../server/hosted/coder-host/production.js";
import type { CODER_TOOL } from "../server/hosted/coder-host/tool-set.js";
import { hostedEnvironment } from "../server/hosted/environment.js";
import {
  MAC_COMMAND_STATUS,
  type MacCommandAnswer,
  RUN_ON_MAC_TOOL,
  runOnMacTool,
} from "../server/hosted/mac-command.js";
import { showPageRejected } from "../server/hosted/page-tool.js";
import { runWeb } from "../server/runtime.js";
import { scriptedModel } from "./scripted-model.js";

/**
 * The one host every authored file of this eve project shares, over the
 * deployment's seams, on the same terms as the planning brain's
 * (`../eve/host.ts`): the seams are composed here, once, over the same
 * `HostedEnvironment` layer the web runtime builds, and run synchronously
 * because eve loads the authored files as modules and the environment read
 * is a `Config` over `process.env`, which suspends on nothing. The edge's
 * own runner is handed down too: eve's door holds a promise, and it runs on
 * it, so nothing under `server/hosted/` keeps a runner of its own. The
 * worker's authored files and the delegation tool run what they need
 * through the doors below rather than at edges of their own, as the
 * planning worker's do through `../eve/host.ts`.
 */
export const seams: CoderHostSeams = Effect.runSync(
  Effect.provide(productionCoderHostSeams(runWeb), hostedEnvironment),
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
 * (`server/hosted/agent-runtime/edge.ts`), run here on the edge's runner. A
 * session is offered skills only once its conversation is read as an
 * agent's, whose repository they are read from.
 */
const edge = edgeKit(runWeb, {
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
  return runWeb(
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
  const selected = await runWeb(
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

/** One `edit_plan` call's notes taken into the agent's plan, for the tool, which runs here rather than at an edge of its own. */
export function editPlanNotes(
  auth: SessionAuth,
  sessionId: string,
  input: UnparsedWireValue,
  takenInTurn: number,
): Promise<PlanEditResult> {
  return runWeb(
    Effect.gen(function* () {
      const admitted = yield* host.admit(auth, sessionId);
      if (Result.isFailure(admitted)) return planEditRejected(admitted.failure);
      return yield* host.editPlan(admitted.success, input, takenInTurn);
    }),
  );
}

/** One call of the agent's inbox tools run under its session, for the tool, which runs here rather than at an edge of its own. */
export function runInboxTool(
  auth: SessionAuth,
  sessionId: string,
  call: InboxCall,
): Promise<InboxToolResult> {
  return runWeb(
    Effect.gen(function* () {
      const admitted = yield* host.admit(auth, sessionId);
      if (Result.isFailure(admitted)) return inboxRejected(admitted.failure);
      return yield* host.inbox(admitted.success, call);
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
  return runWeb(
    Effect.gen(function* () {
      const admitted = yield* host.admit(auth, sessionId);
      if (Result.isFailure(admitted)) return showPageRejected(admitted.failure);
      return yield* host.showPage(admitted.success, input, sandbox);
    }),
  );
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
  return runWeb(
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
 * servers the agent has switched on (`server/hosted/agent-runtime/servers.ts`).
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
 * (`server/hosted/mac-command.ts`). A session the host does not admit runs
 * nothing.
 */
export function runOnMacFor(admit: CoderHost["admit"]) {
  return defineTool({
    description: RUN_ON_MAC_TOOL.description,
    inputSchema: emitJsonSchema(RUN_ON_MAC_TOOL.inputSchema),
    execute: (input, ctx): Promise<MacCommandAnswer> =>
      runWeb(
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
