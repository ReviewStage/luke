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
 * The procedures a coding agent's settings call declare their own
 * refusals (`declaredProcedure`): the preferences write, the provider keys,
 * and the account's ChatGPT sign-in refuse only as any procedure may, the
 * key ring a deployment holds among them, but that a device-code login is
 * braked as quota exhausted, and its start refused as an upstream error
 * where OpenAI gave no code; a memories read or forget refuses a workspace
 * the account is not in as not found and a memory it may not forget as not
 * permitted. The rest still declare the whole map (`hostedProcedure`).
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
  chatGptDeviceLoginRequestSchema,
  chatGptDevicePollAnswerSchema,
  chatGptDeviceStartAnswerSchema,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_QUERY,
  providerKeyForAgentsRequestSchema,
  providerKeyKindSchema,
  providerKeySaveRequestSchema,
  providerKeysAnswerSchema,
} from "../provider-key-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import { workspaceIdSchema } from "../task-wire.js";
import { bodyCap, declaredProcedure, exactInput, hostedProcedure, refuses } from "./base.js";

/** A key's save is a provider and a key bounded at 512 characters, so a body past this is not one. */
const PROVIDER_KEY_BODY_BYTES = 2_048;

/** A memory's save is a workspace id, a statement of at most 400 characters at JSON's widest escape, and an id, so a body past this is not one. */
const MEMORY_SAVE_BODY_BYTES = 4_096;

/** A device-code login's poll or cancel is one login id of at most 64 characters, so a body past this is not one. */
const CHATGPT_DEVICE_LOGIN_BODY_BYTES = 512;

export const accountContract = {
  delete: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.ACCOUNT_DELETE }))
    .output(EffectSchema.flip(accountDeleteAnswerSchema)),
  preferences: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES }))
    .output(EffectSchema.flip(accountPreferencesAnswerSchema)),
  writePreferences: declaredProcedure
    .meta(openapi({ method: HTTP_METHOD.PUT, path: HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES }))
    .input(accountPreferencesWriteSchema)
    .output(EffectSchema.flip(accountPreferencesAnswerSchema)),
  access: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ACCOUNT_ACCESS }))
    .output(EffectSchema.flip(accountAccessAnswerSchema)),
  providerKeys: declaredProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ACCOUNT_PROVIDER_KEYS }))
    .output(EffectSchema.flip(providerKeysAnswerSchema)),
  saveProviderKey: declaredProcedure
    .meta(bodyCap(PROVIDER_KEY_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.PUT, path: HOSTED_SERVICE_PATH.ACCOUNT_PROVIDER_KEYS }))
    .input(exactInput(providerKeySaveRequestSchema))
    .output(EffectSchema.flip(providerKeysAnswerSchema)),
  setProviderKeyForAgents: declaredProcedure
    .meta(openapi({ method: HTTP_METHOD.PATCH, path: HOSTED_SERVICE_PATH.ACCOUNT_PROVIDER_KEYS }))
    .input(exactInput(providerKeyForAgentsRequestSchema))
    .output(EffectSchema.flip(providerKeysAnswerSchema)),
  removeProviderKey: declaredProcedure
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
  memories: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ACCOUNT_MEMORIES }))
    .input(EffectSchema.Struct({ [MEMORY_QUERY.WORKSPACE_ID]: workspaceIdSchema }))
    .output(EffectSchema.flip(memoriesAnswerSchema)),
  forgetMemory: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
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
  startChatGptDeviceLogin: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.QUOTA_EXHAUSTED, HOSTED_API_ERROR.UPSTREAM_ERROR))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.ACCOUNT_CHATGPT_DEVICE }))
    .output(EffectSchema.flip(chatGptDeviceStartAnswerSchema)),
  pollChatGptDeviceLogin: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.QUOTA_EXHAUSTED))
    .meta(bodyCap(CHATGPT_DEVICE_LOGIN_BODY_BYTES))
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.ACCOUNT_CHATGPT_DEVICE_POLL }),
    )
    .input(exactInput(chatGptDeviceLoginRequestSchema))
    .output(EffectSchema.flip(chatGptDevicePollAnswerSchema)),
  cancelChatGptDeviceLogin: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.QUOTA_EXHAUSTED))
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
