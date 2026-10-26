/**
 * channels.ts -- a workspace's channels (`channel-wire.ts`): read them, open or archived, make, edit, archive, or unarchive one, stamp the reader's look at one, read a page of one's threads, and move a thread into one.
 *
 * Every write on a channel is a JSON body read whole (`exactInput`) and
 * answers the workspace's channels as they then stand, as the read does; a
 * move answers the thread as it then stands; every output is
 * its wire schema flipped (`packages/service/src/orpc/base.ts`).
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  archivedChannelsAnswerSchema,
  CHANNEL_BOUNDS,
  channelArchiveRequestSchema,
  channelCreateRequestSchema,
  channelEditRequestSchema,
  channelLookRequestSchema,
  channelMoveAnswerSchema,
  channelMoveRequestSchema,
  channelsAnswerSchema,
  channelsQuerySchema,
  channelThreadsAnswerSchema,
  channelThreadsQuerySchema,
  channelUnarchiveRequestSchema,
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
  edit: hostedProcedure
    .meta(bodyCap(WRITE_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.CHANNELS_EDIT }))
    .input(exactInput(channelEditRequestSchema))
    .output(EffectSchema.flip(channelsAnswerSchema)),
  archive: hostedProcedure
    .meta(bodyCap(WRITE_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.CHANNELS_ARCHIVE }))
    .input(exactInput(channelArchiveRequestSchema))
    .output(EffectSchema.flip(channelsAnswerSchema)),
  unarchive: hostedProcedure
    .meta(bodyCap(WRITE_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.CHANNELS_UNARCHIVE }))
    .input(exactInput(channelUnarchiveRequestSchema))
    .output(EffectSchema.flip(channelsAnswerSchema)),
  archived: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.CHANNELS_ARCHIVED }))
    .input(channelsQuerySchema)
    .output(EffectSchema.flip(archivedChannelsAnswerSchema)),
  look: hostedProcedure
    .meta(bodyCap(WRITE_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.CHANNELS_LOOK }))
    .input(exactInput(channelLookRequestSchema))
    .output(EffectSchema.flip(channelsAnswerSchema)),
  threads: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.CHANNELS_THREADS }))
    .input(channelThreadsQuerySchema)
    .output(EffectSchema.flip(channelThreadsAnswerSchema)),
  move: hostedProcedure
    .meta(bodyCap(WRITE_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.CHANNELS_MOVE }))
    .input(exactInput(channelMoveRequestSchema))
    .output(EffectSchema.flip(channelMoveAnswerSchema)),
};
