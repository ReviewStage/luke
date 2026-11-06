/**
 * account.ts -- the signed-in account's own reads and writes (`account-wire.ts`, `provider-key-wire.ts`), as procedures.
 *
 * Its deletion, its preferences snapshot, its access, its own provider
 * keys, its workspace's memories, and its ChatGPT credentials, each on the path
 * and method it has always answered on; a memory kept in the member's words
 * and a search of them, the member MCP server's `save_memory` and
 * `search_memory` for a member's own client, beside the memories' read. A key is
 * removed by the provider and the kind its query names, since a `DELETE`
 * carries no body. A JSON body is read whole, a key it does not name
 * refused (`exactInput`), but for the preferences write, whose parts the
 * service has always read one by one and whose other keys it passes over.
 *
 * The outputs are the wire schemas flipped, so oRPC's output check encodes
 * the handler's value into the bytes the wire carries (`packages/service/src/orpc/base.ts`).
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import {
  accountAccessAnswerSchema,
  accountDeleteAnswerSchema,
  accountPreferencesAnswerSchema,
  accountPreferencesWriteSchema,
} from "../account-wire.js";
import {
  MEMORY_QUERY,
  memoriesAnswerSchema,
  memoryIdSchema,
  memorySaveAnswerSchema,
  memorySaveRequestSchema,
  memorySearchAnswerSchema,
  memorySearchQuerySchema,
} from "../memory-wire.js";
import {
  chatGptCredentialsSaveRequestSchema,
  chatGptDeviceLoginRequestSchema,
  chatGptDevicePollAnswerSchema,
  chatGptDeviceStartAnswerSchema,
  chatGptHostAnswerSchema,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_QUERY,
  providerKeyForAgentsRequestSchema,
  providerKeyKindSchema,
  providerKeySaveRequestSchema,
  providerKeysAnswerSchema,
} from "../provider-key-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { workspaceIdSchema } from "../task-wire.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

/** A key's save is a provider and a key bounded at 512 characters, so a body past this is not one. */
const PROVIDER_KEY_BODY_BYTES = 2_048;

/** A memory's save is a workspace id, a statement of at most 400 characters at JSON's widest escape, and an id, so a body past this is not one. */
const MEMORY_SAVE_BODY_BYTES = 4_096;

/** A ChatGPT sign-in's save is three tokens of at most 16 KiB each and a few ids, so a body past this is not one. */
const CHATGPT_CREDENTIALS_BODY_BYTES = 64 * 1_024;

/** A device-code login's poll or cancel is one login id of at most 64 characters, so a body past this is not one. */
const CHATGPT_DEVICE_LOGIN_BODY_BYTES = 512;

