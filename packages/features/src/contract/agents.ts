import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import {
  AGENT_LIST_QUERY,
  AGENT_WORKSPACE_QUERY,
  agentAddRepositoryRequestSchema,
  agentAnswerSchema,
  agentArchiveRequestSchema,
  agentChangesAnswerSchema,
  agentDeleteAnswerSchema,
  agentListAnswerSchema,
  agentPageAnswerSchema,
  agentPinRequestSchema,
  agentReadRequestSchema,
  agentRenameRequestSchema,
  agentReviewOptionsAnswerSchema,
  agentRewindRequestSchema,
  agentServersRequestSchema,
  agentStartRequestSchema,
  agentWorkspaceListAnswerSchema,
  MAXIMUM_START_BODY_BYTES,
} from "../agent-wire.js";
import { modelChoiceSchema } from "../models-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import {
  sandboxResumedAnswerSchema,
  terminalCreatedAnswerSchema,
  terminalCreateRequestSchema,
  terminalRenameRequestSchema,
  terminalsAnswerSchema,
} from "../terminal-wire.js";
import { workspaceToolsAnswerSchema } from "../workspace-tools-wire.js";
import { bodyCap, exactBodyInput, hostedProcedure } from "./base.js";

const CHOICE_BODY_BYTES = 4_096;

const TERMINAL_BODY_BYTES = 1_024;

const AGENT_PATH = `${HOSTED_SERVICE_PATH.AGENTS}/{id}` as const;

const TERMINALS_PATH = `${AGENT_PATH}/terminals` as const;

export const AGENT_START_STATUS = { CREATED: 201, STARTED_BEFORE: 200 } as const;

const idParams = EffectSchema.Struct({ id: EffectSchema.String });

const terminalParams = EffectSchema.Struct({
  id: EffectSchema.String,
  terminal: EffectSchema.String,
});

const offsetQuery = EffectSchema.NumberFromString.pipe(
  EffectSchema.decodeTo(EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0))),
);

const archivedQuery = EffectSchema.optionalKey(EffectSchema.String);

const agentChangeRequestSchema = EffectSchema.Union([
  agentRenameRequestSchema,
  agentArchiveRequestSchema,
  agentPinRequestSchema,
  agentReadRequestSchema,
  agentServersRequestSchema,
  agentAddRepositoryRequestSchema,
  modelChoiceSchema,
]);

export type AgentChangeRequest = typeof agentChangeRequestSchema.Encoded;

const startAnswerSchema = EffectSchema.Struct({
  status: EffectSchema.Literals(Object.values(AGENT_START_STATUS)),
  body: agentAnswerSchema,
});

export const agentsContract = {
  listOfWorkspace: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.AGENTS }))
    .input(
      EffectSchema.Struct({
        [AGENT_WORKSPACE_QUERY.WORKSPACE_ID]: EffectSchema.optionalKey(EffectSchema.String),
        [AGENT_WORKSPACE_QUERY.REPOSITORY]: EffectSchema.optionalKey(EffectSchema.String),
        [AGENT_WORKSPACE_QUERY.WORDS]: EffectSchema.optionalKey(EffectSchema.String),
        [AGENT_WORKSPACE_QUERY.ARCHIVED]: archivedQuery,
        [AGENT_WORKSPACE_QUERY.OFFSET]: EffectSchema.optionalKey(offsetQuery),
      }),
    )
    .output(EffectSchema.flip(agentWorkspaceListAnswerSchema)),
  listOfTask: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${HOSTED_SERVICE_PATH.TASKS}/{id}/agents` }))
    .input(
      EffectSchema.Struct({
        id: EffectSchema.String,
        [AGENT_LIST_QUERY.ARCHIVED]: archivedQuery,
      }),
    )
    .output(EffectSchema.flip(agentListAnswerSchema)),
  start: hostedProcedure
    .meta(bodyCap(MAXIMUM_START_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: `${HOSTED_SERVICE_PATH.TASKS}/{id}/agents`,
        inputStructure: "detailed",
        outputStructure: "detailed",
      }),
    )
    .input(exactBodyInput(idParams, agentStartRequestSchema))
    .output(EffectSchema.flip(startAnswerSchema)),
  startFrom: hostedProcedure
    .meta(bodyCap(MAXIMUM_START_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: `${AGENT_PATH}/agents`,
        inputStructure: "detailed",
        outputStructure: "detailed",
      }),
    )
    .input(exactBodyInput(idParams, agentStartRequestSchema))
    .output(EffectSchema.flip(startAnswerSchema)),
  read: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: AGENT_PATH }))
    .input(idParams)
    .output(EffectSchema.flip(agentPageAnswerSchema)),
  change: hostedProcedure
    .meta(bodyCap(CHOICE_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.PATCH, path: AGENT_PATH, inputStructure: "detailed" }))
    .input(exactBodyInput(idParams, agentChangeRequestSchema))
    .output(EffectSchema.flip(agentAnswerSchema)),
  delete: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: AGENT_PATH }))
    .input(idParams)
    .output(EffectSchema.flip(agentDeleteAnswerSchema)),
  stop: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: `${AGENT_PATH}/stop` }))
    .input(idParams)
    .output(EffectSchema.flip(agentAnswerSchema)),
  rewind: hostedProcedure
    .meta(bodyCap(CHOICE_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: `${AGENT_PATH}/rewind`,
        inputStructure: "detailed",
      }),
    )
    .input(exactBodyInput(idParams, agentRewindRequestSchema))
    .output(EffectSchema.flip(agentAnswerSchema)),
  changes: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${AGENT_PATH}/changes` }))
    .input(
      EffectSchema.Struct({
        id: EffectSchema.String,
        number: EffectSchema.optionalKey(EffectSchema.String),
      }),
    )
    .output(EffectSchema.flip(agentChangesAnswerSchema)),
  reviewOptions: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${AGENT_PATH}/review-options` }))
    .input(idParams)
    .output(EffectSchema.flip(agentReviewOptionsAnswerSchema)),
  workspaceTools: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${AGENT_PATH}/workspace-tools` }))
    .input(idParams)
    .output(EffectSchema.flip(workspaceToolsAnswerSchema)),
  sandboxResume: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: `${AGENT_PATH}/sandbox/resume` }))
    .input(idParams)
    .output(EffectSchema.flip(sandboxResumedAnswerSchema)),
  terminals: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: TERMINALS_PATH }))
    .input(idParams)
    .output(EffectSchema.flip(terminalsAnswerSchema)),
  openTerminal: hostedProcedure
    .meta(bodyCap(TERMINAL_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: TERMINALS_PATH,
        inputStructure: "detailed",
        successStatus: 201,
      }),
    )
    .input(exactBodyInput(idParams, terminalCreateRequestSchema))
    .output(EffectSchema.flip(terminalCreatedAnswerSchema)),
  renameTerminal: hostedProcedure
    .meta(bodyCap(TERMINAL_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.PATCH,
        path: `${TERMINALS_PATH}/{terminal}`,
        inputStructure: "detailed",
      }),
    )
    .input(exactBodyInput(terminalParams, terminalRenameRequestSchema))
    .output(EffectSchema.flip(terminalsAnswerSchema)),
  endTerminal: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: `${TERMINALS_PATH}/{terminal}` }))
    .input(terminalParams)
    .output(EffectSchema.flip(terminalsAnswerSchema)),
};
