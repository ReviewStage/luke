/**
 * run.ts -- the runners a service module is handed by the deployment's edge.
 *
 * The edge itself, `apps/web/server/runtime.ts`, builds the runtime and holds
 * `runWeb`; a module here names only the shape of what it is handed, so it
 * never imports the edge and the database driver the edge's layer carries.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import type { Effect } from "effect";

/**
 * The edge's own runner as a composition below it is handed one: a
 * collaborator driven by something other than a request — a socket's
 * callbacks, a stream's reader — has no request fiber to compose into, so the
 * function that composes it hands it `runWeb` itself, and a test hands it the
 * runner over its own test database. It is not a second runtime and not a
 * fiber's own face: the runner it names is always one built at an edge.
 */
export type WebStoreRun = <A, E>(effect: Effect.Effect<A, E, DatabaseServices>) => Promise<A>;
