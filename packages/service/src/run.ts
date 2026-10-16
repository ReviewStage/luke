/**
 * run.ts -- the runners a service module is handed by the deployment's edge.
 *
 * The edge itself, `apps/web/server/runtime.ts` (or an eve root's own
 * `runtime.ts`), builds the runtime and holds `runWeb` (or `runAgent`); a module here names only the shape of what it is handed, so it
 * never imports the edge and the database driver the edge's layer carries.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import type { Effect } from "effect";
import type { HttpClient } from "effect/http";
import type { GitHubApp } from "./github/github-app.js";
import type {
  IntegrationConnect,
  WorkspaceLinearConnect,
} from "./integrations/integration-connect.js";

/**
 * The edge's own runner as a composition below it is handed one: a
 * collaborator driven by something other than a request — a socket's
 * callbacks, a stream's reader — has no request fiber to compose into, so the
 * function that composes it hands it `runWeb` itself, and a test hands it the
 * runner over its own test database. It is not a second runtime and not a
 * fiber's own face: the runner it names is always one built at an edge.
 */
export type WebStoreRun = <A, E>(effect: Effect.Effect<A, E, DatabaseServices>) => Promise<A>;

/** What the doors an eve root opens onto the agent runtime may require (`agents/agent-runtime/edge.ts`). */
export type WebAgentServices =
  | DatabaseServices
  | HttpClient.HttpClient
  | GitHubApp
  | IntegrationConnect
  | WorkspaceLinearConnect;

/**
 * The edge's own runner as an eve root's doors are handed one, on the same
 * terms as `WebStoreRun`: the root's `host.ts` hands it `runAgent`, and a test
 * the runner over its own test database and fakes of the rest.
 */
export type WebAgentRun = <A, E>(effect: Effect.Effect<A, E, WebAgentServices>) => Promise<A>;
