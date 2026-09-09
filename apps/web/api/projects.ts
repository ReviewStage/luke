import { handleProjects } from "../server/hosted/projects.js";
import { hostedVaultRoute } from "../server/hosted/vault-route.js";

/** Lists where the signed-in user's keys can create a workspace. */
export default hostedVaultRoute(handleProjects);
