import type { LinearAppSeams } from "../linear-app.js";
import { mintLinearState } from "../linear-app.js";
import { resolveHostedUserId } from "./bearer.js";
import {
  beginLinearSignIn,
  completeLinearSignIn,
  deleteLinearConnection,
  readLinearConnection,
  readLinearSignIn,
} from "./linear-store.js";

/**
 * linear-seams.ts -- the Linear group's seams over this deployment's real database and auth session.
 *
 * `server/linear-app.ts` describes the endpoints; this is the one place
 * that hands them the real connection rows and the real bearer resolver, so
 * every `routes/account/linear*` function builds the group from the same
 * wiring. Vercel Connect itself is `LinearConnect`, which the web runtime
 * provides.
 */
export function linearAppSeams(): LinearAppSeams {
  return {
    resolveUserId: resolveHostedUserId,
    readConnection: readLinearConnection,
    readSignIn: readLinearSignIn,
    beginSignIn: beginLinearSignIn,
    completeSignIn: completeLinearSignIn,
    deleteConnection: deleteLinearConnection,
    mintState: mintLinearState,
    now: () => Date.now(),
  };
}
