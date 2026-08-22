import { oAuthProxy } from "better-auth/plugins";
import type { AuthDeployment } from "./auth-deployment.js";

/**
 * Keep production as the OAuth relay without making the shared proxy key a
 * credential for production sessions.
 *
 * Better Auth's plugin combines two different roles: hooks that exchange the
 * provider's code on the registered production callback, and an endpoint that
 * decrypts the resulting profile and creates a session. Production needs the
 * first role for Preview sign-in, but the second role belongs only on the
 * Preview that initiated it.
 */
export function authProxy(deployment: AuthDeployment) {
  const proxy = oAuthProxy({
    productionURL: deployment.productionURL,
    secret: deployment.proxySecret,
  });

  if (deployment.acceptsProxyProfiles) return proxy;

  return {
    ...proxy,
    endpoints: {},
  };
}
