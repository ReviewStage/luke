/** `resolve_thread`, the agent resolves one of the plan's comment threads once what it asked is settled (`packages/service/src/tasks/comment-tools.ts`). */
import { RESOLVE_THREAD_TOOL } from "@luke/service/tasks/comment-tools";
import { commentToolFor } from "../host.js";

export default commentToolFor(RESOLVE_THREAD_TOOL);
