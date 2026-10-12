import type { ModelChoice } from "@sidecar/hosted/models-wire";
import { Effect, Result } from "effect";
import type { SessionAuth } from "eve/context";
import type { UnparsedWireValue } from "../server/core.js";
import type { DelegationAsk } from "../server/hosted/coder-host/delegation.js";
import { type CoderHost, coderHost } from "../server/hosted/coder-host/host.js";
import type { CoderModelSelection } from "../server/hosted/coder-host/model.js";
import { type PlanEditResult, planEditRejected } from "../server/hosted/coder-host/plan-edit.js";
import {
  type CoderHostSeams,
  productionCoderHostSeams,
} from "../server/hosted/coder-host/production.js";
import { hostedEnvironment } from "../server/hosted/environment.js";
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

/** The model one step of a worker runs on: the pair its delegation recorded, or the fixture's own under the scripted model; a step no delegation stands for is failed by name. */
export async function selectDelegatedModel(
  auth: SessionAuth,
  sessionId: string,
  parentCallId: string,
): Promise<CoderModelSelection> {
  const scripted = seams.scriptedModel() ? { model: scriptedModel() } : undefined;
  const selected = await runWeb(
    Effect.gen(function* () {
      const admitted = yield* host.admitDelegated(auth, sessionId);
      if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
      return yield* host.delegatedModel(admitted.success, parentCallId, scripted);
    }),
  );
  if (Result.isFailure(selected)) throw new Error(selected.failure);
  return selected.success;
}

/** Relays one event of a worker's session into its child conversation, for the worker's own hook, which runs here rather than at an edge of its own. */
export function relayChildEvent(
  event: Parameters<CoderHost["relayChild"]>[0],
  session: Parameters<CoderHost["relayChild"]>[1],
  state: Parameters<CoderHost["relayChild"]>[2],
): Promise<void> {
  return runWeb(host.relayChild(event, session, state));
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
