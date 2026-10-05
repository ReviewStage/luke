import { Effect } from "effect";
import { type BrainHost, brainHost } from "../server/hosted/brain-host/host.js";
import {
  type BrainHostSeams,
  productionBrainHostSeams,
} from "../server/hosted/brain-host/production.js";
import { hostedEnvironment } from "../server/hosted/environment.js";
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
const composed = Effect.runSync(
  Effect.provide(
    Effect.flatMap(productionBrainHostSeams(runWeb), (seams) =>
      Effect.map(brainHost(seams), (host) => ({ seams, host })),
    ),
    hostedEnvironment,
  ),
);

export const seams: BrainHostSeams = composed.seams;
export const host: BrainHost = composed.host;