export const accountContract = {
  delete: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.ACCOUNT_DELETE }))
    .output(EffectSchema.flip(accountDeleteAnswerSchema)),
  preferences: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES }))
    .output(EffectSchema.flip(accountPreferencesAnswerSchema)),
  writePreferences: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.PUT, path: HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES }))
    .input(accountPreferencesWriteSchema)
    .output(EffectSchema.flip(accountPreferencesAnswerSchema)),
  access: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ACCOUNT_ACCESS }))
    .output(EffectSchema.flip(accountAccessAnswerSchema)),
  providerKeys: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ACCOUNT_PROVIDER_KEYS }))
    .output(EffectSchema.flip(providerKeysAnswerSchema)),
  saveProviderKey: hostedProcedure
    .meta(bodyCap(PROVIDER_KEY_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.PUT, path: HOSTED_SERVICE_PATH.ACCOUNT_PROVIDER_KEYS }))
    .input(exactInput(providerKeySaveRequestSchema))
    .output(EffectSchema.flip(providerKeysAnswerSchema)),
  setProviderKeyForAgents: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.PATCH, path: HOSTED_SERVICE_PATH.ACCOUNT_PROVIDER_KEYS }))
    .input(exactInput(providerKeyForAgentsRequestSchema))
    .output(EffectSchema.flip(providerKeysAnswerSchema)),
  removeProviderKey: hostedProcedure
    .meta(
      openapi({
        method: HTTP_METHOD.DELETE,
        path: HOSTED_SERVICE_PATH.ACCOUNT_PROVIDER_KEYS,
        inputStructure: "detailed",
      }),
    )
    .input(
      EffectSchema.Struct({
        query: EffectSchema.Struct({
          [PROVIDER_KEY_QUERY.PROVIDER]: EffectSchema.Literals(
            Object.values(PROVIDER_KEY_PROVIDER),
          ),
          [PROVIDER_KEY_QUERY.KIND]: EffectSchema.optionalKey(providerKeyKindSchema),
        }),
      }),
    )
    .output(EffectSchema.flip(providerKeysAnswerSchema)),
  memories: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ACCOUNT_MEMORIES }))
    .input(EffectSchema.Struct({ [MEMORY_QUERY.WORKSPACE_ID]: workspaceIdSchema }))
    .output(EffectSchema.flip(memoriesAnswerSchema)),
  forgetMemory: hostedProcedure
    .meta(
      openapi({
        method: HTTP_METHOD.DELETE,
        path: HOSTED_SERVICE_PATH.ACCOUNT_MEMORIES,
        inputStructure: "detailed",
      }),
    )
    .input(
      EffectSchema.Struct({
        query: EffectSchema.Struct({
          [MEMORY_QUERY.WORKSPACE_ID]: workspaceIdSchema,
          [MEMORY_QUERY.ID]: memoryIdSchema,
        }),
      }),
    )
    .output(EffectSchema.flip(memoriesAnswerSchema)),
  saveMemory: hostedProcedure
    .meta(bodyCap(MEMORY_SAVE_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.ACCOUNT_MEMORIES }))
    .input(exactInput(memorySaveRequestSchema))
    .output(EffectSchema.flip(memorySaveAnswerSchema)),
  searchMemories: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ACCOUNT_MEMORIES_SEARCH }))
    .input(
      EffectSchema.Struct({
        [MEMORY_QUERY.WORKSPACE_ID]: workspaceIdSchema,
        [MEMORY_QUERY.QUERY]: memorySearchQuerySchema,
      }),
    )
    .output(EffectSchema.flip(memorySearchAnswerSchema)),
  chatGptHost: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ACCOUNT_CHATGPT_HOST }))
    .output(EffectSchema.flip(chatGptHostAnswerSchema)),
  saveChatGptCredentials: hostedProcedure
    .meta(bodyCap(CHATGPT_CREDENTIALS_BODY_BYTES))
    .meta(
      openapi({ method: HTTP_METHOD.PUT, path: HOSTED_SERVICE_PATH.ACCOUNT_CHATGPT_CREDENTIALS }),
    )
    .input(exactInput(chatGptCredentialsSaveRequestSchema))
    .output(EffectSchema.flip(providerKeysAnswerSchema)),
  startChatGptDeviceLogin: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.ACCOUNT_CHATGPT_DEVICE }))
    .output(EffectSchema.flip(chatGptDeviceStartAnswerSchema)),
  pollChatGptDeviceLogin: hostedProcedure
    .meta(bodyCap(CHATGPT_DEVICE_LOGIN_BODY_BYTES))
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.ACCOUNT_CHATGPT_DEVICE_POLL }),
    )
    .input(exactInput(chatGptDeviceLoginRequestSchema))
    .output(EffectSchema.flip(chatGptDevicePollAnswerSchema)),
  cancelChatGptDeviceLogin: hostedProcedure
    .meta(bodyCap(CHATGPT_DEVICE_LOGIN_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.ACCOUNT_CHATGPT_DEVICE_CANCEL,
      }),
    )
    .input(exactInput(chatGptDeviceLoginRequestSchema))
    .output(EffectSchema.flip(chatGptDevicePollAnswerSchema)),
};
