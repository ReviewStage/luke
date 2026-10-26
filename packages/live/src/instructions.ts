import { developerSeedItem, type InitialItem } from "./seed.js";

/** The backend tool that hangs the call up, which the policy names on a line of its own wherever the backend holds it. */
const END_CALL_TOOL = "end_call";

/**
 * Where the agent a call speaks into stands, which its role, its plan's
 * lines, and its opening are chosen by, as the agent's own spoken words are
 * by whether it is on a task: on a task and not yet at work, so the call
 * scopes its plan; on a task and already at work, so the call steers that
 * work and keeps its plan; or on no task, so there is no plan at all.
 */
export const CALL_STANDING = {
  SCOPING: "scoping",
  AT_WORK: "at-work",
  NO_TASK: "no-task",
} as const;

export type CallStanding = (typeof CALL_STANDING)[keyof typeof CALL_STANDING];

/**
 * The policy's list of what the backend can do: every tool the caller names,
 * in its order, and, where the backend holds `end_call`, the line that says
 * it alone hangs the call up.
 */
function backendToolsLines(tools: readonly string[]): string {
  const lines = [
    "Backend tools:",
    `- The backend can call ${tools.join(", ")}. You cannot call them yourself; delegate to the backend to have them called.`,
  ];
  if (tools.includes(END_CALL_TOOL)) {
    lines.push(
      `- The call: ${END_CALL_TOOL}, the only way the call hangs up. A goodbye you say without delegating leaves the call up.`,
    );
  }
  return lines.join("\n");
}

/**
 * A call's backend is the agent it speaks into, which reads its
 * repository and, on a task, writes the plan itself; no notetaker reads the
 * call beside it, so what the developer settles reaches the agent and its
 * plan only through a delegation, and every decision, requirement,
 * correction, and retraction is one (`CALL_SETTLED_RULE`). The guide's Delegation
 * section asks for concrete conditions, so the policy is the template's own
 * conditions with the backend's tools named: the voice is choosing
 * whether one call is needed, and a tool it cannot name is a capability it
 * will not reach for. Note that the tools are named as the caller hands them,
 * those the agent is offered (`backendToolsLines`), rather than kept here by
 * hand, because a hand list drifted from what the backend was offered. Note that the backend keeps the question queue, so
 * every answer is a reason to delegate: it is what keeps the queue the voice
 * asks from current. Note that the call's start is no reason here, because
 * the agent was started on its own work and a call joins it there, and a
 * delegation before the developer's first words waits for them anyway. Note
 * that the goodbye is delegated as it starts rather than after, because the
 * backend's `end_call` then lands while the goodbye plays and the developer's
 * Mac hangs up as it ends instead of a turn later. Note that the call's tool
 * line says a goodbye alone hangs nothing up, the rule says every time, and
 * answering from the conversation stops being a reason not to delegate once
 * the developer is ending the call, because a goodbye is the one answer the
 * conversation always holds: a voice told `end_call` "hangs up once your
 * goodbye has played" said "See you around" and "Sure thing" to two requests
 * to end the call right after starting a coding agent and delegated neither,
 * and on a live eval the exception alone took the end requests delegated
 * from 9 of 24 to 17 of 24. Note that a start is one delegation carrying all
 * the developer said for the agent, because Luke started agents and then sent
 * each a second note with more detail; the start tool's note is where that
 * detail now goes.
 */
function callDelegationRules(settled: string): string {
  return `Delegate to the backend when:
- The request needs a backend capability or careful reasoning.
- A correction changes the work already requested.
${settled}
- The developer answers a question, or says they are unsure: pass the answer to the backend so it can queue what the answer unblocked.
- You need a fact about the code (what exists, where it lives, how it works, what it is called): never ask the developer for one.
- The developer asks to see something drawn, or mentions something they drew on the board.
- The developer asks how a coding agent is doing, or tells an agent to do something: pass it to the backend, which answers with the agent's progress in a sentence or two, or says what it sent the agent.
- The developer asks to start a coding agent ("start an agent on this", "start Sonnet on fixing the invite emails"): pass it to the backend in one delegation, with everything they said the agent should do, and the backend starts one and says in a sentence what it started; do not delegate a follow-up for the agent until the developer asks for a change; never start one they did not ask for, and ask first only when it is unclear whether they want one or what it should do.
- The developer asks you to end the call, or clearly says they are done with it ("can you end the call", "bye", "see ya", "that's all", "thanks, I'm done", "let's stop here"): say a one-line goodbye and delegate as you start it, so the backend can end the call. Do it every time, even right after another request or while a coding agent works; never answer "sure" or say goodbye without delegating. Never on a bare "okay" or "thanks" mid-conversation, while the developer is mid-sentence, when they ask for it later ("end the call when the agent finishes"), or because the plan looks complete.

Do not delegate to the backend when:
- You can answer from the conversation or a still-current result, unless the developer is ending the call or settled something the plan has not been told.
- You need a brief clarification to understand the request.

Delegate before giving an answer that depends on backend work.
Do not guess the result while waiting.`;
}

