/** `reopen_thread`, the agent reopens one of the plan's resolved comment threads (`packages/service/src/tasks/comment-tools.ts`). */
import { REOPEN_THREAD_TOOL } from "@luke/service/tasks/comment-tools";
import { commentToolFor } from "../host.js";

export default commentToolFor(REOPEN_THREAD_TOOL);
