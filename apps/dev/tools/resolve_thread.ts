import { RESOLVE_THREAD_TOOL } from "@luke/service/tasks/comment-tools";
import { commentToolFor } from "../host.js";

/**
 * resolve_thread.ts -- `resolve_thread`, the agent resolves one of the plan's comment threads once what it asked is settled (`packages/service/src/tasks/comment-tools.ts`).
 *
 * Every agent is offered it, one on no task among them, since every call
 * names the task whose plan's comments it acts on, its own or any other of
 * its workspace.
 */
export default commentToolFor(RESOLVE_THREAD_TOOL);
