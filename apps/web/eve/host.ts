import type { IntegrationProvider } from "@sidecar/hosted/integration-wire";
import { Effect } from "effect";
import type { SessionAuth } from "eve/context";
import { type BrainHost, brainHost } from "../server/hosted/brain-host/host.js";
import {
  type BrainHostSeams,
  productionBrainHostSeams,
} from "../server/hosted/brain-host/production.js";
import { hostedEnvironment } from "../server/hosted/environment.js";
import {
  type IntegrationAdmission,
  integrationAccessToken,
  integrationConnection,
} from "../server/hosted/integration-connection.js";
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
export const seams: BrainHostSeams = Effect.runSync(
  Effect.provide(productionBrainHostSeams(runWeb), hostedEnvironment),
);

export const host: BrainHost = brainHost(seams);

/**
 * Relays one event of a subagent's session into its child conversation, for
 * the subagent's own hook, which runs here rather than at an edge of its own.
 * Each task the subagent receives wakes its title on a fiber of its own once
 * relayed, so its turn is not held for it; the title always names the first
 * task the subagent received, and only the first title that lands stands.
 */
export function relayChildEvent(
  event: Parameters<BrainHost["relayChild"]>[0],
  session: Parameters<BrainHost["relayChild"]>[1],
  state: Parameters<BrainHost["relayChild"]>[2],
): Promise<void> {
  return runWeb(
    Effect.gen(function* () {
      yield* host.relayChild(event, session, state);
      // The fiber outlives this hook and ends on its own, as a coding agent's title's does.
      if (event.type === "message.received") {
        yield* Effect.forkDetach(host.titleChild(session));
      }
    }),
  );
}

/**
 * One integration's connection under one of this project's ownership
 * checks, the root's or the worker's, for each agent's own
 * `connections/<provider>.ts`: the token read runs here, at the edge, under
 * the check that agent's model runs under too.
 */
export function integrationConnectionFor(
  provider: IntegrationProvider,
  admit: (auth: SessionAuth, sessionId: string) => IntegrationAdmission,
) {
  return integrationConnection(provider, (auth, sessionId) =>
    runWeb(integrationAccessToken(provider, admit(auth, sessionId))),
  );
}
