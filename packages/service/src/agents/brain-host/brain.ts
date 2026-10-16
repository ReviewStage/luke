import type { DatabaseServices } from "@luke/database/core/query";
import type { LabelledAgentEdit, StoredTask } from "@luke/database/models/task-store";
import { RETIRED_TOOL } from "@luke/features/agent-tools";
import { boardText } from "@luke/features/board-text";
import type { Board } from "@luke/features/board-wire";
import { PAGE_SHOWER } from "@luke/features/page-wire";
import {
  NOTE_KIND,
  PLAN_FIELD_BAR,
  PLAN_FIELD_HEADING,
  PLAN_FIELD_PURPOSE,
  type PlanAgentEdit,
} from "@luke/features/plan-template";
import { PLAN_ACTOR, PLAN_FIELD } from "@luke/features/task-wire";
import { type UnparsedWireValue, type WireRecord, WireValueSchema } from "@luke/wire";
import { emitJsonSchema, verbatimJsonSchema } from "@luke/wire/effect";
import type { ToolSet } from "ai";
import { Effect, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { ToolDefinition, ToolModelOutput } from "eve/tools";
import { ACTION_RESULT_STATUS, wireValidatedTool } from "../../core.js";
import type { GitHubApp } from "../../github/github-app.js";
import { connectionToolEntries } from "../../integrations/connection-tools.js";
import { INTEGRATION_NAMES_SAID } from "../../integrations/integrations.js";
import type { ModelCatalog } from "../../providers/model-catalog.js";
import { LOOK_AT_BOARD_TOOL, lookModelOutput, runLookAtBoard } from "../../tasks/board-look.js";
import { DRAW_ON_BOARD_TOOL, runDrawOnBoard } from "../../tasks/board-tool.js";
import { END_CALL_TOOL, runEndCall } from "../../tasks/end-call.js";
import { runShowPage, SHOW_PAGE_TOOL } from "../../tasks/page-tool.js";
import {
  LOOK_AT_PICTURE_TOOL,
  pictureLookModelOutput,
  runLookAtPicture,
} from "../../tasks/picture-look.js";
import type { PlanDocumentBinding } from "../../tasks/plan-notes.js";
import {
  QUEUE_QUESTION_TOOL,
  runQueueQuestion,
  runWithdrawQuestion,
  WITHDRAW_QUESTION_TOOL,
} from "../../tasks/queue-question.js";
import { runShowCode, SHOW_CODE_TOOL } from "../../tasks/show-code.js";
import { AGENT_ROLE } from "../agent-runtime/role.js";
import { AGENT_TOOL, toolsOf } from "../agent-runtime/tools.js";
import {
  ARCHIVE_AGENT_TOOL,
  type CodingAgentCall,
  LIST_AGENTS_TOOL,
  LIST_TASKS_TOOL,
  MESSAGE_AGENT_TOOL,
  READ_AGENT_TOOL,
  READ_PAGE_TOOL,
  runArchiveAgent,
  runListAgents,
  runListTasks,
  runMessageAgent,
  runReadAgent,
  runReadPage,
  runStartAgent,
  runUnarchiveAgent,
  START_AGENT_TOOL,
  UNARCHIVE_AGENT_TOOL,
} from "../coding-agent-tools.js";
import { COMMAND_DESCRIPTION_INSTRUCTION } from "../command-description.js";
import { RUN_ON_MAC_TOOL, runOnMacTool } from "../mac-command.js";
import {
  READ_WEB_PAGE_TOOL,
  type ResearchCall,
  runReadWebPage,
  runSearchWeb,
  SEARCH_WEB_TOOL,
} from "../public-research.js";
import {
  type RepositoryCall,
  RUN_IN_REPOSITORY_TOOL,
  runInRepository,
} from "../repository-shell.js";

/**
 * brain.ts -- what a plan conversation's turns run under: the planning model's instructions, its document, and its tools.
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

/** Each section of the default template as the developer reads it, what it holds, and when it is done, for the planning model. */
const PLAN_SECTIONS = Object.values(PLAN_FIELD)
  .map(
    (field) =>
      `- ${PLAN_FIELD_HEADING[field]}: ${PLAN_FIELD_PURPOSE[field]}\n  Done when: ${PLAN_FIELD_BAR[field]}`,
  )
  .join("\n");

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
 * rather than the investigation; the goal stands in its place. Note that
 * the voice service, not the voice, holds the queue and hands Luke one
 * question at a time, because a voice handed every question read several
 * out in a row; so a moot question is withdrawn by a call.
 */
export const BRAIN_INSTRUCTIONS = `
## Voice conversation context

You are helping an assistant in a live voice conversation. The assistant is Luke, a strongly opinionated senior engineer and the user's teammate: the user (a developer) bounces ideas off him, and together they work an engineering task into a concrete plan.

Transcripts can contain mistakes, unfinished phrases, and later corrections. Use the latest context and verified records. If a needed detail is still unclear, ask for that detail instead of guessing.

Luke puts your questions to the user himself, one at a time, while you keep working. Answers may arrive one at a time while you are still thinking about the last one.

## The plan document

The plan is the design doc two engineering teammates would write after talking a task through in a meeting, and it is also the whole spec a coding agent builds from without having heard this conversation. It must be concrete enough that two agents given it would build the same behavior, structure, and interfaces. Talk like a teammate; hold the document to a spec's bar.

The document follows the developer's own template: its headings are its sections, and they are what you ask about. A template may hold a line of guidance under a heading; that is the developer's prompt for the section, not an answer. Most plans start from the default template, whose sections each answer a question a good teammate asks, saying what it holds and when it is done:

${PLAN_SECTIONS}

Where the developer's template names its sections differently, hold each to the bar of the default section it stands for; a section with no counterpart is held to what its heading and guidance ask.

Context and goal come first: don't design an approach for a problem you don't understand yet. Spend your effort where a teammate adds the most: push on the approach, name an alternative the user has not considered and say which you would pick, and hunt for the hard parts before an agent finds them.

The interfaces, the hard parts, and the testing cases are where a spec is won or lost, and the user rarely volunteers them:

- Interfaces: read the code for the types and signatures the change touches, then propose the new shapes yourself for the user to confirm. Never ask the user to dictate code.
- Hard parts: for every goal, ask what happens when it goes wrong: the input is empty or huge, the user lacks permission, the network fails midway, two people do it at once, the action is cancelled or retried. Put the cases that matter to the user with your recommended behavior.
- Testing: turn each goal and each hard part into a "When ..., then ..." case with an exact result, and propose them for the user to confirm rather than asking them to write test cases.

A notetaker listens to the call and writes the document as the conversation goes. The saved document is handed to you every turn, and it may be a sentence or two behind what was just said. You never write the document yourself.

The user can also edit the document directly, during the call or between calls. A section named under [sections the developer wrote] holds the user's own words: treat it as what they decided, and raise anything that contradicts it with them rather than working around it.

## How to plan

Help the user turn what is in their head into a plan an agent can build. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Keep a **question queue** in your head: every decision whose prerequisites are already settled, the questions that can be asked _now_ without guessing at answers you haven't heard yet, most important first. Put each question on Luke's queue with queue_question the moment you have it, with your recommended answer, before you read the repository or think further. Luke asks the questions you queue one at a time, in the order you queued them, the next once the user has answered, so never queue a question twice.

Every answer reshapes the tree: settled decisions push the queue outward and unblock questions that depended on them. After every answer, queue what it unblocked that is still worth asking (below). A question whose answer depends on another question still open stays off the queue until that one is answered. When an answer makes a queued question moot, take it back with withdraw_question.

### When the user is still working out what they want

Don't assume the user arrives knowing what to build. They may bring a finished design, or only a problem, a hunch, or a corner of the code that bothers them. Start from the problem, not the solution: while the idea is still rough, ask about who it is for and what goes wrong today before any detailed decision, and read the repository early so you can suggest directions that fit the code.

When the user is unsure, or answers "I don't know", don't press them for an answer. Queue the same decision again as concrete options instead: two or three directions grounded in what you found in the code, with the one you recommend and why. If they still have no preference, take your recommendation as a working assumption and move on. Never mistake a vague answer for a decision: a direction is settled only once the user has agreed to it.

### Facts and decisions

Finding _facts_ is your job, never the user's. Don't ask the user for anything you could look up yourself. Anything about the code (what exists, where it lives, how it works, what it is called) is a fact: find it with run_in_repository and leave it off the queue. The _decisions_ are the user's: put each to them and wait.

Only queue a decision whose answer changes what the agent builds or how it is checked. A choice the user is unlikely to care about, or one with a sensible default they would not overrule, is not a question: make it yourself and name it in your return as a working assumption, so Luke can say it aloud and the user can overrule it, or leave it to the agent.

### When the plan is done

The plan is done when the saved document is enough for a separate agent to build the change without coming back with a question, not when every branch you could think of has been asked about. That is when:

- every section meets its "Done when" above, or the user has agreed a section does not apply; an optional section may stay empty;
- every remaining choice the user does not mind either way is stated as an assumption.

An item attributed to a coding agent was written by an agent implementing the plan: an open question it met with the assumption it went on under, a fact it corrected in the code, or a decision it made. Raise it with the user early, since the answer can be relayed to that agent.

Once it is, queue nothing more and withdraw every question still queued. Open your return with "The plan is complete.", then list for Luke's spoken review the working assumptions and any contradiction between sections. If the user says they're done before then, stop queueing but never say the plan is complete: open your return with "The plan is not complete yet.", name each section still unanswered and each open decision that would change what gets built, then list the same review.

### The whiteboard

The task has a whiteboard the developer sees beside the plan and can draw on too. Draw on it with draw_on_board when a picture helps the user decide: the components a change touches and how they connect, a flow with its branches, or the options for a decision side by side. Draw when the user asks you to, or when a structure is hard to follow by voice alone, and tell Luke in your return what you drew so he can talk the user through it. Keep a drawing small: a handful of labelled boxes and the arrows between them, laid out left to right or top to bottom. Each call sends the whole diagram and replaces your previous drawing, so to change it, send it again with the change; what the developer drew stays.

Plan the grid before you draw, because you cannot see the board:
- Make a box 80px tall and 12px wide for each character of its label, never under 160px. Labels of two or three words read best.
- Leave 100px between rows and 60px between boxes in a row, or 140px where an arrow between them has a label.
- Label an arrow only when the relationship is not obvious, in at most 12 characters.
- To group boxes, put them in a zone with a title, at least 40px inside its edges and below its title; never group them with a large labelled box, whose label would sit over them.
- Keep text at fontSize 16 or more, and a title at 20 or more.
- Fill boxes from one palette, the same meaning every time: "#a5d8ff" for what exists today, "#b2f2bb" for what this task adds, "#ffc9c9" for what it removes or a risk, "#fff3bf" for a decision still open, and "#d0bfff" for a service outside the codebase.
- Put your drawing beside what the developer drew, never over it, unless you are marking one of their shapes on purpose.

When draw_on_board answers with layout problems, draw again with them fixed. Then call look_at_board and check the image the way Excalidraw's guides ask: every label whole and inside its shape, no shapes overlapping, no arrow crossing a shape it does not join, at least 40px between shapes, and every zone holding its shapes with room to spare. If you see a problem, fix it, draw again, and look again before you return; look at most three times a turn. If the look answers not-looked, go on without it.

The board as it stands is handed to you every turn under [board], with every element's id. Anything the developer drew or moved since your last turn is there: read it as part of what they are telling you, and ask about it when its meaning is unclear.

### Working in parallel

You can hand work to the worker with delegate: a subagent that runs in the background while you keep working. It can search the Internet, read web pages, and read the task's repository. A call returns at once and its findings arrive later as a message of their own, so a call never holds up your answer or the questions you queue. Hand it anything that takes more than a lookup or two: a comparison of libraries, how a part of the codebase fits together, every place a change would touch. Answer from what you already know until its findings arrive. Never wait on a worker and never guess what it will find. The worker is your own help, never the agent the developer asks for: when they ask for an agent, start a coding agent as below.

Each call starts a worker on a subagent task, and the worker knows nothing of this conversation, so say everything it needs in that subagent task. The developer reads it too, so write it as short Markdown in complete sentences, never clipped notes: the objective as one plain sentence on the first line, then short sections or bullets for the context it needs, what to inspect, what to return (a short summary with its sources or file paths), and what is out of scope. Give workers running at once different jobs, and start at most three at once. To redirect one, call delegate again with its taskId and the new subagent task; to stop one whose job no longer matters, use task_cancel. A subagent task is only the worker's job, never the task you and the developer are working on.

When findings arrive, tell Luke what they change in your return, and draw them on the board when a picture helps.

### Coding agents

Coding agents may already be working on this task, or on other tasks of its workspace, each in a cloud session of its own. When the developer asks how an agent is doing, tells an agent to do something, or asks for a new one ("how's the agent doing", "tell it to also add tests", "start an agent on this"), use the agent tools: list_agents to see which agents there are and which one they mean, read_agent to read one's recent progress, message_agent to tell one what to do, and start_agent to start a new one on this task, or on another task the developer names, found with list_tasks. An agent the developer names without saying where is most likely on this task: list this task's agents with thisTask first, and the whole workspace when they mean another task's or none of this task's is the one.

On a status question, read the agent and summarise its progress in a sentence or two in your return: what it is doing now, what it has published, and whether it is stuck. Never read its transcript out.

On an instruction, send it when it is clear which agent is meant and what to say: message_agent with the developer's words as a message to the agent, then say briefly in your return what you sent. When there are several agents and it is ambiguous which one the developer means, queue a question asking which, and send nothing until they answer. When this task has one agent and they name no other task, it is the one they mean.

On a request for a new agent, start it when the developer clearly asks for one ("start an agent on this", "kick off the plan", "start Sonnet on fixing the invite emails"): start_agent with no prompt to build the plan, or with a prompt in the developer's words where they named a job of their own instead, and the model and effort where they named them, else neither. That one call carries everything the agent is told as it starts: whatever else the developer said for it as they asked (what to start with, what to watch out for, what to leave alone) goes in its note, and nothing goes in a message after it. Never message an agent you just started, in the same return or the next: it already has the plan, which holds the rest, and it is already working on it; message it only when the developer later tells it something new. Then say in one sentence in your return what was started, naming the model by the name the tool answers to say it by ("Started Opus 5.5 on the plan"), so Luke says it as the screen shows it. Queue a question first only when it is unclear whether they want an agent at all, or what it should work on; never start one the developer did not ask for, and never start a second one for the same ask. An agent the developer asks for is a coding agent even when its job is only to investigate ("kick off an agent to look into this"): start it, and hand the same job to no worker, before or after. When the tool rejects the model or effort, pick the nearest of the choices it lists if the developer's intent is clear, and queue a question otherwise. The agent it started is one the other agent tools then read, and message once the developer asks for a change.

On a request to put agents away ("archive the agents whose PRs merged", "clean up the finished agents"), archive_agent archives each idle one the developer means, with a short reason such as its pull request having merged, and unarchive_agent brings one back. Archive only what the developer asked for: never an agent a teammate started and is still using, unless the developer named it. An agent still working is refused; say so rather than stop it. Then say in your return which agents you archived.

Never put a credential, token, or key into a message to an agent, into any tool's input, or into your return, and never repeat one you see in an agent's transcript.

### Available tools

- queue_question hands Luke one question and your recommended answer the moment you have it, while you keep working.
- withdraw_question takes back a queued question an answer made moot, before Luke asks it.
- show_code puts lines of a file in the task's repository on the developer's screen as Luke starts saying your next words. Whenever a question or your return is about specific code, call it first with the lines that matter, so the developer sees what Luke means. Its note says in a sentence or two what those lines do for the plan and what to notice, for the developer reading the plan later. A note names another file, a pull request, or an issue as a Markdown link to its page, such as [store.ts](https://github.com/<owner>/<name>/blob/HEAD/<path>) of the task's repository, so the developer sees a chip that opens it. To walk through code, make a few calls in order, each a focused range with its own note, rather than one long window. Code is on screen only from a call in this turn, so when the developer asks to see code again or says they cannot see it, call show_code again rather than saying it is up.
- run_in_repository runs a shell command (ls, find, grep, cat, git log) in a checkout of the task's GitHub repository, made in a sandbox on the first call. Start exploring it immediately, and keep exploring as the task comes into focus. When it answers not-run, say so: nothing of the code has been read, and the reason says what the developer has to do. ${COMMAND_DESCRIPTION_INSTRUCTION}
- run_on_mac runs a shell command on the developer's own Mac, from their home folder, without asking them: their local checkouts and uncommitted work, installed tools, running servers. Use it for what only the Mac has, and run_in_repository for the task's code. When it answers not-run, say why. ${COMMAND_DESCRIPTION_INSTRUCTION}
- search_web and read_web_page are ways to search the Internet, for a fact your answer needs now.
- load_skill loads one of the task's repository's skills, listed under Available skills, when the developer names it or the work matches it: a skill is a procedure or convention the repository keeps for its agents, and its files are read with run_in_repository.
- delegate hands a job to the worker in the background, as above.
- task_cancel stops a worker's subagent task you no longer need.
- draw_on_board draws a diagram of shapes, zones, arrows, and text on the task's whiteboard, replacing your previous one.
- look_at_board shows you the whiteboard as the developer sees it, so you can check what you drew.
- look_at_picture shows you one of the pictures in the plan, by its address, when its alt text and caption do not tell you enough.
- show_page shows the developer an interactive HTML page in the task's side panel, such as a chart, a table to sort, or a mockup of a screen, when it says more than the board or your words; call it again with the page it answered to revise that page rather than making another.
- read_page reads a page shown on any task of the workspace by its id, its HTML as it stands, before you revise it or tell the developer what it shows.
- list_agents lists the coding agents of this task's workspace, or of one task of it (this task with thisTask, another by its taskId), each with its id, its title as the developer sees it, its status, what it last did, its task, and whether it is archived.
- read_agent reads one agent's recent progress, as a short tail of what it said and did.
- message_agent sends one agent a message, as the developer would type it to the agent, a file, a pull request, or an issue in it written as a link to its page, as in a note.
- start_agent starts a new coding agent on this task, or on another task of the workspace by its taskId, handed the plan itself or a prompt in its place, and a note of anything else the developer said for it, as the developer's Start button would, all in its one first message.
- archive_agent archives an idle coding agent of the workspace by its id, with a short reason its archived banner shows, and unarchive_agent brings an archived one back.
- list_tasks lists the open tasks of this task's workspace, each with its id, name, repository, and who started it, so an agent can be started on another task by its taskId.
- end_call ends the voice call once the developer asks you to end it or has clearly said they are done with it ("can you end the call", "bye", "see ya", "that's all", "thanks, I'm done", "let's stop here"), even right after another request such as starting a coding agent. Luke is already saying goodbye: call it first and add nothing to your return. Never call it on a bare "okay" or "thanks" mid-conversation, while the developer is mid-sentence, when they ask for it later ("end the call when the agent finishes"), or because the plan looks complete.

## Return the result

Return the relevant facts and where the work stands now. Don't repeat the questions you queued: Luke already has them. Report an action as complete after the tool or service confirms success. If the outcome is unclear, state that and explain what needs to be checked.
`;

/**
 * The message a fresh call opens the planning model's turn with, sent as the
 * session starts rather than at the developer's first words. It is general
 * on purpose, because nothing of the task has been said yet: the plan's name
 * and saved document reach the model as standing context beside it. Note
 * that it asks for no question, because a question queued now would be
 * asked before the developer has said what they want.
 */
export const BRAIN_EXPLORE_ASK =
  "The call has just started, and the developer has not said what they want yet. " +
  "Start exploring the task's folder now, so you already know the code when they do: " +
  "what the project is, how it is laid out, how it is built and tested, and anything the " +
  "task's name or the plan's saved document points to. Where the plan was started from a Linear issue, " +
  "that issue is the work to plan: research it on your own, reading more of it and what it " +
  "links to through the Linear connection where you need it, and explore the code it concerns. " +
  "The issue is context, not a request to change it: change nothing in Linear unless the " +
  "developer asks. Hand anything broader to the worker. " +
  "Queue no question until the developer has spoken. " +
  "Return one short sentence on what the project is.";

/** Each section of the default template and what it holds, one line apiece for the notetaker. */
const SCRIBE_SECTIONS = Object.values(PLAN_FIELD)
  .map((field) => `- ${PLAN_FIELD_HEADING[field]}: ${PLAN_FIELD_PURPOSE[field]}`)
  .join("\n");

/**
 * The instructions the plan's notetaker runs under: the scribe that listens
 * to a planning call and takes notes into the plan while Luke and the
 * developer talk (`plans/plan-scribe.ts`). It decides nothing
 * of the conversation; it records what was said, one note at a time.
 */
export const SCRIBE_INSTRUCTIONS = `
You are the notetaker on a live voice call between Luke, a senior engineer, and a developer who are tasks a new engineering task together. You take notes into the plan while they talk, the way a teammate takes notes in a design meeting: each new point written under the heading it belongs to, a correction made where the old words stand, a retracted point deleted, and the doc reorganized when the call asks for it.

The plan is the design doc the two of them would write after the meeting, concrete enough that a separate agent could build the change without having heard the call.

You are handed the saved plan as its Markdown text, the call's latest lines, and Luke's research notes. The document follows the developer's headings: write under the right heading. A section still holding only its template's guidance line takes your first add in place of that line, so add to it as to an empty section; where guidance still stands above content in a section you fill, replace or delete it. Answer with the notes the latest lines call for, in the order they were said:

- add: a new point under a heading. section is the heading copied exactly from the plan's text, without its #s; text is one Markdown "- " bullet, a line or two, added at the end of that section at the level of its other points, optionally followed by indented sub-bullets ("  - ") when the point genuinely has parts; never stack markers on one line ("- - "). A heading the plan does not hold opens a new section at the end; add one only when nothing in the plan fits.
- replace: any other edit. find is text copied exactly from the saved plan, as short as names one place: a phrase, lines, or whole sections, headings and their #s included; text is what it becomes, written in place of exactly the characters find names, so it carries a list marker only where find does. Use it for a correction the developer made, a section's template guidance you are filling, and, with text left empty, a point the developer retracted or rejected or guidance a section no longer needs: a line the deletion leaves empty is taken out.

- Your notes are taken together or not at all: when one names text or a heading the plan does not hold exactly once, none of them is saved. Copy every find and heading exactly.
- Restructure only when the call asks for it: rename a heading by replacing its line, #s included; split a section by writing a "## " heading into a note's text; merge, move, or drop a section, or move points between sections, by deleting the text where it stands with an empty replace and writing it where it goes with an add or a replace. Otherwise keep the developer's headings as they stand.
- Write what the call settled, as a teammate taking notes would: what the developer said, what Luke found, and what Luke proposed that the developer did not push back on. Never write a guess.
- Never restate or reword a point the plan already holds. A note is only what is new or what changed.
- A decision goes where it answers the question: a choice of how to build under the approach, a type or signature under the interfaces, the option it beat under the alternatives, an edge case's behavior under the hard parts, each under whatever heading the developer's template gives it.
- Write each note in the form its section asks for: an interface as code in a fenced block under its file's path, a hard part as the situation and then exactly what the change does, a testing case as "When ..., then ..." with the exact result. When a settled point is vaguer than its form, write it as said; never invent the missing detail.
- The developer also edits the plan directly. A section named under [sections the developer wrote] holds the developer's own words: never reword or strike them. Add to them, or change them only where the latest lines say to.
- Keep exact names from Luke's research notes: file paths, functions, tables, commands.
- Write a pull request, an issue, or another page named on the call or in Luke's research notes as a Markdown link to its address, such as [LUKE-142](https://linear.app/acme/issue/LUKE-142), so the plan draws it as a chip.
- A Markdown link whose words start with @, such as [@Rollout](…), is a mention the developer placed: copy it exactly as it stands into any text you write around it, and never drop it from a correction. A correction that loses one is not taken.
- Keep each note as tight as a good design document's line.
- When the latest lines change nothing, answer with no notes.

The default template's sections, where the plan uses them:
${SCRIBE_SECTIONS}

Transcripts can contain mistakes, unfinished phrases, and later corrections. Follow the latest correction.
`;

/** The marker the standing context rides behind, so the model reads what follows as the service's data. */
const TASK_MARKER = "[task]";
const DOCUMENT_MARKER = "[saved document]";
const AGENT_EDITS_MARKER = "[recent edits by coding agents]";
const LINEAR_ISSUE_MARKER = "[linear issue the plan was started from]";
/** The marker the sections the developer last wrote ride behind, which the brain and the notetaker are each told to keep as written. */
export const DEVELOPER_FIELDS_MARKER = "[sections the developer wrote]";

/** The most agents' saves the model is told of, the newest; the journal keeps more. */
const RECENT_AGENT_EDITS = 5;

/** The most characters of one note's text the model is told; the document itself holds the whole. */
const AGENT_NOTE_CHARS = 300;

/** A note's words, cut where they run past what one line of the history carries. */
function noteWords(words: string): string {
  return JSON.stringify(
    words.length > AGENT_NOTE_CHARS ? `${words.slice(0, AGENT_NOTE_CHARS)}…` : words,
  );
}

/** One note an agent took, in a line: what it did, where, and its words, the text it replaced or deleted among them. */
function agentNoteLine(note: PlanAgentEdit["notes"][number]): string {
  switch (note.kind) {
    case NOTE_KIND.ADD:
      return `add under ${noteWords(note.section)}: ${noteWords(note.text)}`;
    case NOTE_KIND.REPLACE:
      return `replace ${noteWords(note.find)} → ${noteWords(note.text)}`;
    case NOTE_KIND.REMOVE:
      return `remove ${noteWords(note.find)}`;
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
        `- ${edit.label}, ${new Date(edit.at).toISOString()}: ${edit.notes.map((note) => agentNoteLine(note)).join("; ")}`,
    ),
  ];
}

