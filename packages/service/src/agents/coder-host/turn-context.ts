/**
 * turn-context.ts -- what a coding agent's turn opens with as a message of its own: the call's words, the time, and the task and chat where they changed.
 *
 * The session's prompt (`instructions.ts`) is composed once, as the session
 * starts, and stands for its life, and every tool is offered on every turn
 * (`tool-set.ts`'s `runCallTool`), so the system message and the tools that
 * lead every request are the same whatever kind of turn it is. What does
 * change from turn to turn rides as a user-role message of the turn's own,
 * which eve appends to the history after what came before
 * (`apps/dev/instructions/turn-message.ts`): the provider's prompt cache
 * then holds the system prompt, the tools, and the whole history from one
 * turn to the next, a call that starts on an agent mid-PR among them.
 *
 * A spoken turn is the developer speaking on a call, through Luke's voice:
 * the first of a run of them opens with the words for a call: that every
 * word is heard, how to speak, the question queue, summarising rather than
 * reading out, and never waiting; an agent on a task is told too how to
 * talk its plan through, since on a call the agent is who the developer
 * plans with. A later spoken turn says in a line that the words stand, and
 * a typed turn after spoken ones that they no longer do. Then the task as
 * it stands (`../agent-runtime/standing-context.ts`) and the chat the agent
 * has not read: the developer's time on every turn, the rest of the task
 * only where it changed since the session last handed it, and the chat only
 * where it holds what was not handed before, so the history grows by what
 * is new rather than by the same words every turn.
 */

import { createHash } from "node:crypto";
import type { StoredTask } from "@luke/database/models/task-store";
import { boardText } from "@luke/features/board-text";
import type { Board } from "@luke/features/board-wire";
import type { PlanCommentThread } from "@luke/features/plan-comment-wire";
import {
  PLAN_FIELD_BAR,
  PLAN_FIELD_HEADING,
  PLAN_FIELD_PURPOSE,
} from "@luke/features/plan-template";
import { PLAN_FIELD, type PlanRevisionLine } from "@luke/features/task-wire";
import { openThreadsText } from "../../tasks/comment-tools.js";
import { CODER_TOOL } from "./tool-set.js";

/** Each section of the default template as the developer reads it, what it holds, and when it is done. */
const DOCUMENT_SECTIONS = Object.values(PLAN_FIELD)
  .map(
    (field) =>
      `- ${PLAN_FIELD_HEADING[field]}: ${PLAN_FIELD_PURPOSE[field]}\n  Done when: ${PLAN_FIELD_BAR[field]}`,
  )
  .join("\n");

/** What every spoken turn is told: that it is heard, how to speak, the question queue, and never to wait. */
const SPOKEN_WORDS = `## This turn is spoken

The developer is on a voice call with you, and this turn's message is what they said. Luke, the voice on the call, speaks for you: he says your words aloud and puts your questions to the developer one at a time while you keep working. What they said reaches you through a transcript, which can hold mistakes, unfinished phrases, and later corrections: go by the latest context and what you have verified, and where a detail you need is still unclear, ask for it rather than guess.

Every word you write on this turn is heard, not read. A sentence you write in a step is said as soon as the calls before it have answered, and your final message is said as the turn ends, so:
- Speak as a teammate would: short plain sentences, the outcome first, a sentence or two at a time. No Markdown, headings, lists, tables, code blocks, or links: name a file, a function, or a pull request by its name, never by its path or address.
- Summarise, never read out: say in a sentence or two what a file, a diff, a log, a transcript, the plan, or a tool's answer means for the developer, and never recite it.
- Before anything that takes more than a moment, such as reading a lot of code, running a suite, or building a change, say in one sentence what you are about to do, so the call is not silent while you do it.
- Say an action is done only once its tool or the service confirmed it; where the outcome is unclear, say so and what needs checking.

Speech never waits. On this turn never call \`${CODER_TOOL.SLEEP}\` or \`task_wait\`: hand slow research or a broad search to a worker with \`${CODER_TOOL.DELEGATE}\` and \`background: true\`, answer from what you already know until its result arrives, and never guess what it will find. Leave watching a pull request's checks or a deploy to a later turn, and say so.

A question for the developer goes on Luke's queue with \`${CODER_TOOL.QUEUE_QUESTION}\`, never into your words and never to the inbox while the call is up: queue it the moment you have it, with the answer you recommend and why in a few words, before you read further. Luke asks the questions you queue one at a time, in the order you queued them, the next once the developer has answered, so never queue one twice and never repeat a queued one in your words; take back one an answer made moot with \`${CODER_TOOL.WITHDRAW_QUESTION}\`. Finding facts is your job, never the developer's: anything about the code, what exists, where it lives, how it works, you look up yourself and leave off the queue. Only a decision whose answer changes what gets built or how it is checked is a question; a choice the developer would not mind either way you make yourself, and say aloud as a working assumption they can overrule.

When the developer asks you to end the call, or has clearly said they are done with it ("bye", "that's all", "thanks, I'm done", "let's stop here"), call \`${CODER_TOOL.END_CALL}\` first and add nothing after it. Never call it on a bare "okay" or "thanks" mid-conversation, while they are mid-sentence, when they ask for it later ("end the call when the tests pass"), or because the work looks done.`;

