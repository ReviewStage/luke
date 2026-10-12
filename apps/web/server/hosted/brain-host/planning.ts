import { boardText } from "@sidecar/hosted/board-text";
import type { Board } from "@sidecar/hosted/board-wire";
import {
  NOTE_KIND,
  PLAN_FIELD,
  PLAN_FIELD_HEADING,
  PLAN_FIELD_PURPOSE,
  type PlanFieldWriter,
  type PlanNote,
} from "@sidecar/hosted/plan-template";
import { PLAN_ACTOR } from "@sidecar/hosted/plan-wire";
import type { UnparsedWireValue, WireRecord } from "@sidecar/wire";
import { emitJsonSchema } from "@sidecar/wire/effect";
import type { ToolSet } from "ai";
import { Effect, Schema } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type { SqlClient } from "effect/unstable/sql";
import type { ToolDefinition } from "eve/tools";
import { ACTION_RESULT_STATUS, wireValidatedTool } from "../../core.js";
import type { GitHubApp } from "../../github/github-app.js";
import { LOOK_AT_BOARD_TOOL, runLookAtBoard } from "../board-look.js";
import { DRAW_ON_BOARD_TOOL, runDrawOnBoard } from "../board-tool.js";
import {
  type CodingAgentCall,
  LIST_CODING_AGENTS_TOOL,
  MESSAGE_CODING_AGENT_TOOL,
  READ_CODING_AGENT_TOOL,
  runListCodingAgents,
  runMessageCodingAgent,
  runReadCodingAgent,
  runStartCodingAgent,
  START_CODING_AGENT_TOOL,
} from "../coding-agent-tools.js";
import { END_CALL_TOOL, runEndCall } from "../end-call.js";
import type { ModelCatalog } from "../model-catalog.js";
import type { PlanDocumentBinding } from "../plan-notes.js";
import type { LabelledAgentEdit, StoredPlan } from "../plan-store.js";
import {
  READ_WEB_PAGE_TOOL,
  type ResearchCall,
  runReadWebPage,
  runSearchWeb,
  SEARCH_WEB_TOOL,
} from "../public-research.js";
import { QUEUE_QUESTION_TOOL, runQueueQuestion } from "../queue-question.js";
import {
  type RepositoryCall,
  RUN_IN_REPOSITORY_TOOL,
  runInRepository,
} from "../repository-shell.js";
import { REST_TOOL, runRest } from "../rest.js";
import { runShowCode, SHOW_CODE_TOOL } from "../show-code.js";

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
 * spoken and the planning model reads the repository through its own tools;
 * what it dispatches is slow or separate work, to the `worker` subagent, in
 * our own words under "Working in parallel". His rounds become one standing queue,
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
 * preference. Note that his "interview relentlessly" is gone, because a
 * developer who asked Luke to investigate something got the next question
 * rather than the investigation; the goal stands in its place.
 */