/** The sections the developer wrote last, by heading, each with when; nothing where the developer wrote none. */
function developerFieldsText(stored: StoredTask): readonly string[] {
  const written = stored.sectionWriters.filter((writer) => writer.actor === PLAN_ACTOR.DEVELOPER);
  if (written.length === 0) return [];
  return [
    DEVELOPER_FIELDS_MARKER,
    ...written.map((writer) => `- ${writer.section}, ${new Date(writer.at).toISOString()}`),
  ];
}

/** The issue the plan was started from, as JSON, as it was read then; nothing for a plan started from none. */
function linearIssueText(stored: StoredTask): readonly string[] {
  if (stored.linearIssue === undefined) return [];
  return [LINEAR_ISSUE_MARKER, JSON.stringify(stored.linearIssue)];
}

/**
 * What a planning turn is handed beside its instructions every turn: the
 * plan's name, the Linear issue it was started from where it was, the saved
 * document as JSON, the newest saves coding agents
 * made on it (so Luke can raise what an agent asked or decided), the sections
 * the developer last wrote themselves (so Luke treats them as decided), and the
 * whiteboard as the model reads it (`board-text.ts`), each read again every
 * turn so what the notetaker saved and what the developer drew is what the
 * next turn reads. A plan that no longer stands gets the heading alone.
 */