/**
 * The delegation rule for what the developer settles, by standing: written
 * into the plan where the agent is on a task, and acted on where it is on
 * none, which has no plan to write it into.
 */
const CALL_SETTLED_RULE = {
  [CALL_STANDING.SCOPING]:
    "- The developer states a decision, a requirement, a constraint, a correction, or takes something back: pass it to the backend, which writes it into the plan; nothing reaches the plan otherwise.",
  [CALL_STANDING.AT_WORK]:
    "- The developer states a decision, a requirement, a constraint, a correction, or takes something back: pass it to the backend, which acts on it and writes it into the plan; nothing reaches the agent or the plan otherwise.",
  [CALL_STANDING.NO_TASK]:
    "- The developer states a decision, a requirement, a constraint, a correction, or takes something back: pass it to the backend, which acts on it; nothing reaches the agent otherwise.",
} as const satisfies Record<CallStanding, string>;

/** The delegation policy, its tools those the backend holds. */
function callDelegationPolicy(standing: CallStanding, tools: readonly string[]): string {
  return `Delegation policy:\n${backendToolsLines(tools)}\n\n${callDelegationRules(CALL_SETTLED_RULE[standing])}`;
}

/**
 * The Live prompting guide's starter template, cut to who is speaking and
 * how, the two policies about holding a conversation, who hangs up, and the delegation
 * policy that says when the backend is asked. The guide's instruction for a migration
 * from Realtime is to start from the template and only add a rule once
 * listening shows a behavior that needs changing; none of its optional
 * controls — exact wording, fixed response sequences, turn-taking, tool
 * narration, response length — stands here, so what the voice says of a
 * commentary it is handed is the model's own. The backchannel and
 * interruption policies stay because they are about the call rather than the
 * words: one keeps the model from talking over the developer, the other
 * keeps it listening when they cut in. The role is the call's standing's
 * own, since a call into an agent at work or on no task scopes no new plan.
 * Note that it leads, because without a lead the voice waited for the
 * developer to drive and the call went quiet.
 */
const CALL_ROLE = {
  [CALL_STANDING.SCOPING]: `You are Luke, a senior engineer on the developer's team, helping them scope out an engineering task into a plan an agent can build.
Lead the conversation and never let it fall silent, but follow the developer when they want to take it their own way.
Your backend is the coding agent on the task, which writes the plan as the call settles it, so pass it everything the developer decides or corrects.`,
  [CALL_STANDING.AT_WORK]: `You are Luke, a senior engineer on the developer's team, speaking for the coding agent already at work on their task, so they can follow its work, steer it, and keep its plan current.
Lead the conversation and never let it fall silent, but follow the developer when they want to take it their own way.
Your backend is that agent, which acts on what the call settles and writes it into the plan, so pass it everything the developer asks, decides, or corrects.`,
  [CALL_STANDING.NO_TASK]: `You are Luke, a senior engineer on the developer's team, speaking for a coding agent that works on no task, so there is no plan: help the developer follow its work and steer it.
Lead the conversation and never let it fall silent, but follow the developer when they want to take it their own way.
Your backend is that agent, which acts on what the call settles, so pass it everything the developer asks, decides, or corrects.`,
} as const satisfies Record<CallStanding, string>;

/**
 * A call's one policy beyond the template, added because listening showed
 * each behavior: several questions read out at once, a pause after every
 * answer while the voice waited on the backend, one more question after the
 * plan was already enough to build from, and a developer with only a rough
 * idea pressed for decisions they had no basis to make. Note that the plan's
 * lines stand only where the agent is on a task, and that they leave the
 * assumptions to the backend, whose words on a complete plan already say
 * them aloud, because a voice told to read them back too said them twice.
 */
const CALL_CONVERSATION_POLICY = `Conversation policy: Keep the conversation flowing naturally and ask one question at a time. You are handed the backend's questions one at a time: ask each one as it comes. When the developer answers, carry on with the next question you are handed while the backend thinks and reads the repository in the background. Do not assume the developer already knows what they want: when they are unsure, do not press them, say it is fine not to know yet, and pass that to the backend, which answers with concrete options to choose from.`;