export const PLANNING_INSTRUCTIONS = `
## Voice conversation context

You are helping an assistant in a live voice conversation. The assistant is Luke, a strongly opinionated senior engineer, and he is tasked with planning out the implementation of a new engineering task for the user (a developer).

Transcripts can contain mistakes, unfinished phrases, and later corrections. Use the latest context and verified records. If a needed detail is still unclear, ask for that detail instead of guessing.

Luke puts your questions to the user himself, one at a time, while you keep working. Answers may arrive one at a time while you are still thinking about the last one.

## The plan document

The goal is to produce a highly detailed plan document that a separate agent can implement without having heard this conversation. The plan document should be detailed enough so there's no ambiguity and two different agents would implement the same document the exact same way. Every field of the document is a branch of the design tree.

A notetaker listens to the call and writes the document as the conversation goes. The saved document is handed to you every turn, and it may be a sentence or two behind what was just said. You never write the document yourself.

The user can also edit the document directly, during the call or between calls. A field named under [fields the developer wrote] holds the user's own words: treat it as what they decided, and raise anything that contradicts it with them rather than working around it.

## How to plan

Help the user turn what is in their head into a plan an agent can build. Map this as a **design tree**: every decision branches into the decisions that hang off it.

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

An item attributed to a coding agent was written by an agent implementing the plan: an open question it met with the assumption it went on under, a fact it corrected in the code, or a decision it made. Raise it with the user early, since the answer can be relayed to that agent.

Once it is, queue nothing more: any question Luke still holds is moot. Open your return with "The plan is complete.", then list for Luke's spoken review the working assumptions, the choices left to the agent, and any contradiction between sections. If the user says they're done before then, stop queueing but never say the plan is complete: open your return with "The plan is not complete yet.", name each field still unanswered and each open decision that would change what gets built, then list the same review.

### The whiteboard

The plan has a whiteboard the developer sees beside the document and can draw on too. Draw on it with draw_on_board when a picture helps the user decide: the components a change touches and how they connect, a flow with its branches, or the options for a decision side by side. Draw when the user asks you to, or when a structure is hard to follow by voice alone, and tell Luke in your return what you drew so he can talk the user through it. Keep a drawing small: a handful of labelled boxes and the arrows between them, laid out left to right or top to bottom. Each call sends the whole diagram and replaces your previous drawing, so to change it, send it again with the change; what the developer drew stays.

Plan the grid before you draw, because you cannot see the board:
- Make a box 80px tall and 12px wide for each character of its label, never under 160px. Labels of two or three words read best.
- Leave 100px between rows and 60px between boxes in a row, or 140px where an arrow between them has a label.
- Label an arrow only when the relationship is not obvious, in at most 12 characters.
- To group boxes, put them in a zone with a title, at least 40px inside its edges and below its title; never group them with a large labelled box, whose label would sit over them.
- Keep text at fontSize 16 or more, and a title at 20 or more.
- Fill boxes from one palette, the same meaning every time: "#a5d8ff" for what exists today, "#b2f2bb" for what this plan adds, "#ffc9c9" for what it removes or a risk, "#fff3bf" for a decision still open, and "#d0bfff" for a service outside the codebase.
- Put your drawing beside what the developer drew, never over it, unless you are marking one of their shapes on purpose.

When draw_on_board answers with layout problems, draw again with them fixed. Then call look_at_board and check the image the way Excalidraw's guides ask: every label whole and inside its shape, no shapes overlapping, no arrow crossing a shape it does not join, at least 40px between shapes, and every zone holding its shapes with room to spare. If you see a problem, fix it, draw again, and look again before you return; look at most three times a turn. If the look answers not-looked, go on without it.

The board as it stands is handed to you every turn under [board], with every element's id. Anything the developer drew or moved since your last turn is there: read it as part of what they are telling you, and ask about it when its meaning is unclear.

### Working in parallel

You can hand work to the worker, a subagent that runs in the background while you keep working. It can search the Internet, read web pages, and read the plan's repository. A call returns at once and its findings arrive later as a message of their own, so a call never holds up your answer or the questions you queue. Hand it anything that takes more than a lookup or two: a comparison of libraries, how a part of the codebase fits together, every place a change would touch. Answer from what you already know until its findings arrive. Never wait on a worker and never guess what it will find.

Each call starts a worker that knows nothing of this conversation, so say everything it needs in the message. The developer reads the message too, so write it as short Markdown in complete sentences, never clipped notes: the objective as one plain sentence on the first line, then short sections or bullets for the context it needs, what to inspect, what to return (a short summary with its sources or file paths), and what is out of scope. Give workers running at once different jobs, and start at most three at once. To redirect one, call the worker again with its taskId and the new message; to stop one whose job no longer matters, use task_cancel.

When findings arrive, tell Luke what they change in your return, and draw them on the board when a picture helps.

### The plan's coding agents

Coding agents may already be building this plan, each in a cloud session of its own. When the developer asks how an agent is doing, tells an agent to do something, or asks for a new one ("how's the agent doing", "tell it to also add tests", "start an agent on this"), use the agent tools: list_coding_agents to see which agents there are and which one they mean, read_coding_agent to read one's recent progress, message_coding_agent to tell one what to do, and start_coding_agent to start a new one.

On a status question, read the agent and summarise its progress in a sentence or two in your return: what it is doing now, what it has published, and whether it is stuck. Never read its transcript out.

On an instruction, send it when it is clear which agent is meant and what to say: message_coding_agent with the developer's words as a message to the agent, then say briefly in your return what you sent. When there are several agents and it is ambiguous which one the developer means, queue a question asking which, and send nothing until they answer. When there is one agent, it is the one they mean.

On a request for a new agent, start it when the developer clearly asks for one ("start an agent on this", "kick off the plan", "start Sonnet on fixing the invite emails"): start_coding_agent with no task to build the plan, or with the task in the developer's words where they named one instead, and the model and effort where they named them, else neither. Then say in one sentence in your return what was started, naming the model ("Started Claude Opus 5.5 on the plan"), so Luke can say it. Queue a question first only when it is unclear whether they want an agent at all, or what it should work on; never start one the developer did not ask for, and never start a second one for the same ask. When the tool rejects the model or effort, pick the nearest of the choices it lists if the developer's intent is clear, and queue a question otherwise. The agent it started is one the other agent tools then read and message.

Never put a credential, token, or key into a message to an agent, into any tool's input, or into your return, and never repeat one you see in an agent's transcript.

### Between the developer's words

Luke keeps you working while the developer talks and thinks. When a message says to keep working, it hands you what was said since your last turn, if anything, and how many of your questions Luke still holds. Pick the most useful thing still open and do it: check an assumption against the code, hand a comparison or a wider search to the worker, prepare concrete options for the next decision the developer will face, or queue what the latest answers unblocked. When Luke holds two or more of your questions, research rather than queue, so the developer is not buried in questions. Never queue a question twice, and return only what changes the plan; Luke says nothing of a turn that found nothing new.

When nothing worth doing remains, call rest, alone, with the honest reason: the plan is complete, what is left turns on answers Luke is waiting for, or more reading would turn up nothing new. A developer's ask that joined the turn comes first: answer it, and never rest on it.

### Available tools

- queue_question hands Luke one question and your recommended answer the moment you have it, while you keep working.
- show_code puts lines of a file in the plan's repository on the developer's screen as Luke starts saying your next words. Whenever a question or your return is about specific code, call it first with the lines that matter, so the developer sees what Luke means. Its note says in a sentence or two what those lines do for the plan and what to notice, for the developer reading the plan later. To walk through code, make a few calls in order, each a focused range with its own note, rather than one long window.
- run_in_repository runs a shell command (ls, find, grep, cat, git log) in a checkout of the plan's GitHub repository, made in a sandbox on the first call. Start exploring it immediately, and keep exploring as the task comes into focus. When it answers not-run, say so: nothing of the code has been read, and the reason says what the developer has to do.
- search_web and read_web_page are ways to search the Internet, for a fact your answer needs now.
- worker does a job in the background, as above.
- task_cancel stops a worker you no longer need.
- draw_on_board draws a diagram of shapes, zones, arrows, and text on the plan's whiteboard, replacing your previous one.
- look_at_board shows you the whiteboard as the developer sees it, so you can check what you drew.
- list_coding_agents lists the coding agents working on this plan, each with its id, its title as the developer sees it, its status, and what it last did.
- read_coding_agent reads one agent's recent progress, as a short tail of what it said and did.
- message_coding_agent sends one agent a message, as the developer would type it to the agent.
- start_coding_agent starts a new coding agent on this plan, on the plan itself or on a task, as the developer's Start button would.
- end_call ends the voice call once the developer has clearly said they are done with it ("bye", "that's all", "thanks, I'm done", "let's stop here"). Luke is already saying goodbye: call it first and add nothing to your return. Never call it on a bare "okay" or "thanks" mid-conversation, while the developer is mid-sentence, or because the plan looks complete.
- rest ends your turn and stops you working until the developer speaks again, as above.

## Return the result

Return the relevant facts, the task's current status, and any queued question an answer has made moot, so Luke drops it. Don't repeat the questions you queued: Luke already holds them. Report an action as complete after the tool or service confirms success. If the outcome is unclear, state that and explain what needs to be checked.

A message with no tool call ends your turn, and nothing runs after it until the developer speaks again. Never end on what you are about to do ("let me check the repository"): make the call now, and return once its result is in.
`;

