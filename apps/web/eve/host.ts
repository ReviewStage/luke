import { Effect, Option, Result } from "effect";
import type { SessionAuth } from "eve/context";
import type { SandboxSession } from "eve/sandbox";
import bash from "eve/tools/bash";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary.js";
import { type BrainHost, brainHost } from "../server/hosted/brain-host/host.js";
import {
  type BrainHostSeams,
  productionBrainHostSeams,
} from "../server/hosted/brain-host/production.js";
import { hostedEnvironment } from "../server/hosted/environment.js";
import { GitHubAccess } from "../server/hosted/github-source.js";
import { readPlanOfConversation } from "../server/hosted/plan-store.js";
import { cloneRepository, type RunBash } from "../server/hosted/repository-shell.js";
import { runWeb } from "../server/runtime.js";

/**
 * The one host every authored file of this eve project shares, over the
 * deployment's seams. The seams are composed here, once, over the same
 * `HostedEnvironment` layer the web runtime builds, and run synchronously
 * because eve loads the authored files as modules and the channel's door
 * takes the deployment's secret as a value: the environment read is a
 * `Config` over `process.env`, which suspends on nothing, so the run
 * completes as the module does. The edge's own runner is handed down too:
 * the seams whose readers hold a promise — eve's door, the model
 * middleware's meter — run on it, so nothing under `server/hosted/` keeps a
 * runner of its own.
 */
/** eve's own `bash` tool, run as the planning model's repository commands are (`repository-shell.ts`). */
const runBash: RunBash = async (input, context) => {
  const output = await bash.execute(input, context);
  if (Symbol.asyncIterator in output) throw new Error("eve's bash streamed its output");
  return output;
};

const composed = Effect.runSync(
  Effect.provide(
    Effect.flatMap(productionBrainHostSeams(runWeb, runBash), (seams) =>
      Effect.map(brainHost(seams), (host) => ({ seams, host })),
    ),
    hostedEnvironment,
  ),
);

export const seams: BrainHostSeams = composed.seams;
export const host: BrainHost = composed.host;

/**
 * A new sandbox made ready for the session that opened it: a plan
 * conversation's gets its plan's repository cloned at the plan's commit
 * (`server/hosted/repository-shell.ts`); any other session's is left empty.
 * Run once per sandbox, by its `onSession` hook (`./sandbox.ts`).
 */
export function prepareSandbox(
  session: { readonly id: string; readonly auth: SessionAuth },
  sandbox: SandboxSession,
): Promise<void> {
  return runWeb(
    Effect.gen(function* () {
      const admitted = yield* host.admit(session.auth, session.id);
      if (Result.isFailure(admitted) || admitted.success.kind !== CONVERSATION_KIND.PLAN) return;
      const { target } = admitted.success;
      const plan = yield* readPlanOfConversation(target.userId, target.conversationId);
      if (Option.isNone(plan)) return;
      yield* cloneRepository(target.userId, plan.value.plan.repository, sandbox).pipe(
        Effect.provideService(GitHubAccess, seams.githubAccess),
      );
    }),
  );
}
