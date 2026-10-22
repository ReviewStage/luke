import { catchAllButInterrupt, causeKind } from "@luke/runtime/effect";
import { middlewareGen } from "@orpc/experimental-effect";
import { type Cause, Effect } from "effect";
import type { HostedContext } from "../orpc/base.js";
import type { AdminViewer } from "./admin-access.js";
import { isAdminRole } from "./admin-access.js";
import { ADMIN_REFUSAL } from "./http-effect.js";

/**
 * The gate every admin read and write stands behind, as the middleware on
 * the admin resource's implementer, so it runs before oRPC reads a
 * procedure's input: an auth seam that fails is a 503 rather than a crash,
 * an anonymous request is a 401 the page answers with a sign-in, and a
 * signed-in non-admin is a 403 the page answers with a plain refusal. A
 * procedure runs only for a viewer past all three, and is handed it. A
 * method no admin procedure is served under is the handler's 405 before the
 * gate is reached (`orpc/handler.ts`).
 *
 * It takes the resolver rather than reaching for it: the real resolver is
 * Better Auth, which cannot be constructed without a database, and a gate
 * this much depends on has to be exercisable without one. The resolver
 * answers an effect, so the one promise behind it is Better Auth's own,
 * wrapped where the seam is built and nowhere here; a resolution that
 * failed, however it failed, is the same 503.
 *
 * Every admin answer is viewer-gated account data, refusals included, so the
 * gate marks the answer `no-store` before anything else: a shared machine's
 * browser must never replay one admin's view to whoever sits down next.
 */

const CACHE_CONTROL = "cache-control";
const NO_STORE = "no-store";

/** How the gate resolves the browser session a request rides in on. */
export type AdminViewerResolver = (
  request: Request,
) => Effect.Effect<AdminViewer | undefined, Cause.UnknownError>;

/** The admin the gate let through, handed to every admin procedure. */
export interface AdminCaller {
  readonly viewer: AdminViewer;
}

export function adminGateMiddleware(resolveViewer: AdminViewerResolver) {
  return middlewareGen<HostedContext, AdminCaller>(function* ({ context, next }) {
    context.resHeaders?.set(CACHE_CONTROL, NO_STORE);
    // A request the client dropped or the function's deadline ended is no
    // outage: an interruption passes through, logged and answered as nothing.
    const viewer = yield* catchAllButInterrupt(resolveViewer(context.request), (cause) =>
      Effect.andThen(
        Effect.logError(`admin viewer resolution failed: ${causeKind(cause)}`),
        Effect.fail(ADMIN_REFUSAL.UNAVAILABLE),
      ),
    );
    if (!viewer) return yield* Effect.fail(ADMIN_REFUSAL.NOT_SIGNED_IN);
    if (!isAdminRole(viewer.role)) return yield* Effect.fail(ADMIN_REFUSAL.NOT_AUTHORIZED);
    return yield* next({ context: { viewer } });
  });
}
