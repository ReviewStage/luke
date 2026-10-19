/** `read_comments`, the agent reads the plan's comment threads, open or resolved, for context; reading asks nothing of it (`packages/service/src/tasks/comment-tools.ts`). */
import { READ_COMMENTS_TOOL } from "@luke/service/tasks/comment-tools";
import { commentToolFor } from "../host.js";

export default commentToolFor(READ_COMMENTS_TOOL);
