import type { UnparsedWireValue, WireRecord } from "@sidecar/wire";
import { emitJsonSchema } from "@sidecar/wire/effect";
import type { ToolSet } from "ai";
import { Effect, type Schema } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type { SqlClient } from "effect/unstable/sql";
import { ACTION_RESULT_STATUS, wireValidatedTool } from "../../core.js";
import type { GitHubAccess } from "../github-source.js";
import type { StoredPlan } from "../plan-store.js";
import {
  READ_WEB_PAGE_TOOL,
  type ResearchCall,
  runReadWebPage,
  runSearchWeb,
  SEARCH_WEB_TOOL,
} from "../public-research.js";
import { GET_FILE_CONTENTS_TOOL, runGetFileContents } from "../repository-tools.js";
import { type PlanDocumentBinding, runUpdatePlan, UPDATE_PLAN_TOOL } from "../update-plan-tool.js";
import type { HostedToolDeclaration } from "./tools.js";

/**
 * planning.ts -- what a plan conversation's turns run under: the planning model's instructions, its document, and its tools.
 *
 * A plan conversation is the hosted brain's own loop, eve and the relay and
 * the store, run under a different prompt, a different standing context, and
 * a different tool list; nothing else about the turn changes. The
 * instructions below are the whole of the planning workflow: which question
 * comes next, how a correction moves the document, and when the plan is
 * complete are the model's judgment, and no code here tracks, scores, or
 * gates any of it. The service
 * hands the model the saved document at every turn and carries its tool
 * calls under the plan the conversation belongs to; it never reads the
 * document for meaning and never turns a tool result into a requirement.
 */

/** The instructions a plan conversation's session runs under, adapted from the grilling approach the project settled on. */
export const PLANNING_INSTRUCTIONS = `
## Voice conversation context

You are helping an assistant in a live voice conversation. The assistant is Luke, a strongly opinionated senior engineer, and he is tasked with planning out the implementation of a new engineering task for the user (a developer). 

Transcripts can contain mistakes, unfinished phrases, and later corrections. Use the latest context and verified records. If a needed detail is still unclear, ask for that detail instead of guessing.

## Task instructions

The goal is to produce a highly detailed plan document that can be turned into a prompt that a separate agent can implement without having heard this conversation. The plan document should be detailed enough so there's no ambiguity and two different agents would implement the same document the exact same way. 

Your task is to completely fill out the plan document by asking the user questions until the plan is complete. You are not allowed to write anything to the document that you assumed or guessed, only what the user has explicitly stated or implied.

What to cover.

- purpose and users;
- scope, and what is out of it;
- the repository context the feature touches;
- observable behavior, step by step;
- the exceptions and failures that apply;
- acceptance examples;
- the coding choices left to the implementing agent;
- every assumption still unresolved.

### Available tools

- update_plan is the only way to change the document. Write to the document as often as possible so the user can see the plan progress.
- get_file_contents reads the plan's repository. Use it to fully understand the repository context and the feature's scope.
- search_web and read_web_page are ways to search the Internet.

## Return the result

Return the relevant facts, the task's current status, and the next step. Report an action as complete after the tool or service confirms success. If the outcome is unclear, state that and explain what needs to be checked.
`;

/** The marker the standing context rides behind, so the model reads what follows as the service's data. */
const PLAN_MARKER = "[plan]";
const DOCUMENT_MARKER = "[saved document]";

/**
 * What a planning turn is handed beside its instructions every turn: the
 * plan's name and the saved document as JSON, read again from the row each
 * turn so a save the model made is what the next turn reads. A plan that no
 * longer stands gets the heading alone; update_plan says why it cannot save.
 */
export function planningStandingContext(stored: StoredPlan | undefined, now: number): string {
  const heading = `${PLAN_MARKER} ${new Date(now).toISOString()}`;
  if (!stored) return heading;
  const { plan } = stored;
  return [heading, `Name: ${plan.name}`, DOCUMENT_MARKER, JSON.stringify(plan.document)].join("\n");
}

