import { middlewareGen } from "@orpc/experimental-effect";
import { catchAllButInterrupt, causeKind } from "@repo/runtime/effect";
import { type Cause, Effect } from "effect";
import type { HostedContext } from "../orpc/base.js";
import type { AdminViewer } from "./admin-access.js";
import { isAdminRole } from "./admin-access.js";
import { ADMIN_REFUSAL } from "./http-effect.js";

const CACHE_CONTROL = "cache-control";
const NO_STORE = "no-store";

export type AdminViewerResolver = (
  request: Request,
) => Effect.Effect<AdminViewer | undefined, Cause.UnknownError>;

export interface AdminCaller {
  readonly viewer: AdminViewer;
}

export function adminGateMiddleware(resolveViewer: AdminViewerResolver) {
  return middlewareGen<HostedContext, AdminCaller>(function* ({ context, next }) {
    context.resHeaders?.set(CACHE_CONTROL, NO_STORE);
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
