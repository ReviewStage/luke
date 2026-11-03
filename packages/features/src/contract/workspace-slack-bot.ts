/**
 * workspace-slack-bot.ts -- a workspace's own Slack bot read, connected, and disconnected, and the reader's own notifications from it (`slack-bot-wire.ts`).
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import {
  WORKSPACE_SLACK_BOT_QUERY,
  workspaceSlackBotAnswerSchema,
  workspaceSlackBotNotificationsRequestSchema,
  workspaceSlackBotRequestSchema,
} from "../slack-bot-wire.js";
import { workspaceIdSchema } from "../task-wire.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

/** The most a request body may hold: a workspace id, and the switch. */
const BODY_BYTES = 1_024;

/** The read's query: the one workspace it names. */
const workspaceSlackBotQuerySchema = EffectSchema.Struct({
  [WORKSPACE_SLACK_BOT_QUERY.WORKSPACE_ID]: workspaceIdSchema,
});

export const workspaceSlackBotContract = {
  read: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.WORKSPACE_SLACK_BOT }))
    .input(workspaceSlackBotQuerySchema)
    .output(EffectSchema.flip(workspaceSlackBotAnswerSchema)),
  connect: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACE_SLACK_BOT_CONNECT }),
    )
    .input(exactInput(workspaceSlackBotRequestSchema))
    .output(EffectSchema.flip(workspaceSlackBotAnswerSchema)),
  disconnect: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.WORKSPACE_SLACK_BOT_DISCONNECT,
      }),
    )
    .input(exactInput(workspaceSlackBotRequestSchema))
    .output(EffectSchema.flip(workspaceSlackBotAnswerSchema)),
  notifications: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.WORKSPACE_SLACK_BOT_NOTIFICATIONS,
      }),
    )
    .input(exactInput(workspaceSlackBotNotificationsRequestSchema))
    .output(EffectSchema.flip(workspaceSlackBotAnswerSchema)),
};
