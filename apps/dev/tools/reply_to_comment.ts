import { REPLY_TO_COMMENT_TOOL } from "@luke/service/tasks/comment-tools";
import { commentToolFor } from "../host.js";

/**
 * reply_to_comment.ts -- `reply_to_comment`, the agent answers one of the plan's comment threads, one a member sent it (`packages/service/src/tasks/comment-tools.ts`).
 *
 * Every agent is offered it, one on no task among them, since every call
 * names the task whose plan's comments it acts on, its own or any other of
 * its workspace.
 */
export default commentToolFor(REPLY_TO_COMMENT_TOOL);
