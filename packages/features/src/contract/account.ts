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
import { workspaceIdSchema } from "../task-wire.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

const PROVIDER_KEY_BODY_BYTES = 2_048;

const MEMORY_SAVE_BODY_BYTES = 4_096;

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