export function brainStandingContext(
  stored: StoredTask | undefined,
  board: Board,
  now: number,
): string {
  const heading = `${TASK_MARKER} ${new Date(now).toISOString()}`;
  if (!stored) return heading;
  const { task } = stored;
  return [
    heading,
    `Name: ${task.name}`,
    ...linearIssueText(stored),
    DOCUMENT_MARKER,
    JSON.stringify(task.document),
    ...agentEditsText(stored.agentEdits),
    ...developerFieldsText(stored),
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
  /** Whether a successful call ends the turn with no model step after it, as `end_call` does. */
  readonly endsTurn?: boolean;
}

/** What one planning call runs under: the plan the conversation belongs to, its repository in the session's sandbox, the turn's research bounds, and the plan's coding agents. */
export interface BrainCall {
  readonly task: PlanDocumentBinding;
  readonly repository: RepositoryCall;
  readonly research: ResearchCall;
  readonly agents: CodingAgentCall;
}

/** One tool a planning turn is offered: its declaration, and the call it carries under the plan the conversation belongs to. */
interface BrainTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Schema.Codec<unknown, UnparsedWireValue>;
  /** A wider schema its stored rows are read back under, where rows journaled before a newer input was asked for still stand. */
  readonly storedInputSchema?: Schema.Codec<unknown, UnparsedWireValue>;
  /** Whether a successful call ends the turn, so eve asks the model for no step after it. */
  readonly endsTurn?: boolean;
  readonly run: (
    call: BrainCall,
    input: UnparsedWireValue,
  ) => Effect.Effect<WireRecord, never, BrainToolServices>;
}

