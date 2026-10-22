import { chatAttachmentApp } from "@luke/service/agents/chat-attachment-app";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { routeFromHttpRouter } from "../../../route-effect.js";

/** One picture a chat message carries, served as its bytes to a person in the workspace (GET). The logic lives in `packages/service/src/agents/chat-attachment-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(chatAttachmentApp({ resolveUserId: resolveHostedUserId }));
