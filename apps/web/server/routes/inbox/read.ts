import { orpcRoute } from "../../orpc-route.js";

/** A member's own read state on the Inbox: one item marked read (PUT) or unread (DELETE), or every item marked read (PUT), answered by the hosted oRPC router (`packages/service/src/inbox/inbox-procedures.ts`). */
export default orpcRoute;
