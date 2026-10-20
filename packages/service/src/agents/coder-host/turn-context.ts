import type { StoredTask } from "@luke/database/models/task-store";
import {
  PLAN_FIELD_BAR,
  PLAN_FIELD_HEADING,
  PLAN_FIELD_PURPOSE,
} from "@luke/features/plan-template";
import { PLAN_FIELD } from "@luke/features/task-wire";
import { BRAIN_HOST_TURN, type BrainHostTurn } from "../brain-host/bounds.js";
import { CODER_TOOL } from "./tool-set.js";

/**
 * turn-context.ts -- what a coding agent's turn opens with beside its session's prompt: the call's words and the task as it stands.
 *
 * The session's prompt (`instructions.ts`) is composed once, as the session
 * starts, and stands for its life; a turn's own instruction is composed as
 * the turn opens and remembered by none (`apps/dev/instructions/prompt.ts`),
 * which is where what follows the kind of turn goes. A spoken turn is the
 * developer speaking on a call, through Luke's voice: it opens with the
 * words for a call, adapted from the brain's (`../brain-host/brain.ts`'s
 * `BRAIN_INSTRUCTIONS`): that every word is heard, how to speak, the
 * question queue, summarising rather than reading out, and never waiting;
 * an agent on a task is told too how to talk its plan through, since on a
 * call the agent is who the developer plans with. Then the task as it
 * stands (`../agent-runtime/standing-context.ts`), on every spoken turn,
 * and on a typed one only where someone other than the agent saved the
 * plan since the agent's last step, so a typed turn reads no more than it
 * did before unless there is something new to read.
 */

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
 * through, adapted from the brain's "The plan document" and "How to plan"
 * (`../brain-host/brain.ts`), which carry their sources: the plan as a spec,
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

/** The line the task as it stands rides behind, by why the turn is handed it. */
const STANDING_LEAD = {
  [BRAIN_HOST_TURN.SPOKEN]:
    "The task as it stands as this turn opens, handed to you as data on every spoken turn:",
  [BRAIN_HOST_TURN.TYPED]:
    "The plan was saved since your last turn by someone other than you. The task as it stands as this turn opens, handed to you as data:",
} as const satisfies Record<BrainHostTurn, string>;

/** The words a spoken turn opens with: the call's, and how to talk the plan through for an agent on a task. */
export function spokenTurnWords(onTask: boolean): string {
  return onTask ? `${SPOKEN_WORDS}\n\n${DOCUMENT_TALK_WORDS}` : SPOKEN_WORDS;
}

/**
 * Whether anyone but the agent saved the plan after the instant given, the
 * end of the agent's last step: a section a member, Luke, or another agent
 * last wrote since, or the plan's latest save. Note that a save of the
 * agent's own is left out, because it wrote what it saved, and that a save
 * another made and the agent then wrote over in the same section reads as
 * the agent's, which it then has read.
 */
export function savedByAnotherSince(stored: StoredTask, since: number, agentId: string): boolean {
  const lastEdit = stored.task.lastEdit;
  const saves =
    lastEdit === undefined ? stored.sectionWriters : [...stored.sectionWriters, lastEdit];
  return saves.some((save) => save.at > since && save.agentId !== agentId);
}

/** The task as it stands, behind the line saying why this turn is handed it. */
export function standingWithLead(turn: BrainHostTurn, standing: string): string {
  return `${STANDING_LEAD[turn]}\n${standing}`;
}
