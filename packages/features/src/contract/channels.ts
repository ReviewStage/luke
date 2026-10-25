/**
 * channels.ts -- a workspace's channels (`channel-wire.ts`): read them, make, rename, or archive one, stamp the reader's look at one, and read one's threads.
 *
 * Every write is a JSON body read whole (`exactInput`) and answers the
 * workspace's channels as they then stand, as the read does; every output is
 * its wire schema flipped (`packages/service/src/orpc/base.ts`).
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  CHANNEL_BOUNDS,
  channelArchiveRequestSchema,
  channelCreateRequestSchema,
  channelLookRequestSchema,
  channelRenameRequestSchema,
  channelsAnswerSchema,
  channelsQuerySchema,
  channelThreadsAnswerSchema,
  channelThreadsQuerySchema,
} from "../channel-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

/** A write is two ids, a name, and a purpose at JSON's widest escape, so a body past this is not one. */
const WRITE_BODY_BYTES =
  6 * (CHANNEL_BOUNDS.MAX_NAME_CHARS + CHANNEL_BOUNDS.MAX_PURPOSE_CHARS) + 1_024;

/** The status a channel made is answered with. */
const CREATED_STATUS = 201;

export const channelsContract = {
  list: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.CHANNELS }))
    .input(channelsQuerySchema)
    .output(EffectSchema.flip(channelsAnswerSchema)),
  create: hostedProcedure
    .meta(bodyCap(WRITE_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.CHANNELS,
        successStatus: CREATED_STATUS,
      }),
    )
    .input(exactInput(channelCreateRequestSchema))
    .output(EffectSchema.flip(channelsAnswerSchema)),
  rename: hostedProcedure
    .meta(bodyCap(WRITE_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.CHANNELS_RENAME }))
    .input(exactInput(channelRenameRequestSchema))
    .output(EffectSchema.flip(channelsAnswerSchema)),
  archive: hostedProcedure
    .meta(bodyCap(WRITE_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.CHANNELS_ARCHIVE }))
    .input(exactInput(channelArchiveRequestSchema))
    .output(EffectSchema.flip(channelsAnswerSchema)),
  look: hostedProcedure
    .meta(bodyCap(WRITE_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.CHANNELS_LOOK }))
    .input(exactInput(channelLookRequestSchema))
    .output(EffectSchema.flip(channelsAnswerSchema)),
  threads: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.CHANNELS_THREADS }))
    .input(channelThreadsQuerySchema)
    .output(EffectSchema.flip(channelThreadsAnswerSchema)),
};