/**
 * What a spoken turn of an agent on a task is told of talking its plan
 * through, which carries its sources: the plan as a spec,
 * the template's sections and their bars, the interfaces, hard parts, and
 * tests a teammate draws out, the developer still working out what they
 * want, what a note holds, and when the plan is done.
 */
const DOCUMENT_TALK_WORDS = `## Talking the plan through

On a call the developer may talk the task through with you rather than ask for code: keep its plan with \`${CODER_TOOL.EDIT_PLAN}\` as the talk settles it. The plan is the design doc two engineering teammates would write after talking a task through, and the whole spec an agent builds from without having heard the call: concrete enough that two agents given it would build the same behavior, structure, and interfaces. Talk like a teammate; hold the document to a spec's bar.

Its headings are its sections, and they are what you ask about. A line of guidance under a heading is the developer's prompt for that section, not an answer. Most plans start from the default template, whose sections each say what they hold and when they are done:

${DOCUMENT_SECTIONS}

Where the developer's template names its sections differently, hold each to the bar of the default section it stands for; a section with no counterpart is held to what its heading and guidance ask.

Context and goal come first: don't design an approach for a problem you don't understand yet. Spend your effort where a teammate adds the most: push on the approach, name an alternative the developer has not considered and say which you would pick, and hunt for the hard parts before an agent finds them. Read the code for the types and signatures a change touches and propose the new shapes yourself for the developer to confirm; for each goal, ask what happens when it goes wrong, and put the cases that matter with your recommended behavior; and turn each goal and hard part into a "When ..., then ..." case with an exact result for them to confirm.

Don't assume the developer arrives knowing what to build: while the idea is still rough, start from who it is for and what goes wrong today. When they are unsure, queue the same decision again as two or three concrete directions grounded in the code, with the one you recommend and why; if they still have no preference, take your recommendation as a working assumption and move on. A direction is settled only once they agreed to it.

Write what was settled: what the developer said, what you found, and what you proposed that they did not push back on; never a guess, and never a point the plan already holds. Put each point under the heading it answers, in its section's form. A section named under [sections the developer wrote] holds their own words: never reword or strike them, and raise anything that contradicts them with them.

The plan is done when it is enough for a separate agent to build the change without coming back with a question: every section meets its bar or the developer agreed it does not apply, and every remaining choice they do not mind either way is stated as an assumption. Then queue nothing more, withdraw what is still queued, and say the plan is complete, with the working assumptions for them to hear.`;

/** The line a turn's message rides behind, by whether it holds the task or the time alone. */
const TURN_MESSAGE_LEAD = {
  TASK: "The task as it stands as this turn opens, handed to you as data because it is new to you or changed since you last read it:",
  TIME: "The time as this turn opens, handed to you as data:",
} as const;

/**
 * What a session has handed its agent in its turns' messages, as content
 * addresses kept in eve's durable session state: the task, by the parts
 * of it no save of the plan changes (`taskKey`), the chat digest, an
 * operator's desk, and whether the call's words stand. Nothing yet for a session whose turns
 * handed none, or whose history eve compacted since.
 */
