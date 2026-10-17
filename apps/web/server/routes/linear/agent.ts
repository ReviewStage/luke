import { linearAgentApp } from "@luke/service/linear/linear-agent-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * Luke's Linear agent's webhook, which Linear delivers agent session events
 * to. The logic lives in `packages/service/src/linear/linear-agent-app.ts`;
 * this file only hands the group to the route adaptor.
 */
export default routeFromHttpRouter(linearAgentApp());
