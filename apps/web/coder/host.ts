import { Effect } from "effect";
import { type CoderHost, coderHost } from "../server/hosted/coder-host/host.js";
import {
  type CoderHostSeams,
  productionCoderHostSeams,
} from "../server/hosted/coder-host/production.js";
import { hostedEnvironment } from "../server/hosted/environment.js";
import { runWeb } from "../server/runtime.js";

/**
 * The one host every authored file of this eve project shares, over the
 * deployment's seams, on the same terms as the planning brain's
 * (`../eve/host.ts`): the seams are composed here, once, over the same
 * `HostedEnvironment` layer the web runtime builds, and run synchronously
 * because eve loads the authored files as modules and the environment read
 * is a `Config` over `process.env`, which suspends on nothing. The edge's
 * own runner is handed down too: eve's door holds a promise, and it runs on
 * it, so nothing under `server/hosted/` keeps a runner of its own.
 */
export const seams: CoderHostSeams = Effect.runSync(
  Effect.provide(productionCoderHostSeams(runWeb), hostedEnvironment),
);

export const host: CoderHost = coderHost(seams);
