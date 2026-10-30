import { REOPEN_THREAD_TOOL } from "@luke/service/tasks/comment-tools";
import { commentToolFor } from "../host.js";

/**
 * reopen_thread.ts -- `reopen_thread`, the agent reopens one of the plan's resolved comment threads (`packages/service/src/tasks/comment-tools.ts`).
 *
 * Every agent is offered it, one on no task among them, since every call
 * names the task whose plan's comments it acts on, its own or any other of
 * its workspace.
 */
export default commentToolFor(REOPEN_THREAD_TOOL);
