/**
 * agent-browser-tabs.ts -- the Browser tabs open in coding agents' browsers (`agent-browser-tab-wire.ts`): list one agent's or a task's, open one in an agent's browser, and take one over and hand it back.
 *
 * The agent or the task, and the tab, travel in the path. An open under a
 * task carries the agent and the address in its body, one under an agent
 * the address alone, and no other write carries one: a takeover is the member's own, held until an instant the service sets,
 * and asked again to renew it. Each write answers the tab as it then
 * stands, so a tab another member drives answers them as its driver.
 *
 * Each declares the refusals its handler answers
 * (`packages/service/src/agents/agent-browser-tabs-procedures.ts`) beyond
 * those any procedure may: an agent, a task, or a tab out of reach as not
 * found, and an open's and a takeover's own (`OPEN_REFUSALS`).
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import {
  agentBrowserTabAddressRequestSchema,
  agentBrowserTabAnswerSchema,
  agentBrowserTabOpenRequestSchema,
  agentBrowserTabsAnswerSchema,
} from "../agent-browser-tab-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import { bodyCap, declaredProcedure, exactBodyInput, refuses } from "./base.js";

const TABS_PATH = `${HOSTED_SERVICE_PATH.TASKS}/{id}/browser-tabs` as const;

const DRIVER_PATH = `${TABS_PATH}/{tab}/driver` as const;

const AGENT_TABS_PATH = `${HOSTED_SERVICE_PATH.AGENTS}/{id}/browser-tabs` as const;

/** An open's body: an agent's id and an address at the Browser tab's bound, every character escaped. */
const OPEN_BODY_BYTES = 2_048 * 6 + 1_024;

/**
 * What an open refuses (`agent-browser-tabs-procedures.ts`'s `openTab`): an
 * agent, or the task it is to be on, not found, an agent not the member's
 * to drive, one archived, one that has run no sandbox yet, and a browser
 * that could not be reached or would not open the page. An address that is
 * no Browser tab's is an invalid request.
 */
const OPEN_REFUSALS = [
  HOSTED_API_ERROR.NOT_FOUND,
  HOSTED_API_ERROR.NOT_PERMITTED,
  HOSTED_API_ERROR.AGENT_NOT_READY,
  HOSTED_API_ERROR.AGENT_RETIRED,
  HOSTED_API_ERROR.UPSTREAM_ERROR,
] as const;

/** The task or the agent a path names; the service reads an id that is no UUID as naming none. */
const holderParamsSchema = EffectSchema.Struct({ id: EffectSchema.String });

/** The task and the tab a tab's path names, read as the task's id is. */
const tabParamsSchema = EffectSchema.Struct({ id: EffectSchema.String, tab: EffectSchema.String });

export const agentBrowserTabsContract = {
  /** The task's tabs, every agent's the member sees, the oldest first. */
  list: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(openapi({ method: HTTP_METHOD.GET, path: TABS_PATH }))
    .input(holderParamsSchema)
    .output(EffectSchema.flip(agentBrowserTabsAnswerSchema)),
  /** One coding agent's tabs, on a task or on none, the oldest first. */
  agentList: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(openapi({ method: HTTP_METHOD.GET, path: AGENT_TABS_PATH }))
    .input(holderParamsSchema)
    .output(EffectSchema.flip(agentBrowserTabsAnswerSchema)),
  /** The member opens a tab at an address in the coding agent's browser, taken over by them at once. */
  agentOpen: declaredProcedure
    .errors(refuses(...OPEN_REFUSALS))
    .meta(bodyCap(OPEN_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: AGENT_TABS_PATH, inputStructure: "detailed" }))
    .input(exactBodyInput(holderParamsSchema, agentBrowserTabAddressRequestSchema))
    .output(EffectSchema.flip(agentBrowserTabAnswerSchema)),
  /** The member opens a tab at an address in a coding agent's browser on the task, taken over by them at once. */
  open: declaredProcedure
    .errors(refuses(...OPEN_REFUSALS))
    .meta(bodyCap(OPEN_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: TABS_PATH, inputStructure: "detailed" }))
    .input(exactBodyInput(holderParamsSchema, agentBrowserTabOpenRequestSchema))
    .output(EffectSchema.flip(agentBrowserTabAnswerSchema)),
  /** The member takes the tab over, or renews their own takeover. */
  takeOver: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(openapi({ method: HTTP_METHOD.POST, path: DRIVER_PATH }))
    .input(tabParamsSchema)
    .output(EffectSchema.flip(agentBrowserTabAnswerSchema)),
  /** The member hands the tab they drive back to its agent. */
  handBack: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: DRIVER_PATH }))
    .input(tabParamsSchema)
    .output(EffectSchema.flip(agentBrowserTabAnswerSchema)),
};
