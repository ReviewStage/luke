import { boardText } from "@sidecar/hosted/board-text";
import type { Board } from "@sidecar/hosted/board-wire";
import { PLAN_FIELD, PLAN_FIELD_PURPOSE } from "@sidecar/hosted/plan-template";
import type { UnparsedWireValue, WireRecord } from "@sidecar/wire";
import { emitJsonSchema } from "@sidecar/wire/effect";
import type { ToolSet } from "ai";
import { Effect, type Schema } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type { SqlClient } from "effect/unstable/sql";
import type { ToolDefinition } from "eve/tools";
import { ACTION_RESULT_STATUS, wireValidatedTool } from "../../core.js";
import { DRAW_ON_BOARD_TOOL, runDrawOnBoard } from "../board-tool.js";
import type { PlanDocumentBinding } from "../plan-notes.js";
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
 * rather than a question. Note that "When the user is still working out what
 * they want" is ours too, because the grilling assumes a developer who
 * already holds the design and only needs it drawn out of them, and a
 * developer who came with a rough idea was pressed for decisions they had no
 * basis to make; an unsure answer now becomes concrete options to choose
 * from, and a recommendation taken as an assumption once there is no
 * preference.
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

### When the user is still working out what they want

Don't assume the user arrives knowing what to build. They may bring a finished design, or only a problem, a hunch, or a corner of the code that bothers them. Start from the problem, not the solution: while the idea is still rough, ask about who it is for and what goes wrong today before any detailed decision, and read the repository early so you can suggest directions that fit the code.

When the user is unsure, or answers "I don't know", don't press them for an answer. Queue the same decision again as concrete options instead: two or three directions grounded in what you found in the code, with the one you recommend and why. If they still have no preference, take your recommendation as a working assumption and move on. Never mistake a vague answer for a decision: a direction is settled only once the user has agreed to it.

### Facts and decisions

Finding _facts_ is your job, never the user's. Don't ask the user for anything you could look up yourself. Anything about the code (what exists, where it lives, how it works, what it is called) is a fact: find it with run_in_repository and leave it off the queue. The _decisions_ are the user's: put each to them and wait.

Only queue a decision whose answer changes what the agent builds or how it is checked. A choice the user is unlikely to care about, or one with a sensible default they would not overrule, is not a question: make it yourself and name it in your return as a working assumption, so Luke can say it aloud and the user can overrule it, or leave it to the agent.

### When the plan is done

The plan is done when the saved document is enough for a separate agent to build the change without coming back with a question, not when every branch you could think of has been asked about. That is when:

- every core field of the document holds an answer, or the user has agreed it does not apply;
- every rule has at least one example that pins it;
- nothing in Open questions would change what gets built;
- every remaining choice the user does not mind either way is listed under Left to the agent or stated as an assumption.

Once it is, queue nothing more: any question Luke still holds is moot. Open your return with "The plan is complete.", then list for Luke's spoken review the working assumptions, the choices left to the agent, and any contradiction between sections. If the user says they're done before then, stop queueing but never say the plan is complete: open your return with "The plan is not complete yet.", name each field still unanswered and each open decision that would change what gets built, then list the same review.

### The whiteboard

The plan has a whiteboard the developer sees beside the document and can draw on too. Draw on it with draw_on_board when a picture helps the user decide: the components a change touches and how they connect, a flow with its branches, or the options for a decision side by side. Draw when the user asks you to, or when a structure is hard to follow by voice alone, and tell Luke in your return what you drew so he can talk the user through it. Keep a drawing small: a handful of labelled boxes and the arrows between them, laid out left to right or top to bottom. Each call sends the whole diagram and replaces your previous drawing, so to change it, send it again with the change; what the developer drew stays.

The board as it stands is handed to you every turn under [board], with every element's id. Anything the developer drew or moved since your last turn is there: read it as part of what they are telling you, and ask about it when its meaning is unclear.

### Available tools

- queue_question hands Luke one question and your recommended answer the moment you have it, while you keep working.
- run_in_repository runs a shell command (ls, find, grep, cat, git log) in the plan's folder on the developer's Mac. Start exploring it immediately, and keep exploring as the task comes into focus.
- search_web and read_web_page are ways to search the Internet.
- draw_on_board draws a diagram of shapes, arrows, and text on the plan's whiteboard, replacing your previous one.

## Return the result

