import { handleLineRating } from "../../../../server/hosted/brain-host/conversation.js";
import { hostedBrainHostRoute } from "../../../../server/hosted/brain-host/production.js";

/** The developer's rating of one line Luke wrote (PUT). */
export default hostedBrainHostRoute(handleLineRating);
