/**
 * agents.ts -- a coding agent as the desktop lists, starts, reads, changes, and stops it, its changes and review options, and its shells (`agent-wire.ts`, `terminal-wire.ts`).
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
 * takes the agent for good, as a task's delete takes a task. No path starts
 * a fresh agent on no task. Outputs are the
 * wire schemas flipped (`packages/service/src/orpc/base.ts`).
 *
 * Every procedure declares its own refusals (`declaredProcedure`).
 */

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
import { HOSTED_API_ERROR } from "../service-wire.js";
import {
  sandboxResumedAnswerSchema,
  terminalCreatedAnswerSchema,
  terminalCreateRequestSchema,
  terminalRenameRequestSchema,
  terminalsAnswerSchema,
} from "../terminal-wire.js";
import { workspaceToolsAnswerSchema } from "../workspace-tools-wire.js";
import { bodyCap, declaredProcedure, exactBodyInput, refuses } from "./base.js";

/** A change names a model, an effort, and a window, a title, an archive, or a pin, at most, so a body past this is no change. */
const CHOICE_BODY_BYTES = 4_096;

/** A shell's name and a few keys at JSON's widest escape, so a body past this names no shell. */
const TERMINAL_BODY_BYTES = 1_024;

/**
 * What every route in an agent's sandbox refuses (`sandbox-reach.ts`): an
 * agent not found, not the caller's to reach, or archived, and a sandbox
 * Vercel did not answer for or whose snapshot is gone.
 */
const SANDBOX_REFUSALS = [
  HOSTED_API_ERROR.NOT_FOUND,
  HOSTED_API_ERROR.NOT_PERMITTED,
  HOSTED_API_ERROR.AGENT_RETIRED,
  HOSTED_API_ERROR.SANDBOX_SNAPSHOT_GONE,
  HOSTED_API_ERROR.UPSTREAM_ERROR,
] as const;

/** A route in an agent's sandbox, refusing as every one does. */
const sandboxProcedure = declaredProcedure.errors(refuses(...SANDBOX_REFUSALS));

/** A route that acts on a shell, refusing too as a sandbox not yet opened or stopped. */
const shellProcedure = sandboxProcedure.errors(
  refuses(HOSTED_API_ERROR.AGENT_NOT_READY, HOSTED_API_ERROR.SANDBOX_STOPPED),
);

/**
 * What an agent stopped for good before an archive or a delete refuses
 * (`coder-host/stop.ts`'s `stoppedForGood`): an agent not found or not the
 * caller's to write, one still starting or running after the Stop, and
 * why a harness's cancel failed (`runtime-sessions.ts`'s
 * `failedCallRefusal`), its session ended, its host removed or away, or its
 * harness not reached from here.
 */
export const STOP_REFUSALS = [
  HOSTED_API_ERROR.NOT_FOUND,
  HOSTED_API_ERROR.NOT_PERMITTED,
  HOSTED_API_ERROR.AGENT_NOT_READY,
  HOSTED_API_ERROR.NATIVE_AGENT_NOT_HERE,
  HOSTED_API_ERROR.AGENT_RETIRED,
  HOSTED_API_ERROR.DEVICE_REMOVED,
  HOSTED_API_ERROR.LOCAL_AGENT_REFUSED,
] as const;

/**
 * What one agent stopped refuses (`coder-host/stop.ts`'s `stoppedAgent`): as
 * an agent stopped for good does, but that a Stop never waits on a turn
 * still starting, so never answers that the agent is not ready.
 */
const AGENT_STOP_REFUSALS = [
  HOSTED_API_ERROR.NOT_FOUND,
  HOSTED_API_ERROR.NOT_PERMITTED,
  HOSTED_API_ERROR.NATIVE_AGENT_NOT_HERE,
  HOSTED_API_ERROR.AGENT_RETIRED,
  HOSTED_API_ERROR.DEVICE_REMOVED,
  HOSTED_API_ERROR.LOCAL_AGENT_REFUSED,
] as const;