Return the relevant facts, the task's current status, and any queued question an answer has made moot, so Luke drops it. Don't repeat the questions you queued: Luke already holds them. Report an action as complete after the tool or service confirms success. If the outcome is unclear, state that and explain what needs to be checked.
`;

/** Each field a note may be taken under, and what it holds, one line apiece for the notetaker. */
const SCRIBE_FIELDS = Object.values(PLAN_FIELD)
  .map((field) => `- ${field}: ${PLAN_FIELD_PURPOSE[field]}`)
  .join("\n");

/**
 * The instructions the plan's notetaker runs under: the scribe that listens
 * to a planning call and takes notes into the plan while Luke and the
 * developer talk (`apps/web/server/voice/plan-scribe.ts`). It decides nothing
 * of the conversation; it records what was said, one note at a time.
 */
export const SCRIBE_INSTRUCTIONS = `
You are the notetaker on a live voice call between Luke, a senior engineer, and a developer who are planning a new engineering task together. You take notes into the plan while they talk, the way a person takes notes on a call: each new point written under the heading it belongs to, a correction made where the old words stand, and a retracted point struck.

The goal is a plan detailed enough that a separate agent could implement it without having heard the call, and two different agents would implement it the same way.

You are handed the saved plan as its fields, the call's latest lines, and Luke's research notes. Answer with the notes the latest lines call for, in the order they were said:

- add: a new point under a field. In a text field it is one Markdown bullet, a line or two, added after what the field holds. In openQuestions or assumptions it is one item. In rules it is one rule's statement, one sentence that holds in every case.
- addExample: a concrete example pinning a rule, given, when, and then, the rule named by its number.
- replace: a correction, where the developer corrected something the plan holds. find is a phrase copied exactly from the saved field, as short as names one place; text is what it becomes.
- remove: a point the developer retracted. find is a phrase copied exactly from the line, item, rule, or example to strike.

- Write only what the developer stated, agreed to, or clearly implied. Luke's proposals and research count once the developer has agreed to them. Never write a guess.
- Never restate or reword a point the plan already holds. A note is only what is new or what changed.
- Keep exact names from Luke's research notes: file paths, functions, tables, commands.
- Keep each note as tight as a good design document's line.
- When the latest lines change nothing, answer with no notes.

The fields:
${SCRIBE_FIELDS}

Transcripts can contain mistakes, unfinished phrases, and later corrections. Follow the latest correction.
`;

/** The marker the standing context rides behind, so the model reads what follows as the service's data. */
const PLAN_MARKER = "[plan]";
const DOCUMENT_MARKER = "[saved document]";

/**
 * What a planning turn is handed beside its instructions every turn: the
 * plan's name, the saved document as JSON, and the whiteboard as the model
 * reads it (`board-text.ts`), each read again every turn so what the
 * notetaker saved and what the developer drew is what the next turn reads. A
 * plan that no longer stands gets the heading alone.
 */
export function planningStandingContext(
  stored: StoredPlan | undefined,
  board: Board,
  now: number,
): string {
  const heading = `${PLAN_MARKER} ${new Date(now).toISOString()}`;
  if (!stored) return heading;
  const { plan } = stored;
  return [
    heading,
    `Name: ${plan.name}`,
    DOCUMENT_MARKER,
    JSON.stringify(plan.document),
    boardText(board),
  ].join("\n");
}

/**
 * One tool as eve is told of it: the name, words, and wire schema as JSON.
 * Nothing but data, because eve keeps what a dynamic tool resolver returns
 * across its durable steps and admits no closure that captures anything
 * else; the execution is bound in the eve project's own file, over these
 * declarations and the host it imports.
 */
export interface HostedToolDeclaration {
  readonly name: string;
  readonly description: string;
  /** The wire schema's JSON, as eve takes a plain JSON Schema input. */
  readonly inputSchema: ToolDefinition["inputSchema"];
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
 * answer what the repository cannot; `draw_on_board` draws on the plan's
 * whiteboard under the same binding (`board-tool.ts`). Every read's result
 * goes back to the model as data.
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
  {
    ...DRAW_ON_BOARD_TOOL,
    run: (call, input) => Effect.map(runDrawOnBoard(call.plan, input), (result) => ({ ...result })),
  },
];

const PLANNING_TOOLS_BY_NAME = new Map(PLANNING_TOOLS.map((tool) => [tool.name, tool]));

/** The declarations every turn is offered, whatever kind of turn opened it. */
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
