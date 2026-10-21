/**
 * agents.ts -- a coding agent as the desktop lists, starts, reads, changes, and stops it, its changes and review options, and its shells (`coding-agent-wire.ts`, `terminal-wire.ts`).
 *
 * Every path names the task or the agent it is about as `{id}`, and a shell
 * as `{terminal}`, which the handler reads as an id: one that is no UUID
 * names no row and is answered not found, as the old groups answered it. A
 * procedure with a path and a JSON body reads them apart
 * (`inputStructure: "detailed"`), the body exactly. A Start answers 201
 * for the agent it made and 200 for the one a retry under the same key
 * already made, so it answers its status beside its body
 * (`outputStructure: "detailed"`). A Start from an agent is keyed by that
 * agent rather than a task (`POST /api/agents/{id}/agents`), so an agent with
 * no task is continued and forked as one on a task is; its body is a Start's,
 * whose `from` names the path's agent. A delete (`DELETE /api/agents/{id}`)
 * takes the agent for good, as a task's delete takes a task. Outputs are the wire schemas flipped
 * (`packages/service/src/orpc/base.ts`).
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  CODING_AGENT_LIST_QUERY,
  CODING_AGENT_WORKSPACE_QUERY,
  codingAgentAnswerSchema,
  codingAgentArchiveRequestSchema,
  codingAgentChangesAnswerSchema,
  codingAgentDeleteAnswerSchema,
  codingAgentListAnswerSchema,
  codingAgentPageAnswerSchema,
  codingAgentPinRequestSchema,
  codingAgentRenameRequestSchema,
  codingAgentReviewOptionsAnswerSchema,
  codingAgentServersRequestSchema,
  codingAgentStartRequestSchema,
  MAXIMUM_START_BODY_BYTES,
} from "../coding-agent-wire.js";
import { modelChoiceSchema } from "../models-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import {
  sandboxResumedAnswerSchema,
  terminalCreatedAnswerSchema,
  terminalCreateRequestSchema,
  terminalRenameRequestSchema,
  terminalsAnswerSchema,
} from "../terminal-wire.js";
import { taskTranscriptAnswerSchema } from "../transcript-wire.js";
import { bodyCap, exactBodyInput, hostedProcedure } from "./base.js";

/** A change names a model, an effort, and a window, a title, an archive, or a pin, at most, so a body past this is no change. */
const CHOICE_BODY_BYTES = 4_096;

/** A shell's name and a few keys at JSON's widest escape, so a body past this names no shell. */
const TERMINAL_BODY_BYTES = 1_024;

/** One agent's path, its id the `{id}` segment. */
const AGENT_PATH = `${HOSTED_SERVICE_PATH.AGENTS}/{id}` as const;

/** One agent's shells. */
const TERMINALS_PATH = `${AGENT_PATH}/terminals` as const;

/** The statuses a Start answers: the agent it made, or the one a retry under the same key already made. */
export const AGENT_START_STATUS = { CREATED: 201, STARTED_BEFORE: 200 } as const;

/** The task or the agent a path names, read as an id by the handler. */
const idParams = EffectSchema.Struct({ id: EffectSchema.String });

/** One shell of an agent a path names. */
const terminalParams = EffectSchema.Struct({
  id: EffectSchema.String,
  terminal: EffectSchema.String,
});

/** What a list's `archived` query may say, read as the old groups read it: `include`, or anything else for none. */
const archivedQuery = EffectSchema.optionalKey(EffectSchema.String);

/**
 * One change of an agent (PATCH): its title, its archive, its pin, its MCP
 * servers, or its model and effort, read in that order as the old group read
 * them.
 */
const codingAgentChangeRequestSchema = EffectSchema.Union([
  codingAgentRenameRequestSchema,
  codingAgentArchiveRequestSchema,
  codingAgentPinRequestSchema,
  codingAgentServersRequestSchema,
  modelChoiceSchema,
]);

/** A change as it travels. */
export type CodingAgentChangeRequest = typeof codingAgentChangeRequestSchema.Encoded;

/** A Start's answer: its status, and the agent. */
const startAnswerSchema = EffectSchema.Struct({
  status: EffectSchema.Literals(Object.values(AGENT_START_STATUS)),
  body: codingAgentAnswerSchema,
});