/**
 * What one change of an agent refuses: an archive's Stop, a key already
 * written under (`writeReceiptMiddleware`), and a repository added refused
 * by why (`agent-repository-add.ts`), out of reach, unread off GitHub, or
 * its branch gone. A choice the catalog refuses is an invalid request.
 */
const CHANGE_REFUSALS = [
  ...STOP_REFUSALS,
  HOSTED_API_ERROR.ALREADY_WRITTEN,
  HOSTED_API_ERROR.EXTRA_REPOSITORY_REFUSED,
  HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
  HOSTED_API_ERROR.GITHUB_UNANSWERED,
  HOSTED_API_ERROR.BRANCH_NOT_FOUND,
] as const;

/**
 * What a Start refuses, on a task or from an agent (`coder-host/start.ts`,
 * `takeover.ts`): a task or a source agent not found or not the caller's to
 * start from, no repository to check out, a branch gone, a repository out
 * of reach or unread off GitHub, extras refused by why, and why the
 * agent's sessions would not take it (`runtime-sessions.ts`'s
 * `failedCallRefusal`): its device away or removed, a plan or a key that
 * cannot pay, its harness not reached, or the agent gone from its routing.
 * A choice the catalog refuses is an invalid request.
 */
const START_REFUSALS = [
  HOSTED_API_ERROR.NOT_FOUND,
  HOSTED_API_ERROR.NOT_PERMITTED,
  HOSTED_API_ERROR.NO_REPOSITORY,
  HOSTED_API_ERROR.BRANCH_NOT_FOUND,
  HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
  HOSTED_API_ERROR.GITHUB_UNANSWERED,
  HOSTED_API_ERROR.EXTRA_REPOSITORY_REFUSED,
  HOSTED_API_ERROR.LOCAL_AGENT_REFUSED,
  HOSTED_API_ERROR.DEVICE_REMOVED,
  HOSTED_API_ERROR.AGENT_CREDENTIAL_MISSING,
  HOSTED_API_ERROR.AGENT_API_KEY_UNREADABLE,
  HOSTED_API_ERROR.AGENT_PLAN_SIGNED_OUT,
  HOSTED_API_ERROR.AGENT_PLAN_UNREACHABLE,
  HOSTED_API_ERROR.AGENT_PLAN_LIMIT_REACHED,
  HOSTED_API_ERROR.AGENT_PLAN_INELIGIBLE,
  HOSTED_API_ERROR.AGENT_RETIRED,
  HOSTED_API_ERROR.NATIVE_AGENT_NOT_HERE,
] as const;

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

/** How many of a workspace's agents a page passes over, as its query carries it: a whole number from zero. */
const offsetQuery = EffectSchema.NumberFromString.pipe(
  EffectSchema.decodeTo(EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0))),
);

/** What a list's `archived` query may say, read as the old groups read it: `include`, or anything else for none. */
const archivedQuery = EffectSchema.optionalKey(EffectSchema.String);

/**
 * One change of an agent (PATCH): its title, its archive, its pin, the
 * reader's read mark, its MCP servers, a repository added beside its own,
 * or its model and effort, read in that order as the old group read them.
 */
const agentChangeRequestSchema = EffectSchema.Union([
  agentRenameRequestSchema,
  agentArchiveRequestSchema,
  agentPinRequestSchema,
  agentReadRequestSchema,
  agentServersRequestSchema,
  agentAddRepositoryRequestSchema,
  modelChoiceSchema,
]);

/** A change as it travels. */
export type AgentChangeRequest = typeof agentChangeRequestSchema.Encoded;

/** A Start's answer: its status, and the agent. */
const startAnswerSchema = EffectSchema.Struct({
  status: EffectSchema.Literals(Object.values(AGENT_START_STATUS)),
  body: agentAnswerSchema,
});