export interface TurnHanded {
  readonly task?: string;
  readonly chat?: string;
  /** The operator's desk as last handed (`../operator-desk.ts`), so one unchanged is not handed again. */
  readonly desk?: string;
  /** Whether the session's last turn was spoken, which a compaction leaves standing, so a typed turn after it says the call's words no longer hold. */
  readonly spoken?: boolean;
  /** Whether the call's words stand in the history since the last compaction, so a spoken turn after a spoken one need not hand them again. */
  readonly callWords?: boolean;
}

/** What a session has handed once eve compacted its history: only the last turn's kind, since a summary may have dropped the rest. */
export function handedAfterCompaction(handed: TurnHanded): TurnHanded {
  return handed.spoken === true ? { spoken: true } : {};
}

/** A content address: the same text always answers the same key. */
export function contentKey(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * The address of what a turn hands of the task beyond its plan, as the
 * model reads it: its name, brief, linked issues, open comment threads
 * (`openThreadsText`), and whiteboard (`boardText`), so a change the model
 * would not see, a resolved thread's or a drawing's own fields, hands the
 * task again no sooner. Note that the saved document, the agents' notes,
 * and the sections the developer wrote are left out, because every save of
 * the plan changes them, the agent's own among them; whether someone else
 * saved is read from the plan's revisions (`savedByAnotherSince`).
 */
export function taskKey(
  stored: StoredTask,
  board: Board,
  comments: readonly PlanCommentThread[],
): string {
  const { name } = stored.task;
  const read = [name, stored.brief ?? null, stored.issueLinks, openThreadsText(comments)];
  return contentKey(JSON.stringify([...read, boardText(board)]));
}

/** The line a turn opens with where its kind is the last turn's, or a typed one follows spoken ones. */
const TURN_KIND_LINE = {
  SPOKEN_AGAIN:
    'This turn is spoken too: the developer is still on the call, and "This turn is spoken" above still holds.',
  TYPED_AFTER_CALL:
    'This turn is typed: no call is live, so "This turn is spoken" above no longer holds. Your words are read, not heard, and a question for the developer goes to the inbox.',
} as const;

/**
 * What a turn opens with of its kind: on a spoken turn the call's words,
 * and how to talk the plan through for an agent on a task, unless the turn
 * before was spoken and the words still stand in the history, where a line
 * says they still hold; on a typed turn after a spoken one, a line saying
 * they no longer do; and nothing on a typed turn after a typed one.
 */
export function turnKindWords(
  spoken: boolean,
  handed: TurnHanded,
  onTask: boolean,
): string | undefined {
  const afterSpoken = handed.spoken === true;
  if (spoken && afterSpoken && handed.callWords === true) return TURN_KIND_LINE.SPOKEN_AGAIN;
  if (spoken) return onTask ? `${SPOKEN_WORDS}\n\n${DOCUMENT_TALK_WORDS}` : SPOKEN_WORDS;
  return afterSpoken ? TURN_KIND_LINE.TYPED_AFTER_CALL : undefined;
}

/**
 * Whether a revision of the plan someone other than the agent wrote was
 * saved after the instant given, the start of the agent's previous turn:
 * a member's, Luke's, or another agent's. Note that each revision is read,
 * not who last wrote each section, because the agent writing over a
 * section another just changed leaves the agent its last writer though it
 * never read the change; and that a revision of the agent's own is left
 * out, because it wrote what it saved. The history is read newest first, a
 * page of it, which holds every revision since a turn began unless more than
 * a page of them were saved during it.
 */
export function savedByAnotherSince(
  revisions: readonly PlanRevisionLine[],
  since: number,
  agentId: string,
): boolean {
  return revisions.some((revision) => revision.lastEdit.at > since && revision.agentId !== agentId);
}

/** The task as it stands, behind the line saying it is new or changed. */
export function taskWithLead(standing: string): string {
  return `${TURN_MESSAGE_LEAD.TASK}\n${standing}`;
}

/** The time as the turn opens alone, where nothing of the task is new. */
export function timeWithLead(standing: string): string {
  return `${TURN_MESSAGE_LEAD.TIME}\n${standing}`;
}