/**
 * The saved document the standing context carries, read back from its text;
 * nothing where the text carries none. The scripted fixture model reads its
 * document this way, which is the only reader: the service never parses the
 * text it composed.
 */
export function documentTextOf(standingContext: string): string | undefined {
  const lines = standingContext.split("\n");
  const at = lines.indexOf(DOCUMENT_MARKER);
  return at === -1 ? undefined : lines[at + 1];
}

/** What one planning call runs under: the plan the conversation belongs to, and the turn's research bounds. */
export interface PlanningCall {
  readonly plan: PlanDocumentBinding;
  readonly research: ResearchCall;
}

/** One tool a planning turn is offered: its declaration, and the call it carries under the plan the conversation belongs to. */
interface PlanningTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Schema.Codec<unknown, UnparsedWireValue>;
  readonly run: (
    call: PlanningCall,
    input: UnparsedWireValue,
  ) => Effect.Effect<WireRecord, never, PlanningToolServices>;
}

/** What a planning call may reach: the store, the account's GitHub access for the repository read, and the network for public research. */
type PlanningToolServices = SqlClient.SqlClient | GitHubAccess | HttpClient.HttpClient;

/**
 * The tools a planning turn is offered, in the order the model reads them.
 * `update_plan` is the one write; `get_file_contents` reads the plan's
 * repository at the plan's commit through GitHub's hosted MCP tools, under
 * the same binding; the public search and page read (`public-research.ts`)
 * answer what the repository cannot. Every read's result goes back to the
 * model as data.
 */
const PLANNING_TOOLS: readonly PlanningTool[] = [
  {
    ...UPDATE_PLAN_TOOL,
    run: (call, input) => Effect.map(runUpdatePlan(call.plan, input), (result) => ({ ...result })),
  },
  {
    ...GET_FILE_CONTENTS_TOOL,
    run: (call, input) =>
      Effect.map(runGetFileContents(call.plan, input), (result) => ({ ...result })),
  },
  {
    ...SEARCH_WEB_TOOL,
    run: (call, input) =>
      Effect.map(runSearchWeb(call.research, input), (result) => ({ ...result })),
  },
  {
    ...READ_WEB_PAGE_TOOL,
    run: (call, input) =>
      Effect.map(runReadWebPage(call.research, input), (result) => ({ ...result })),
  },
];

const PLANNING_TOOLS_BY_NAME = new Map(PLANNING_TOOLS.map((tool) => [tool.name, tool]));

/** The declarations every planning turn is offered, whatever kind of turn opened it. */
export function planningToolDeclarations(): readonly HostedToolDeclaration[] {
  return PLANNING_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: emitJsonSchema(tool.inputSchema),
  }));
}

/** The planning tools as stored rows are held to them, so a turn's calls are written and read back like the catalog's. */
export function planningToolSet(): ToolSet {
  return Object.fromEntries(
    PLANNING_TOOLS.map((tool) => [
      tool.name,
      wireValidatedTool(tool.description, tool.inputSchema),
    ]),
  );
}

/** Why a planning call ran nothing, in words the model can act on. */
const PLANNING_REFUSAL = {
  NO_TOOL: "Not run: planning offers no tool of that name.",
  NO_PLAN: "Not run: this plan no longer exists.",
} as const;

/**
 * Carries one planning call under the plan the conversation belongs to, or
 * answers why it ran nothing: a name outside the list, or a conversation whose
 * plan no longer stands. Every outcome is a result the model reads.
 */
export function runPlanningTool(
  name: string,
  call: PlanningCall | undefined,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, PlanningToolServices> {
  const tool = PLANNING_TOOLS_BY_NAME.get(name);
  if (!tool) {
    return Effect.succeed({
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: PLANNING_REFUSAL.NO_TOOL,
    });
  }
  if (!call) {
    return Effect.succeed({
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: PLANNING_REFUSAL.NO_PLAN,
    });
  }
  return tool.run(call, input);
}
