/**
 * workspace-slack-bot.ts -- a workspace's own Slack bot read, connected, and disconnected, and the reader's own notifications from it (`slack-bot-wire.ts`).
 *
 * Each declares a workspace or installation not found, and the writes a
 * role that does not allow them
 * (`packages/service/src/slack/slack-bot-procedures.ts`). Note that a
 * default repository named, for the workspace or a channel, may also be
 * refused as one the workspace's GitHub does not reach or GitHub not
 * answering; neither is declared, so the workspace client reads both as no
 * answer, as it always has.
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import {
  WORKSPACE_SLACK_BOT_QUERY,
  workspaceSlackBotAnswerSchema,
  workspaceSlackBotChannelRequestSchema,
  workspaceSlackBotNotificationsRequestSchema,
  workspaceSlackBotRepositoryRequestSchema,
  workspaceSlackBotRequestSchema,
} from "../slack-bot-wire.js";
import { workspaceIdSchema } from "../task-wire.js";
import { bodyCap, declaredProcedure, exactInput, refuses } from "./base.js";

/** The most a request body may hold: a workspace id, a channel id, the switch, and a repository's name. */
const BODY_BYTES = 1_024;

/** The read's query: the one workspace it names. */
const workspaceSlackBotQuerySchema = EffectSchema.Struct({
  [WORKSPACE_SLACK_BOT_QUERY.WORKSPACE_ID]: workspaceIdSchema,
});

export const workspaceSlackBotContract = {
  read: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.WORKSPACE_SLACK_BOT }))
    .input(workspaceSlackBotQuerySchema)
    .output(EffectSchema.flip(workspaceSlackBotAnswerSchema)),
  connect: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(bodyCap(BODY_BYTES))
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACE_SLACK_BOT_CONNECT }),
    )
    .input(exactInput(workspaceSlackBotRequestSchema))
    .output(EffectSchema.flip(workspaceSlackBotAnswerSchema)),
  disconnect: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(bodyCap(BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.WORKSPACE_SLACK_BOT_DISCONNECT,
      }),
    )
    .input(exactInput(workspaceSlackBotRequestSchema))
    .output(EffectSchema.flip(workspaceSlackBotAnswerSchema)),
  notifications: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(bodyCap(BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.WORKSPACE_SLACK_BOT_NOTIFICATIONS,
      }),
    )
    .input(exactInput(workspaceSlackBotNotificationsRequestSchema))
    .output(EffectSchema.flip(workspaceSlackBotAnswerSchema)),
  repository: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(bodyCap(BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.WORKSPACE_SLACK_BOT_REPOSITORY,
      }),
    )
    .input(exactInput(workspaceSlackBotRepositoryRequestSchema))
    .output(EffectSchema.flip(workspaceSlackBotAnswerSchema)),
  channel: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(bodyCap(BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.WORKSPACE_SLACK_BOT_CHANNEL,
      }),
    )
    .input(exactInput(workspaceSlackBotChannelRequestSchema))
    .output(EffectSchema.flip(workspaceSlackBotAnswerSchema)),
};