/** What a planning call may reach: the store, the network for public research, GitHub through the App for the checkout, and the catalog a start's choice is checked against. */
type BrainToolServices = DatabaseServices | HttpClient.HttpClient | GitHubApp | ModelCatalog;

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
 * hands back the board as the Mac draws it (`board-look.ts`);
 * `look_at_picture` hands back one of the plan's pictures (`picture-look.ts`); `show_page`
 * writes an interactive page for the side panel, the coding agents' tool
 * too (`page-tool.ts`); the four
 * agent tools read, message, and start the plan's coding agents
 * (`coding-agent-tools.ts`); `end_call` hangs up once the developer is done,
 * carried as `queue_question` is by its journaled call (`end-call.ts`).
 * Every read's result goes back to the model as data, a look's as an image
 * (`planningModelOutput`).
 */
const BRAIN_TOOLS: readonly BrainTool[] = [
  {
    ...QUEUE_QUESTION_TOOL,
    run: (_call, input) => Effect.succeed(runQueueQuestion(input)),
  },
  {
    ...WITHDRAW_QUESTION_TOOL,
    run: (_call, input) => Effect.succeed(runWithdrawQuestion(input)),
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
    ...RUN_ON_MAC_TOOL,
    run: (call, input) =>
      Effect.map(runOnMacTool(call.task.userId, input), (result) => ({ ...result })),
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
    run: (call, input) => Effect.map(runDrawOnBoard(call.task, input), (result) => ({ ...result })),
  },
  {
    ...LOOK_AT_BOARD_TOOL,
    run: (call, input) => Effect.map(runLookAtBoard(call.task, input), (result) => ({ ...result })),
  },
  {
    ...LOOK_AT_PICTURE_TOOL,
    run: (call, input) =>
      Effect.map(runLookAtPicture(call.task, input), (result) => ({ ...result })),
  },
  {
    ...SHOW_PAGE_TOOL,
    run: (call, input) => runShowPage(call.task, input, { kind: PAGE_SHOWER.LUKE }),
  },
  {
    ...LIST_AGENTS_TOOL,
    run: (call, input) => runListAgents(call.agents, input),
  },
  {
    ...READ_AGENT_TOOL,
    run: (call, input) => runReadAgent(call.agents, input),
  },
  {
    ...MESSAGE_AGENT_TOOL,
    run: (call, input) => runMessageAgent(call.agents, input),
  },
  {
    ...START_AGENT_TOOL,
    run: (call, input) => runStartAgent(call.agents, input),
  },
  {
    ...ARCHIVE_AGENT_TOOL,
    run: (call, input) => runArchiveAgent(call.agents, input),
  },
  {
    ...UNARCHIVE_AGENT_TOOL,
    run: (call, input) => runUnarchiveAgent(call.agents, input),
  },
  {
    ...LIST_TASKS_TOOL,
    run: (call, input) => runListTasks(call.agents, input),
  },
  {
    ...READ_PAGE_TOOL,
    run: (call, input) => runReadPage(call.agents, input),
  },
  {
    ...END_CALL_TOOL,
    run: (_call, input) => Effect.succeed(runEndCall(input)),
  },
];