/**
 * The message a fresh call opens the planning model's turn with, sent as the
 * session starts rather than at the developer's first words. It is general
 * on purpose, because nothing of the task has been said yet: the plan's name
 * and saved document reach the model as standing context beside it. Note
 * that it asks for no question, because a question queued now would be
 * asked before the developer has said what they want.
 */
export const PLANNING_EXPLORE_ASK =
  "The call has just started, and the developer has not said what they want yet. " +
  "Start exploring the plan's folder now, so you already know the code when they do: " +
  "what the project is, how it is laid out, how it is built and tested, and anything the " +
  "plan's name or saved document points to. Hand anything broader to the worker. " +
  "Queue no question until the developer has spoken. " +
  "Return one short sentence on what the project is.";

/**
 * The message a turn the voice service opened between the developer's words
 * carries: keep working, with what was said since the model last heard the
 * call and how many of its questions Luke still holds. Note that the lines
 * may overlap what a spoken ask already handed over, as transcripts do, and
 * that an empty hearing is said as such rather than left out, so the model
 * never reads a missing section as one lost.
 */
const PLANNING_CONTINUE_ASK =
  "Keep working on the plan while the developer talks and thinks, as your instructions say " +
  "for the time between the developer's words. Call rest when nothing worth doing remains.";

const CONTINUE_HEARD_MARKER = "[heard since your last turn]";
const CONTINUE_QUESTIONS_HELD_MARKER = "[questions Luke still holds]";

