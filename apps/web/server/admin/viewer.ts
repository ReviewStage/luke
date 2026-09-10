import { auth } from "../auth.js";
import type { Route } from "../route.js";
import type { AdminViewer } from "./admin-access.js";
import { adminViewerGate } from "./gate.js";

/**
 * The browser session an admin request rides in on — the maintainer's own
 * sign-in on this site, carrying that account's `role`, never the desktop's
 * bearer token. A getSession failure must propagate: the gate turns a thrown
 * viewer seam into a 503, where swallowing it here would misreport an auth
 * outage as a signed-out 401 and offer a sign-in that cannot succeed.
 */
async function resolveSessionViewer(request: Request): Promise<AdminViewer | undefined> {
  const authenticated = await auth.api.getSession({ headers: request.headers });
  const account = authenticated?.user;
  if (!account) return undefined;
  return { userId: account.id, role: account.role };
}

/** One admin route: the gate above, over this deployment's real session resolver. */
export function withAdminViewer(
  methods: readonly string[],
  handler: (viewer: AdminViewer, request: Request) => Promise<Response>,
): Route {
  return adminViewerGate({ methods, resolveViewer: resolveSessionViewer, handler });
}