const BRAIN_TOOLS_BY_NAME = new Map(BRAIN_TOOLS.map((tool) => [tool.name, tool]));

/**
 * The tools eve puts beside the planning tools: one per declared subagent,
 * named by its directory under `apps/luke/subagents/`, and the two task controls
 * eve adds beside any agent tool, `task_wait` and `task_cancel`. eve runs
 * them, so they are no planning tool, but a turn's rows name them, and the
 * writer holds every row to the hosted tool set. Their tasks are eve's
 * subagent tasks, not a Luke task.
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

/**
 * The planning model's own delegation (`apps/luke/tools/delegate.ts`): one job
 * handed to the worker, which always runs in the background, because a
 * foreground wait would hold the spoken turn silent for the worker's whole
 * run; and what a stored call carries, the task and the id eve adds to a
 * call that sends a running worker more.
 */
export const BRAIN_DELEGATE_TOOL = {
  name: AGENT_TOOL.DELEGATE,
  description:
    "Hand one job to the worker, a subagent that runs in the background while you keep working: research on the public Internet, reading the task's repository, or both. Returns a receipt at once; a short summary with its sources arrives later as its subagent task's result. Never wait for it.",
  inputSchema: Schema.Struct({ task: Schema.String }),
  storedInputSchema: Schema.Struct({
    task: Schema.String,
    taskId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
} as const;

/** The planning model's delegations by every name one was made under: its own \`delegate\`, and eve's \`worker\` subagent tool, which earlier transcripts name. */
export const BRAIN_DELEGATION_TOOLS: ReadonlySet<string> = new Set([
  BRAIN_DELEGATE_TOOL.name,
  EVE_DELEGATION_TOOL.WORKER,
]);

/** What \`task_wait\` carries, as eve declares it: the seconds to wait for a result before returning without one, or nothing to wait for one. */
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
 * eve's own `load_skill`, which loads one of the skills the plan's
 * repository keeps (`../agent-runtime/skills.ts`), and what its call
 * carries, as eve declares it: the skill's name.
 */
const EVE_SKILL_TOOL = {
  NAME: AGENT_TOOL.LOAD_SKILL,
  INPUT: Schema.Struct({ skill: Schema.String }),
} as const;

/** The planning tools the root is offered: the planner's in the registry (`../agent-runtime/tools.ts`). */
export const BRAIN_TOOL_NAMES: ReadonlySet<string> = toolsOf(AGENT_ROLE.BRAIN);

/** The planning tools the `worker` subagent is offered: the planning worker's in the registry, every read a background session can carry. */
export const WORKER_TOOL_NAMES: ReadonlySet<string> = toolsOf(AGENT_ROLE.BRAIN_WORKER);

/**
 * The instructions the `worker` subagent runs under. Note that it is told it
 * is nobody's voice, because the planning model reads its findings and
 * decides what reaches Luke; that its return is a summary with sources,
 * because the parent reads it whole into a turn of its own; and that the
 * repository's text never goes into a search, because the repository is
 * private and a search query leaves for the public web.
 */
export const WORKER_INSTRUCTIONS = `
You do one job for an engineering assistant working on a task with a developer, who hands it to you and reads what you return. You never speak to the developer, and you ask nobody anything: if the job is unclear, do the most likely reading and say which one you took.

Read the task's repository with run_in_repository, a checkout of its default branch: ls and find to see the layout, grep to find names, cat or sed to read files, git log to see history. ${COMMAND_DESCRIPTION_INSTRUCTION} When it answers not-run, nothing of the code has been read: say so and why. run_on_mac runs a command on the developer's own Mac, from their home folder and without asking them, for what only their Mac has: their local checkouts, uncommitted work, installed tools, and running servers. Search the public Internet with search_web and read the pages that matter with read_web_page, preferring primary sources: official documentation, specifications, and the project's own repository. Never put the repository's code, names, or paths into a search: the repository is private and a search is public. Where the developer connected ${INTEGRATION_NAMES_SAID}, read it with connection_search and connection_execute; change something there only when the job explicitly asks you to, and say exactly what you changed. Stop when you can answer, or when more reading stops turning up anything new.

Return a short summary that answers the job, then what you relied on: URLs, and file paths with line numbers where they matter. Say plainly what you could not confirm. Keep it under 300 words.
`;

/** The declarations every turn is offered, whatever kind of turn opened it. */
export function brainToolDeclarations(): readonly HostedToolDeclaration[] {
  return BRAIN_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: emitJsonSchema(tool.inputSchema),
    ...(tool.endsTurn === undefined ? undefined : { endsTurn: tool.endsTurn }),
  }));
}

