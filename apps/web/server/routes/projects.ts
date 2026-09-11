import { handleProjects } from "../hosted/projects.js";
import { hostedVaultRoute } from "../hosted/vault-route.js";

/** Lists where the signed-in user's keys can create a workspace. */
export default hostedVaultRoute(handleProjects);