export const agentsContract = {
  /** A page of a workspace's agents, newest started first, narrowed as the query asks, from its `offset`. */
  listOfWorkspace: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
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
  /** One task's agents with their status. */
  listOfTask: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${HOSTED_SERVICE_PATH.TASKS}/{id}/agents` }))
    .input(
      EffectSchema.Struct({
        id: EffectSchema.String,
        [AGENT_LIST_QUERY.ARCHIVED]: archivedQuery,
      }),
    )
    .output(EffectSchema.flip(agentListAnswerSchema)),
  /** An agent started on the task, or the one a retry under the same key already started. */
  start: declaredProcedure
    .errors(refuses(...START_REFUSALS))
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
  /** An agent started from the one the path names, continuing it or forking it, in that agent's own place: its task, or its workspace and repository where it has no task. */
  startFrom: declaredProcedure
    .errors(refuses(...START_REFUSALS))
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
  /** One agent as its own page. */
  read: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(openapi({ method: HTTP_METHOD.GET, path: AGENT_PATH }))
    .input(idParams)
    .output(EffectSchema.flip(agentPageAnswerSchema)),
  /** One change of an agent, answering it as it then stands. */
  change: declaredProcedure
    .errors(refuses(...CHANGE_REFUSALS))
    .meta(bodyCap(CHOICE_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.PATCH, path: AGENT_PATH, inputStructure: "detailed" }))
    .input(exactBodyInput(idParams, agentChangeRequestSchema))
    .output(EffectSchema.flip(agentAnswerSchema)),
  /** One agent deleted for good, stopped first where it still works. */
  delete: declaredProcedure
    .errors(refuses(...STOP_REFUSALS))
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: AGENT_PATH }))
    .input(idParams)
    .output(EffectSchema.flip(agentDeleteAnswerSchema)),
  /** One agent stopped. */
  stop: declaredProcedure
    .errors(refuses(...AGENT_STOP_REFUSALS))
    .meta(openapi({ method: HTTP_METHOD.POST, path: `${AGENT_PATH}/stop` }))
    .input(idParams)
    .output(EffectSchema.flip(agentAnswerSchema)),
  /** One agent taken back to just before one of the developer's lines, stopped first where it still works. */
  rewind: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
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
  /** One agent's changes, or those of the pull request of its repository the query numbers. */
  changes: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE))
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${AGENT_PATH}/changes` }))
    .input(
      EffectSchema.Struct({
        id: EffectSchema.String,
        number: EffectSchema.optionalKey(EffectSchema.String),
      }),
    )
    .output(EffectSchema.flip(agentChangesAnswerSchema)),
  /** What the reviewer and label pickers of one agent's Pull request tab offer. */
  reviewOptions: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE))
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${AGENT_PATH}/review-options` }))
    .input(idParams)
    .output(EffectSchema.flip(agentReviewOptionsAnswerSchema)),
  /** Whose Mac one agent's `run_on_mac` runs on, and whether it would run there now, as its composer reads it. */
  workspaceTools: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${AGENT_PATH}/workspace-tools` }))
    .input(idParams)
    .output(EffectSchema.flip(workspaceToolsAnswerSchema)),
  /** One agent's stopped sandbox resumed, on the developer's click. */
  sandboxResume: sandboxProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: `${AGENT_PATH}/sandbox/resume` }))
    .input(idParams)
    .output(EffectSchema.flip(sandboxResumedAnswerSchema)),
  /** One agent's shells and where its sandbox stands. */
  terminals: sandboxProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: TERMINALS_PATH }))
    .input(idParams)
    .output(EffectSchema.flip(terminalsAnswerSchema)),
  /** A shell started in one agent's sandbox. */
  openTerminal: shellProcedure
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
  renameTerminal: shellProcedure
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
  endTerminal: shellProcedure
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: `${TERMINALS_PATH}/{terminal}` }))
    .input(terminalParams)
    .output(EffectSchema.flip(terminalsAnswerSchema)),
};
