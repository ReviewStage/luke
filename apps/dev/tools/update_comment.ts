import { UPDATE_COMMENT_TOOL } from "@luke/service/tasks/comment-tools";
import { commentToolFor } from "../host.js";

/**
 * update_comment.ts -- `update_comment`, the agent resolves one of the plan's comment threads once what it asked is settled, or reopens a resolved one (`packages/service/src/tasks/comment-tools.ts`).
 *
 * Every agent is offered it, one on no task among them, since every call
 * names the task whose plan's comments it acts on, its own or any other of
 * its workspace.
 */
export default commentToolFor(UPDATE_COMMENT_TOOL);