/** The conversation policy's lines on a plan, which only a call into an agent on a task holds. */
const CALL_PLAN_LINES = ` Once the backend says the plan is complete, ask no more queued questions: say what it said of the plan, then ask whether anything is missing. If the backend says the plan is not complete yet, say what is still missing and ask whether to settle it now or leave it open.`;

/** The conversation policy as the standing holds it: its plan's lines where the agent is on a task. */
function callConversationPolicy(standing: CallStanding): string {
  const plan = standing === CALL_STANDING.NO_TASK ? "" : CALL_PLAN_LINES;
  return `${CALL_CONVERSATION_POLICY}${plan}\n\n`;
}

/**
 * The policy that says who hangs up, beside the policies about holding the
 * call, added because listening showed the voice answering "Sure thing" to
 * "Can you end the call?" as though saying it ended the call: with the
 * delegation rule alone a live eval delegated that request 3 times in 8, and
 * with this line every end request in 18.
 */
const CALL_ENDING_POLICY = `Ending policy: You cannot hang up the call yourself; only the backend can. When the developer asks you to end the call or says goodbye, delegate to the backend as you start a one-line goodbye.

`;

/** How the voice speaks, and the two policies about holding a call, alike whatever its standing. */
const CALL_SPEAKING = `Speak warmly and naturally, at an unhurried pace. Be clear and direct, not overly cheerful.
If the developer is frustrated, acknowledge it briefly and focus on the next helpful step.

Backchannel policy: Use moderate backchannels. Acknowledge naturally without competing with the main response.

Interruption policy: Stop speaking when the developer interrupts. Listen to what they say.

`;

/**
 * The `instructions` a call is created with: its standing's role and
 * policies, naming the tools the agent the call speaks into is offered.
 */
export function sessionInstructions(
  standing: CallStanding,
  backendTools: readonly string[],
): string {
  return `${CALL_ROLE[standing]}\n${CALL_SPEAKING}${CALL_ENDING_POLICY}${callConversationPolicy(standing)}${callDelegationPolicy(standing, backendTools)}`;
}

/**
 * How a call opens, by its standing: on a task not yet at work, on what the
 * developer has in mind where the task is new, asked so a problem or a rough
 * idea is as good an answer as a design, and where its plan stands where it
 * is under way, as the history's first line says it is; into an agent at
 * work, on where that work stands; and into an agent on no task, on what it
 * is doing, with no task or plan to speak of.
 */
const CALL_OPENING_LINES = {
  [CALL_STANDING.SCOPING]: [
    "If the task above is new, greet the developer in a few words and ask what they have in mind,",
    "making it easy to answer with only a problem or a rough idea rather than a finished design.",
    "If it is under way, say in one sentence where it stands and ask the one question it most",
    "needs answered next.",
  ],
  [CALL_STANDING.AT_WORK]: [
    "Say in one sentence where the agent's work on the task above stands, and ask the one question",
    "it most needs answered next, or what the developer wants of it.",
  ],
  [CALL_STANDING.NO_TASK]: [
    "The agent works on no task and keeps no plan. Greet the developer in a few words, say in one",
    "sentence what the agent has been doing where its work is shown above, and ask what they want of it.",
  ],
} as const satisfies Record<CallStanding, readonly string[]>;

/**
 * A call's opening, as the last developer message of the history the call
 * is created with, which is the Live conversations guide's way to have the
 * model speak before the caller has: the greeting is in the session from its
 * first instant, so there is no instruction to append once it starts, no
 * acknowledgment to wait for, and no cue after it. Its words are its
 * standing's (`CALL_OPENING_LINES`), then a pick-up of the last call where
 * earlier calls are shown. It asks the question in the same turn, because a
 * voice that opened by handing the backend a look at the repository said
 * "give me a second" and then waited on a backend with nothing yet to go on.
 * It says that it shapes the opening alone, since the history stands for
 * the whole call.
 */
export function callOpeningHistory(standing: CallStanding): InitialItem {
  return developerSeedItem(
    [
      "Open the call now, in English, without waiting for the developer to speak.",
      ...CALL_OPENING_LINES[standing],
      "If earlier calls are shown above, pick up where the last one left off instead:",
      "say in one sentence what you were discussing and ask the next question from there.",
      "Ask that question in this same turn: do not say you are looking anything",
      "up, do not ask the developer to wait, and do not wait for the backend first. Then pause and",
      "listen. This shapes the opening alone: once it is said, carry on as your other instructions say.",
    ].join(" "),
  );
}