/** What a continue turn is handed: the call's lines the model has not heard, role-labelled, and the questions Luke holds. */
export function planningContinueAsk(work: {
  readonly heard: string;
  readonly questionsHeld: number;
}): string {
  const heard = work.heard.trim().length > 0 ? work.heard.trim() : "Nothing new.";
  return [
    PLANNING_CONTINUE_ASK,
    `${CONTINUE_QUESTIONS_HELD_MARKER} ${work.questionsHeld}`,
    CONTINUE_HEARD_MARKER,
    heard,
  ].join("\n");
}

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
- The developer also edits the plan directly. A field named under [fields the developer wrote] holds the developer's own words: never reword or strike them. Add to them, or change them only where the latest lines say to.
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
const AGENT_EDITS_MARKER = "[recent edits by coding agents]";
/** The marker the fields the developer last wrote ride behind, which the brain and the notetaker are each told to keep as written. */
export const DEVELOPER_FIELDS_MARKER = "[fields the developer wrote]";

/** The most agents' saves the model is told of, the newest; the journal keeps more. */
const RECENT_AGENT_EDITS = 5;

/** The most characters of one note's text the model is told; the document itself holds the whole. */
const AGENT_NOTE_CHARS = 300;

/** A note's words, cut where they run past what one line of the history carries. */
function noteWords(words: string | null): string {
  if (words === null) return "null";
  return JSON.stringify(
    words.length > AGENT_NOTE_CHARS ? `${words.slice(0, AGENT_NOTE_CHARS)}…` : words,
  );
}

/** One note an agent took, in a line: what it did, where, and its words, the phrase it corrected or struck and the example's clauses among them. */
function agentNoteLine(note: PlanNote): string {
  switch (note.kind) {
    case NOTE_KIND.ADD:
      return `add ${note.field}: ${noteWords(note.text)}`;
    case NOTE_KIND.ADD_EXAMPLE:
      return `addExample to rule ${note.rule}: given ${noteWords(note.given)}, when ${noteWords(note.when)}, then ${noteWords(note.then)}`;
    case NOTE_KIND.REPLACE:
      return `replace ${note.field}: ${noteWords(note.find)} → ${noteWords(note.text)}`;
    case NOTE_KIND.REMOVE:
      return `remove ${note.field}: ${noteWords(note.find)}`;
  }
}

/** The newest saves coding agents made, one line each, newest first; nothing where none has. */
function agentEditsText(edits: readonly LabelledAgentEdit[]): readonly string[] {
  if (edits.length === 0) return [];
  const recent = edits.slice(-RECENT_AGENT_EDITS).reverse();
  return [
    AGENT_EDITS_MARKER,
    ...recent.map(
      (edit) =>
        `- ${edit.label}, ${new Date(edit.at).toISOString()}: ${edit.notes.map(agentNoteLine).join("; ")}`,
    ),
  ];
}

/** The fields the developer wrote last, by heading, each with when; nothing where the developer wrote none. */
function developerFieldsText(writers: readonly PlanFieldWriter[]): readonly string[] {
  const written = writers.filter((writer) => writer.actor === PLAN_ACTOR.DEVELOPER);
  if (written.length === 0) return [];
  return [
    DEVELOPER_FIELDS_MARKER,
    ...written.map(
      (writer) => `- ${PLAN_FIELD_HEADING[writer.field]}, ${new Date(writer.at).toISOString()}`,
    ),
  ];
}

