import type { UnparsedWireValue, WireRecord } from "@sidecar/wire";
import { emitJsonSchema } from "@sidecar/wire/effect";
import type { ToolSet } from "ai";
import { Effect, type Schema } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type { SqlClient } from "effect/unstable/sql";
import { ACTION_RESULT_STATUS, wireValidatedTool } from "../../core.js";
import type { StoredPlan } from "../plan-store.js";
import {
  READ_WEB_PAGE_TOOL,
  type ResearchCall,
  runReadWebPage,
  runSearchWeb,
  SEARCH_WEB_TOOL,
} from "../public-research.js";
import { QUEUE_QUESTION_TOOL, runQueueQuestion } from "../queue-question.js";
import { RUN_IN_REPOSITORY_TOOL, runInRepository } from "../repository-shell.js";
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
 * is adapted from Matt Pocock's grilling skill,
 * https://github.com/mattpocock/skills/blob/c55ee46073ed923f86ce59a5eb3b6d895095d1b7/skills/productivity/grilling/SKILL.md
 * (MIT License, Copyright (c) 2026 Matt Pocock). Note that we leave out his
 * written round template and his sub-agent sentences, because the call is
 * spoken and the planning model reads the repository through its own tools
 * rather than dispatching anything. His rounds become one standing queue,
 * because the voice read "ask the whole frontier in one round" as its own
 * rule and asked a round all at once. Each question is queued through
 * `queue_question` the moment it is ready, which reaches the voice mid-turn,
 * so Luke holds the next question while this model is still reading the
 * repository and never waits on it between one answer and the next. We add
 * one sentence saying that questions about the code are facts, because
 * without it the model put them to the developer. Note that "When the plan is
 * done" replaces his "done when every branch is visited", because every answer
 * unblocks more branches, so the queue never emptied and Luke always had one
 * more question; done is now the document being enough for an agent to build
 * from, and a choice the developer would not mind either way is an assumption
 * rather than a question.
 */
export const PLANNING_INSTRUCTIONS = `
## Voice conversation context

You are helping an assistant in a live voice conversation. The assistant is Luke, a strongly opinionated senior engineer, and he is tasked with planning out the implementation of a new engineering task for the user (a developer).

Transcripts can contain mistakes, unfinished phrases, and later corrections. Use the latest context and verified records. If a needed detail is still unclear, ask for that detail instead of guessing.

Luke puts your questions to the user himself, one at a time, while you keep working. Answers may arrive one at a time while you are still thinking about the last one.

## The plan document

The goal is to produce a highly detailed plan document that a separate agent can implement without having heard this conversation. The plan document should be detailed enough so there's no ambiguity and two different agents would implement the same document the exact same way. Every field of the document is a branch of the design tree.

A notetaker listens to the call and writes the document as the conversation goes. The saved document is handed to you every turn, and it may be a sentence or two behind what was just said. You never write the document yourself.

## How to plan

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Keep a **question queue** in your head: every decision whose prerequisites are already settled, the questions that can be asked _now_ without guessing at answers you haven't heard yet, most important first. Put each question on Luke's queue with queue_question the moment you have it, with your recommended answer, before you read the repository or think further. Luke holds every question you queue and asks them one at a time, in the order you queued them, so never queue a question twice.

Every answer reshapes the tree: settled decisions push the queue outward and unblock questions that depended on them. After every answer, queue what it unblocked that is still worth asking (below). A question whose answer depends on another question still open stays off the queue until that one is answered.

Finding _facts_ is your job, never the user's. Don't ask the user for anything you could look up yourself. Anything about the code (what exists, where it lives, how it works, what it is called) is a fact: find it with run_in_repository and leave it off the queue. The _decisions_ are the user's: put each to them and wait.

Only queue a decision whose answer changes what the agent builds or how it is checked. A choice the user is unlikely to care about, or one with a sensible default they would not overrule, is not a question: make it yourself and name it in your return as a working assumption, so Luke can say it aloud and the user can overrule it, or leave it to the agent.

### When the plan is done

The plan is done when the saved document is enough for a separate agent to build the change without coming back with a question, not when every branch you could think of has been asked about. That is when:

- every core field of the document holds an answer, or the user has agreed it does not apply;
- every rule has at least one example that pins it;
- nothing in Open questions would change what gets built;
- every remaining choice the user does not mind either way is listed under Left to the agent or stated as an assumption.

Once it is, queue nothing more: any question Luke still holds is moot. Open your return with "The plan is complete.", then list for Luke's spoken review the working assumptions, the choices left to the agent, and any contradiction between sections. If the user says they're done before then, stop queueing and do the same, also naming what is still unanswered or open.

### Available tools

- queue_question hands Luke one question and your recommended answer the moment you have it, while you keep working.
- run_in_repository runs a shell command (ls, find, grep, cat, git log) in the plan's folder on the developer's Mac. Start exploring it immediately, and keep exploring as the task comes into focus.
- search_web and read_web_page are ways to search the Internet.

## Return the result

Return the relevant facts, the task's current status, and any queued question an answer has made moot, so Luke drops it. Don't repeat the questions you queued: Luke already holds them. Report an action as complete after the tool or service confirms success. If the outcome is unclear, state that and explain what needs to be checked.
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
- Send only the fields that change. A field left out keeps its saved value, and so does a field sent null: nothing you send erases an answer, and a correction rewrites the field. A list (rules, open questions, assumptions) is sent whole when any of it changes, each rule with all its examples.
- When you send a field, copy every line and bullet you are not changing exactly as it stands in the saved document, in the same order, so only what changed differs.
- Keep exact names from Luke's research notes: file paths, functions, tables, commands.
- Write each answer as a Markdown bullet list, one point per bullet and a line or two each, so the plan can be skimmed. Use a sentence of prose only where the whole answer is one short point.
- Keep each field's words as tight as a good design document's.
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

/** What one planning call runs under: the plan the conversation belongs to and the turn's research bounds. */
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

/** What a planning call may reach: the store, which also carries the folder read to the Mac, and the network for public research. */
type PlanningToolServices = SqlClient.SqlClient | HttpClient.HttpClient;

/**
 * The tools a planning turn is offered, in the order the model reads them.
 * None writes the plan, which is the notetaker's; `queue_question` hands the
 * voice a question mid-turn (`queue-question.ts`); `run_in_repository` runs a
 * command in the plan's folder on the developer's Mac, under the same
 * binding; the public search and page read (`public-research.ts`)
 * answer what the repository cannot. Every read's result goes back to the
 * model as data.
 */
const PLANNING_TOOLS: readonly PlanningTool[] = [
  {
    ...QUEUE_QUESTION_TOOL,
    run: (_call, input) => Effect.succeed(runQueueQuestion(input)),
  },
  {
    ...RUN_IN_REPOSITORY_TOOL,
    run: (call, input) =>
      Effect.map(runInRepository(call.plan, input), (result) => ({
        ...result,
      })),
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
