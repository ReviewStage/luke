import type { Route } from "../route.js";
import type { AdminViewer } from "./admin-access.js";
import { isAdminRole } from "./admin-access.js";
import { ADMIN_ERROR, ADMIN_HTTP_STATUS, errorResponse } from "./http.js";

/**
 * The gate every admin read and write stands behind, in the order the pages
 * depend on: a method this route does not answer is a 405 before a session is
 * even looked for, an auth seam that throws is a 503 rather than a crash, an
 * anonymous request is a 401 the page answers with a sign-in, and a signed-in
 * non-admin is a 403 the page answers with a plain refusal. The handler runs
 * only for a viewer past all four, so no handler restates any of them.
 *
 * It takes the resolver rather than reaching for it, and lives apart from
 * `viewer.ts` for that reason: the real resolver is Better Auth, which cannot
 * be constructed without a database, and a gate this much depends on has to
 * be exercisable without one.
 */
export function adminViewerGate(options: {
  methods: readonly string[];
  resolveViewer: (request: Request) => Promise<AdminViewer | undefined>;
  handler: (viewer: AdminViewer, request: Request) => Promise<Response>;
}): Route {
  return {
    async fetch(request) {
      if (!options.methods.includes(request.method)) {
        return errorResponse(ADMIN_HTTP_STATUS.METHOD_NOT_ALLOWED, ADMIN_ERROR.METHOD_NOT_ALLOWED);
      }

      let viewer: AdminViewer | undefined;
      try {
        viewer = await options.resolveViewer(request);
      } catch (error) {
        console.error("admin viewer resolution failed", error);
        return errorResponse(ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE, ADMIN_ERROR.UNAVAILABLE);
      }
      if (!viewer) {
        return errorResponse(ADMIN_HTTP_STATUS.UNAUTHORIZED, ADMIN_ERROR.NOT_SIGNED_IN);
      }
      if (!isAdminRole(viewer.role)) {
        return errorResponse(ADMIN_HTTP_STATUS.FORBIDDEN, ADMIN_ERROR.NOT_AUTHORIZED);
      }

      return options.handler(viewer, request);
    },
  };
}
