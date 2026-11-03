import { slackEventsApp } from "@repo/service/slack/slack-events-app";
import { nativeAgents } from "../../native-agents.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * Our Slack bot's one inbound path, which Vercel Connect forwards Slack's
 * events and button presses to. The logic lives in
 * `packages/service/src/slack/slack-events-app.ts`; this file only hands the
 * group to the route adaptor.
 */
export default routeFromHttpRouter(slackEventsApp(), nativeAgents);