export const agentsContract = {
  /** A workspace's agents, newest started first, narrowed as the query asks. */
  listOfWorkspace: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.AGENTS }))
    .input(
      EffectSchema.Struct({
        [CODING_AGENT_WORKSPACE_QUERY.WORKSPACE_ID]: EffectSchema.optionalKey(EffectSchema.String),
        [CODING_AGENT_WORKSPACE_QUERY.REPOSITORY]: EffectSchema.optionalKey(EffectSchema.String),
        [CODING_AGENT_WORKSPACE_QUERY.WORDS]: EffectSchema.optionalKey(EffectSchema.String),
        [CODING_AGENT_WORKSPACE_QUERY.ARCHIVED]: archivedQuery,
      }),
    )
    .output(EffectSchema.flip(codingAgentListAnswerSchema)),
  /** One task's agents with their status. */
  listOfTask: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${HOSTED_SERVICE_PATH.TASKS}/{id}/agents` }))
    .input(
      EffectSchema.Struct({
        id: EffectSchema.String,
        [CODING_AGENT_LIST_QUERY.ARCHIVED]: archivedQuery,
      }),
    )
    .output(EffectSchema.flip(codingAgentListAnswerSchema)),
  /** An agent started on the task, or the one a retry under the same key already started. */
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
    .input(exactBodyInput(idParams, codingAgentStartRequestSchema))
    .output(EffectSchema.flip(startAnswerSchema)),
  /** An agent started from the one the path names, continuing it or forking it, in that agent's own place: its task, or its workspace and repository where it has no task. */
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
    .input(exactBodyInput(idParams, codingAgentStartRequestSchema))
    .output(EffectSchema.flip(startAnswerSchema)),
  /** One agent as its own page. */
  read: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: AGENT_PATH }))
    .input(idParams)
    .output(EffectSchema.flip(codingAgentPageAnswerSchema)),
  /**
   * The calls into one agent, oldest first, as a task's calls are read
   * (`transcript-wire.ts`): each by its session's id, when it started and,
   * where its record holds it, ended and why, its metered seconds, its
   * voice model, and whose call it was, with the lines said on it, each
   * naming the rows its voice wrote in the agent's conversation. What the
   * agent's tab draws a call's boundaries from beside its transcript.
   */
  calls: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${AGENT_PATH}/calls` }))
    .input(idParams)
    .output(EffectSchema.flip(taskTranscriptAnswerSchema)),
  /** One change of an agent, answering it as it then stands. */
  change: hostedProcedure
    .meta(bodyCap(CHOICE_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.PATCH, path: AGENT_PATH, inputStructure: "detailed" }))
    .input(exactBodyInput(idParams, codingAgentChangeRequestSchema))
    .output(EffectSchema.flip(codingAgentAnswerSchema)),
  /** One agent deleted for good, stopped first where it still works. */
  delete: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: AGENT_PATH }))
    .input(idParams)
    .output(EffectSchema.flip(codingAgentDeleteAnswerSchema)),
  /** One agent stopped. */
  stop: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: `${AGENT_PATH}/stop` }))
    .input(idParams)
    .output(EffectSchema.flip(codingAgentAnswerSchema)),
  /** One agent's changes, or those of the pull request of its repository the query numbers. */
  changes: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${AGENT_PATH}/changes` }))
    .input(
      EffectSchema.Struct({
        id: EffectSchema.String,
        number: EffectSchema.optionalKey(EffectSchema.String),
      }),
    )
    .output(EffectSchema.flip(codingAgentChangesAnswerSchema)),
  /** What the reviewer and label pickers of one agent's Pull request tab offer. */
  reviewOptions: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${AGENT_PATH}/review-options` }))
    .input(idParams)
    .output(EffectSchema.flip(codingAgentReviewOptionsAnswerSchema)),
  /** One agent's stopped sandbox resumed, on the developer's click. */
  sandboxResume: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: `${AGENT_PATH}/sandbox/resume` }))
    .input(idParams)
    .output(EffectSchema.flip(sandboxResumedAnswerSchema)),
  /** One agent's shells and where its sandbox stands. */
  terminals: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: TERMINALS_PATH }))
    .input(idParams)
    .output(EffectSchema.flip(terminalsAnswerSchema)),
  /** A shell started in one agent's sandbox. */
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
  /** One shell named anew, answering the shells as they stand after. */
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
  /** One shell ended, answering the shells as they stand after. */
  endTerminal: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: `${TERMINALS_PATH}/{terminal}` }))
    .input(terminalParams)
    .output(EffectSchema.flip(terminalsAnswerSchema)),
};