/**
 * What a planning turn is handed beside its instructions every turn: the
 * plan's name, the saved document as JSON, the newest saves coding agents
 * made on it (so Luke can raise what an agent asked or decided), the fields
 * the developer last wrote themselves (so Luke treats them as decided), and the
 * whiteboard as the model reads it (`board-text.ts`), each read again every
 * turn so what the notetaker saved and what the developer drew is what the
 * next turn reads. A plan that no longer stands gets the heading alone.
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
    ...agentEditsText(stored.agentEdits),
    ...developerFieldsText(stored.fieldWriters),
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
  /** Whether a step that calls it alone ends the turn, as eve's `endsTurn` has it. */
  readonly endsTurn?: true;
}

/** What one planning call runs under: the plan the conversation belongs to, its repository in the session's sandbox, the turn's research bounds, and the plan's coding agents. */
export interface PlanningCall {
  readonly plan: PlanDocumentBinding;
  readonly repository: RepositoryCall;
  readonly research: ResearchCall;
  readonly agents: CodingAgentCall;
}

/** One tool a planning turn is offered: its declaration, and the call it carries under the plan the conversation belongs to. */
interface PlanningTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Schema.Codec<unknown, UnparsedWireValue>;
  /** A wider schema its stored rows are read back under, where rows journaled before a newer input was asked for still stand. */
  readonly storedInputSchema?: Schema.Codec<unknown, UnparsedWireValue>;
  /** Whether a step that calls it alone ends the turn; see `HostedToolDeclaration`. */
  readonly endsTurn?: true;
  readonly run: (
    call: PlanningCall,
    input: UnparsedWireValue,
  ) => Effect.Effect<WireRecord, never, PlanningToolServices>;
}

/** What a planning call may reach: the store, the network for public research, GitHub through the App for the checkout, and the catalog a start's choice is checked against. */
type PlanningToolServices = SqlClient.SqlClient | HttpClient.HttpClient | GitHubApp | ModelCatalog;

/**
 * The tools a planning turn is offered, in the order the model reads them.
 * None writes the plan, which is the notetaker's; `queue_question` hands the
 * voice a question mid-turn (`queue-question.ts`); `show_code` reads lines of
 * the plan's repository from the session's checkout and puts them on the
 * developer's screen as Luke speaks (`show-code.ts`); `run_in_repository` runs a
 * command in the same sandbox on the same checkout
 * (`repository-shell.ts`); the public search and page read (`public-research.ts`)
 * answer what the repository cannot; `draw_on_board` draws on the plan's
 * whiteboard under the same binding (`board-tool.ts`), and `look_at_board`
 * hands back the board as the Mac draws it (`board-look.ts`); the four
 * agent tools read, message, and start the plan's coding agents
 * (`coding-agent-tools.ts`); `end_call` hangs up once the developer is done,
 * carried as `queue_question` is by its journaled call (`end-call.ts`), and
 * `rest` ends the turn and stops the voice service setting the model working
 * until the developer speaks again (`rest.ts`), carried the same way.
 * Every read's result goes back to the model as data, a look's as an image.
 */
