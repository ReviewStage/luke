import { userIdForAuthorization } from "../../hosted/bearer.js";
import { hostedBrainUserInfo } from "../../hosted/brain-route.js";
import { brainCapabilitiesApp } from "../../hosted/brain-v2.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "../../hosted/openai.js";
import { routeFromHttpApp } from "../../route-effect.js";

/**
 * Answers what this deployment's brain contract speaks, for a signed-in
 * client, on the key this deployment holds. The logic lives in
 * `server/hosted/brain-v2.ts`; this file only hands it the deployment's real
 * seams.
 */
export default routeFromHttpApp(
  brainCapabilitiesApp({
    apiKey: process.env[HOSTED_OPENAI_ENVIRONMENT.API_KEY],
    model: process.env[HOSTED_OPENAI_ENVIRONMENT.BRAIN_MODEL],
    resolveUserId: (authorization) => userIdForAuthorization(authorization, hostedBrainUserInfo),
  }),
);
