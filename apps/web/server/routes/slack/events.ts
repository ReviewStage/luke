import { slackEventsApp } from "@repo/service/slack/slack-events-app";
import { nativeAgents } from "../../native-agents.js";
import { routeFromHttpRouter } from "../../route-effect.js";

export default routeFromHttpRouter(slackEventsApp(), nativeAgents);
