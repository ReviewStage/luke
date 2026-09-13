import { Cause, Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import type { SqlClient } from "effect/unstable/sql";
import type { AdminViewer } from "./admin-access.js";
import { isAdminRole } from "./admin-access.js";
import { ADMIN_REFUSAL, type AdminRefusal, adminRefusalResponse } from "./http-effect.js";

/**
 * The gate every admin read and write stands behind, in the order the pages
 * depend on: a method this route does not answer is a 405 before a session is
 * even looked for, an auth seam that throws is a 503 rather than a crash, an
 * anonymous request is a 401 the page answers with a sign-in, and a signed-in
 * non-admin is a 403 the page answers with a plain refusal. The handler runs
 * only for a viewer past all four, so no handler restates any of them.
 *
 * It takes the resolver rather than reaching for it, and lives apart from the
 * group's own wiring for that reason: the real resolver is Better Auth, which
 * cannot be constructed without a database, and a gate this much depends on
 * has to be exercisable without one. The resolver answers an effect, so the
 * one promise behind it is Better Auth's own, wrapped where the seam is built
 * and nowhere here; a resolution that failed, however it failed, is the same
 * 503.
 *
 * What the handler answers is carried as it came — status, headers, and bytes
 * — because what a read answers is the read's, and only these four refusals
 * are the gate's own.
 */
export function adminViewerGate(options: {
  methods: readonly string[];
  resolveViewer: (request: Request) => Effect.Effect<AdminViewer | undefined, Cause.UnknownError>;
  handler: (
    viewer: AdminViewer,
    request: Request,
  ) => Effect.Effect<Response, never, SqlClient.SqlClient>;
}): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  SqlClient.SqlClient | HttpServerRequest.HttpServerRequest
> {
  return Effect.gen(function* () {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    if (!options.methods.includes(incoming.method)) {
      return yield* refuse(ADMIN_REFUSAL.METHOD_NOT_ALLOWED);
    }
    const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
    const viewer = yield* options.resolveViewer(request).pipe(
      Effect.tapCause((cause) =>
        Effect.sync(() => console.error("admin viewer resolution failed", Cause.squash(cause))),
      ),
      Effect.catchCause(() => Effect.fail(adminRefusalResponse(ADMIN_REFUSAL.UNAVAILABLE))),
    );
    if (!viewer) return yield* refuse(ADMIN_REFUSAL.NOT_SIGNED_IN);
    if (!isAdminRole(viewer.role)) return yield* refuse(ADMIN_REFUSAL.NOT_AUTHORIZED);
    return HttpServerResponse.raw(yield* options.handler(viewer, request));
  }).pipe(Effect.catch(Effect.succeed));
}

function refuse(
  refusal: AdminRefusal,
): Effect.Effect<never, HttpServerResponse.HttpServerResponse> {
  return Effect.fail(adminRefusalResponse(refusal));
}
