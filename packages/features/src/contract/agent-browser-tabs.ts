import { HTTP_METHOD } from "@repo/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  agentBrowserTabAddressRequestSchema,
  agentBrowserTabAnswerSchema,
  agentBrowserTabOpenRequestSchema,
  agentBrowserTabsAnswerSchema,
} from "../agent-browser-tab-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { bodyCap, exactBodyInput, hostedProcedure } from "./base.js";

const TABS_PATH = `${HOSTED_SERVICE_PATH.TASKS}/{id}/browser-tabs` as const;

const DRIVER_PATH = `${TABS_PATH}/{tab}/driver` as const;

const AGENT_TABS_PATH = `${HOSTED_SERVICE_PATH.AGENTS}/{id}/browser-tabs` as const;

const OPEN_BODY_BYTES = 2_048 * 6 + 1_024;

const holderParamsSchema = EffectSchema.Struct({ id: EffectSchema.String });

const tabParamsSchema = EffectSchema.Struct({ id: EffectSchema.String, tab: EffectSchema.String });

export const agentBrowserTabsContract = {
  list: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: TABS_PATH }))
    .input(holderParamsSchema)
    .output(EffectSchema.flip(agentBrowserTabsAnswerSchema)),
  agentList: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: AGENT_TABS_PATH }))
    .input(holderParamsSchema)
    .output(EffectSchema.flip(agentBrowserTabsAnswerSchema)),
  agentOpen: hostedProcedure
    .meta(bodyCap(OPEN_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: AGENT_TABS_PATH, inputStructure: "detailed" }))
    .input(exactBodyInput(holderParamsSchema, agentBrowserTabAddressRequestSchema))
    .output(EffectSchema.flip(agentBrowserTabAnswerSchema)),
  open: hostedProcedure
    .meta(bodyCap(OPEN_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: TABS_PATH, inputStructure: "detailed" }))
    .input(exactBodyInput(holderParamsSchema, agentBrowserTabOpenRequestSchema))
    .output(EffectSchema.flip(agentBrowserTabAnswerSchema)),
  takeOver: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: DRIVER_PATH }))
    .input(tabParamsSchema)
    .output(EffectSchema.flip(agentBrowserTabAnswerSchema)),
  handBack: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: DRIVER_PATH }))
    .input(tabParamsSchema)
    .output(EffectSchema.flip(agentBrowserTabAnswerSchema)),
};