const PLANNING_TOOLS: readonly PlanningTool[] = [
  {
    ...QUEUE_QUESTION_TOOL,
    run: (_call, input) => Effect.succeed(runQueueQuestion(input)),
  },
  {
    ...SHOW_CODE_TOOL,
    run: (call, input) => runShowCode(call.repository, input),
  },
  {
    ...RUN_IN_REPOSITORY_TOOL,
    run: (call, input) =>
      Effect.map(runInRepository(call.repository, input), (result) => ({
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
  {
    ...LOOK_AT_BOARD_TOOL,
    run: (call, input) => Effect.map(runLookAtBoard(call.plan, input), (result) => ({ ...result })),
  },
  {
    ...LIST_CODING_AGENTS_TOOL,
    run: (call) => runListCodingAgents(call.agents),
  },
  {
    ...READ_CODING_AGENT_TOOL,
    run: (call, input) => runReadCodingAgent(call.agents, input),
  },
  {
    ...MESSAGE_CODING_AGENT_TOOL,
    run: (call, input) => runMessageCodingAgent(call.agents, input),
  },
  {
    ...START_CODING_AGENT_TOOL,
    run: (call, input) => runStartCodingAgent(call.agents, input),
  },
  {
    ...END_CALL_TOOL,
    run: (_call, input) => Effect.succeed(runEndCall(input)),
  },
  {
    ...REST_TOOL,
    endsTurn: true,
    run: (_call, input) => Effect.succeed(runRest(input)),
  },
];

const PLANNING_TOOLS_BY_NAME = new Map(PLANNING_TOOLS.map((tool) => [tool.name, tool]));

/**
 * The tools eve puts beside the planning tools: one per declared subagent,
 * named by its directory under `eve/subagents/`, and the two task controls
 * eve adds beside any agent tool, `task_wait` and `task_cancel`. eve runs
 * them, so they are no planning tool, but a turn's rows name them, and the
 * writer holds every row to the hosted tool set.
 */
export const EVE_DELEGATION_TOOL = {
  WORKER: "worker",
  TASK_WAIT: "task_wait",
  TASK_CANCEL: "task_cancel",
} as const;

/**
 * What a subagent's call carries, as eve declares it: the message, and the
 * task of the child to continue or steer.
 */
const SUBAGENT_CALL_INPUT = Schema.Struct({
  message: Schema.String,
  taskId: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

/** What `task_wait` carries, as eve declares it: the seconds to wait for a result before returning without one, or nothing to wait for one. */
const TASK_WAIT_INPUT = Schema.Struct({
  timeoutSeconds: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});

/** What `task_cancel` carries, as eve declares it: the task to cancel. */
const TASK_CANCEL_INPUT = Schema.Struct({ taskId: Schema.String });

export const EVE_DELEGATION_INPUT = {
  [EVE_DELEGATION_TOOL.WORKER]: SUBAGENT_CALL_INPUT,
  [EVE_DELEGATION_TOOL.TASK_WAIT]: TASK_WAIT_INPUT,
  [EVE_DELEGATION_TOOL.TASK_CANCEL]: TASK_CANCEL_INPUT,
} as const;

/**
 * The planning tools the `worker` subagent is offered: every read a
 * background session can carry. Note that it is offered nothing that speaks
 * or shows, because a question queued or code shown reaches the developer only
 * through the planning turn the voice follows, and not `draw_on_board`,
 * because a drawing replaces the planning model's own.
 */
export const WORKER_TOOL_NAMES: ReadonlySet<string> = new Set([
  SEARCH_WEB_TOOL.name,
  READ_WEB_PAGE_TOOL.name,
  RUN_IN_REPOSITORY_TOOL.name,
]);

/**
 * The instructions the `worker` subagent runs under. Note that it is told it
 * is nobody's voice, because the planning model reads its findings and
 * decides what reaches Luke; that its return is a summary with sources,
 * because the parent reads it whole into a turn of its own; and that the
 * repository's text never goes into a search, because the repository is
 * private and a search query leaves for the public web.
 */
export const WORKER_INSTRUCTIONS = `
You do one job for a planning assistant, who hands it to you and reads what you return. You never speak to the developer, and you ask nobody anything: if the job is unclear, do the most likely reading and say which one you took.

Read the plan's repository with run_in_repository, a checkout of its default branch: ls and find to see the layout, grep to find names, cat or sed to read files, git log to see history. When it answers not-run, nothing of the code has been read: say so and why. Search the public Internet with search_web and read the pages that matter with read_web_page, preferring primary sources: official documentation, specifications, and the project's own repository. Never put the repository's code, names, or paths into a search: the repository is private and a search is public. Stop when you can answer, or when more reading stops turning up anything new.

Return a short summary that answers the job, then what you relied on: URLs, and file paths with line numbers where they matter. Say plainly what you could not confirm. Keep it under 300 words.
`;

/** The declarations every turn is offered, whatever kind of turn opened it. */
export function planningToolDeclarations(): readonly HostedToolDeclaration[] {
  return PLANNING_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: emitJsonSchema(tool.inputSchema),
    ...(tool.endsTurn ? { endsTurn: tool.endsTurn } : undefined),
  }));
}

/** The planning tools as stored rows are held to them, so a turn's calls are written and read back like the catalog's. */
export function planningToolSet(): ToolSet {
  return Object.fromEntries([
    ...PLANNING_TOOLS.map((tool) => [
      tool.name,
      wireValidatedTool(tool.description, tool.storedInputSchema ?? tool.inputSchema),
    ]),
    ...Object.entries(EVE_DELEGATION_INPUT).map(([name, inputSchema]) => [
      name,
      wireValidatedTool(`eve's own ${name} tool`, inputSchema),
    ]),
  ]);
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