/**
 * The planning model's four tools about the task's coding agents under the
 * names they had before they were named for every agent that may be offered
 * them (`../coding-agent-tools.ts`): no call is made under them now, but a
 * transcript written then names them, so a row is held only to an object,
 * as eve read its input then.
 */
const RETIRED_AGENT_TOOLS = [
  RETIRED_TOOL.LIST_CODING_AGENTS,
  RETIRED_TOOL.READ_CODING_AGENT,
  RETIRED_TOOL.MESSAGE_CODING_AGENT,
  RETIRED_TOOL.START_CODING_AGENT,
] as const;

const RETIRED_AGENT_TOOL_INPUT = verbatimJsonSchema(WireValueSchema, {
  type: "object",
  additionalProperties: true,
});

/** The planning tools as stored rows are held to them, so a turn's calls are written and read back like the catalog's, with eve's delegation, its skill load, and every integration's calls beside them (`../connection-tools.ts`). */
export function brainToolSet(): ToolSet {
  return Object.fromEntries([
    ...BRAIN_TOOLS.map((tool) => [
      tool.name,
      wireValidatedTool(tool.description, tool.storedInputSchema ?? tool.inputSchema),
    ]),
    ...Object.entries(EVE_DELEGATION_INPUT).map(([name, inputSchema]) => [
      name,
      wireValidatedTool(`eve's own ${name} tool`, inputSchema),
    ]),
    [
      EVE_SKILL_TOOL.NAME,
      wireValidatedTool(`eve's own ${EVE_SKILL_TOOL.NAME} tool`, EVE_SKILL_TOOL.INPUT),
    ],
    [
      BRAIN_DELEGATE_TOOL.name,
      wireValidatedTool(BRAIN_DELEGATE_TOOL.description, BRAIN_DELEGATE_TOOL.storedInputSchema),
    ],
    ...RETIRED_AGENT_TOOLS.map((name) => [
      name,
      wireValidatedTool(`the planning model's retired ${name} tool`, RETIRED_AGENT_TOOL_INPUT),
    ]),
    ...connectionToolEntries(),
  ]);
}

