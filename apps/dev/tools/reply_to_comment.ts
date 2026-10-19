/** `reply_to_comment`, the agent answers one of the plan's comment threads, one a member sent it (`packages/service/src/tasks/comment-tools.ts`). */
import { REPLY_TO_COMMENT_TOOL } from "@luke/service/tasks/comment-tools";
import { commentToolFor } from "../host.js";

export default commentToolFor(REPLY_TO_COMMENT_TOOL);
