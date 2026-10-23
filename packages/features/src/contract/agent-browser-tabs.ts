/**
 * agent-browser-tabs.ts -- the Browser tabs open in a task's agents' browsers (`agent-browser-tab-wire.ts`): list them, open one in an agent's browser, and take one over and hand it back.
 *
 * The task and the tab travel in the path. An open carries the agent and
 * the address in its body, and no other write carries one: a takeover is the member's own, held until an instant the service sets,
 * and asked again to renew it. Each write answers the tab as it then
 * stands, so a tab another member drives answers them as its driver.
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  agentBrowserTabAnswerSchema,
  agentBrowserTabOpenRequestSchema,
  agentBrowserTabsAnswerSchema,
} from "../agent-browser-tab-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { bodyCap, exactBodyInput, hostedProcedure } from "./base.js";

const TABS_PATH = `${HOSTED_SERVICE_PATH.TASKS}/{id}/browser-tabs` as const;

const DRIVER_PATH = `${TABS_PATH}/{tab}/driver` as const;

/** An open's body: an agent's id and an address at the Browser tab's bound, every character escaped. */
const OPEN_BODY_BYTES = 2_048 * 6 + 1_024;

/** The task a path names; the service reads an id that is no UUID as naming no task. */
const taskParamsSchema = EffectSchema.Struct({ id: EffectSchema.String });

/** The task and the tab a tab's path names, read as the task's id is. */
const tabParamsSchema = EffectSchema.Struct({ id: EffectSchema.String, tab: EffectSchema.String });

export const agentBrowserTabsContract = {
  /** The task's tabs, every agent's the member sees, the oldest first. */
  list: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: TABS_PATH }))
    .input(taskParamsSchema)
    .output(EffectSchema.flip(agentBrowserTabsAnswerSchema)),
  /** The member opens a tab at an address in a coding agent's browser on the task, taken over by them at once. */
  open: hostedProcedure
    .meta(bodyCap(OPEN_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: TABS_PATH, inputStructure: "detailed" }))
    .input(exactBodyInput(taskParamsSchema, agentBrowserTabOpenRequestSchema))
    .output(EffectSchema.flip(agentBrowserTabAnswerSchema)),
  /** The member takes the tab over, or renews their own takeover. */
  takeOver: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: DRIVER_PATH }))
    .input(tabParamsSchema)
    .output(EffectSchema.flip(agentBrowserTabAnswerSchema)),
  /** The member hands the tab they drive back to its agent. */
  handBack: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: DRIVER_PATH }))
    .input(tabParamsSchema)
    .output(EffectSchema.flip(agentBrowserTabAnswerSchema)),
};