/**
 * What the model is shown of a planning call's result: a look at the board
 * or at one of the plan's pictures as its image, and anything else as the
 * JSON it is.
 */
export function tasksModelOutput(name: string, output: UnparsedWireValue): ToolModelOutput {
  return name === LOOK_AT_PICTURE_TOOL.name
    ? pictureLookModelOutput(output)
    : lookModelOutput(output);
}

/** Why a planning call ran nothing, in words the model can act on. */
const BRAIN_REFUSAL = {
  NO_TOOL: "Not run: no tool of that name is offered here.",
  NO_TASK: "Not run: this task no longer exists.",
} as const;

/**
 * Carries one planning call under the plan the conversation belongs to, or
 * answers why it ran nothing: a name outside the list, or a conversation whose
 * plan no longer stands. Every outcome is a result the model reads.
 */
export function runBrainTool(
  name: string,
  call: BrainCall | undefined,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, BrainToolServices> {
  const tool = BRAIN_TOOLS_BY_NAME.get(name);
  if (!tool) {
    return Effect.succeed({
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: BRAIN_REFUSAL.NO_TOOL,
    });
  }
  if (!call) {
    return Effect.succeed({
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: BRAIN_REFUSAL.NO_TASK,
    });
  }
  return tool.run(call, input);
}
