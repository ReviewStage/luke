import {
  handleConversationClear,
  handleConversationLines,
} from "../server/hosted/brain-host/conversation.js";
import { hostedBrainHostRoute } from "../server/hosted/brain-host/production.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../server/hosted/http.js";

const HTTP_METHOD = { GET: "GET", DELETE: "DELETE" } as const;

/** The account's one Conversation: its lines (GET) and its Clear (DELETE). */
export default hostedBrainHostRoute((route) => {
  switch (route.request.method) {
    case HTTP_METHOD.GET:
      return handleConversationLines(route);
    case HTTP_METHOD.DELETE:
      return handleConversationClear(route);
    default:
      return Promise.resolve(
        errorResponse(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
      );
  }
});
