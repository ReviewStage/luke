import { READ_COMMENTS_TOOL } from "@luke/service/tasks/comment-tools";
import { commentToolFor } from "../host.js";

/**
 * read_comments.ts -- `read_comments`, the agent reads the plan's comment threads, open or resolved, for context; reading asks nothing of it (`packages/service/src/tasks/comment-tools.ts`).
 *
 * Every agent is offered it, one on no task among them, since every call
 * names the task whose plan's comments it acts on, its own or any other of
 * its workspace.
 */
export default commentToolFor(READ_COMMENTS_TOOL);
