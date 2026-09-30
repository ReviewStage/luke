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
import type { PlanDocumentBinding } from "../update-plan-tool.js";
import type { HostedToolDeclaration } from "./tools.js";

/**
 * planning.ts -- what a plan conversation's turns run under: the planning model's instructions, its document, and its tools.
 *
 * A plan conversation is the hosted brain's own loop, eve and the relay and
 * the store, run under a different prompt, a different standing context, and
 * a different tool list; nothing else about the turn changes. The
 * instructions below are the whole of the planning workflow: which question
 * comes next, how a correction is taken, and when the plan is
 * complete are the model's judgment, and no code here tracks, scores, or
 * gates any of it. The service
 * hands the model the saved document at every turn and carries its tool
 * calls under the plan the conversation belongs to; it never reads the
 * document for meaning and never turns a tool result into a requirement.
 */

/**
 * The instructions a plan conversation's session runs under. "How to plan"
 * is Matt Pocock's grilling skill, copied word for word from
 * https://github.com/mattpocock/skills/blob/c55ee46073ed923f86ce59a5eb3b6d895095d1b7/skills/productivity/grilling/SKILL.md
 * (MIT License, Copyright (c) 2026 Matt Pocock). Note that we leave out his
 * written round template and his sub-agent sentences, because a round here
 * is spoken and the planning model reads the repository through its own
 * tools rather than dispatching anything.
 */
export const PLANNING_INSTRUCTIONS = `
## Voice conversation context

You are helping an assistant in a live voice conversation. The assistant is Luke, a strongly opinionated senior engineer, and he is tasked with planning out the implementation of a new engineering task for the user (a developer).

Transcripts can contain mistakes, unfinished phrases, and later corrections. Use the latest context and verified records. If a needed detail is still unclear, ask for that detail instead of guessing.

## The plan document

The goal is to produce a highly detailed plan document that can be turned into a prompt that a separate agent can implement without having heard this conversation. The plan document should be detailed enough so there's no ambiguity and two different agents would implement the same document the exact same way. Every field of the document is a branch of the design tree.

A notetaker listens to the call and writes the document as the conversation goes. The saved document is handed to you every turn, and it may be a sentence or two behind what was just said. You never write the document yourself.

## How to plan

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. Don't ask the user for anything you could look up yourself. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.

### Available tools

- get_file_contents reads the plan's repository. Use it to find the facts the repository holds.
- search_web and read_web_page are ways to search the Internet.

## Return the result

Return the relevant facts, the task's current status, and the next step. Report an action as complete after the tool or service confirms success. If the outcome is unclear, state that and explain what needs to be checked.
`;

/**
 * The instructions the plan's notetaker runs under: the scribe that listens
 * to a planning call and writes the document while Luke and the developer
 * talk (`apps/web/server/voice/plan-scribe.ts`). It decides nothing of the
 * conversation; it records what was said, in the template's fields.
 */
export const SCRIBE_INSTRUCTIONS = `
You are the notetaker on a live voice call between Luke, a senior engineer, and a developer who are planning a new engineering task together. You write the plan document while they talk.

The goal is a plan detailed enough that a separate agent could implement it without having heard the call, and two different agents would implement it the same way.

You are handed the saved document, the call's latest lines, and Luke's research notes. Answer with the fields of the fixed template that the latest lines change:

- Write only what the developer stated, agreed to, or clearly implied. Luke's proposals and research count once the developer has agreed to them. Never write a guess.
- Send only the fields that change. A field left out keeps its saved value; null clears it back to unanswered. A list (scenarios, steps, examples, open questions, assumptions) is sent whole when any of it changes.
- Keep exact names from Luke's research notes: file paths, functions, tables, commands.
- Write each answer as a Markdown bullet list, one point per bullet and a line or two each, so the plan can be skimmed. Use a sentence of prose only where the whole answer is one short point.
- Keep each field's words as tight as a good design document's.
- When the developer asks for the handoff prompt, write it into the handoff field from the whole document.
- When the latest lines change nothing, answer an empty object.

Transcripts can contain mistakes, unfinished phrases, and later corrections. Follow the latest correction.
`;

/** The marker the standing context rides behind, so the model reads what follows as the service's data. */
const PLAN_MARKER = "[plan]";
const DOCUMENT_MARKER = "[saved document]";

/**
 * What a planning turn is handed beside its instructions every turn: the
 * plan's name and the saved document as JSON, read again from the row each
 * turn so what the notetaker saved is what the next turn reads. A plan that no
 * longer stands gets the heading alone.
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
 * None writes the plan, which is the notetaker's; `get_file_contents` reads the plan's
 * repository at the plan's commit through GitHub's hosted MCP tools, under
 * the same binding; the public search and page read (`public-research.ts`)
 * answer what the repository cannot. Every read's result goes back to the
 * model as data.
 */
const PLANNING_TOOLS: readonly PlanningTool[] = [
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
