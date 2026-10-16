import { developerSeedItem, type InitialItem } from "./seed.js";

/**
 * A planning call's backend is the planning model, which holds the saved
 * document and reads the plan's repository; a notetaker beside the call
 * writes the plan, so there is no save to delegate. The guide's Delegation
 * section asks for concrete conditions, so the policy is the template's own
 * conditions with the planning model's tools named: the voice is choosing
 * whether one call is needed, and a tool it cannot name is a capability it
 * will not reach for. Note that the backend keeps the question queue, so
 * every answer is a reason to delegate: it is what keeps the queue the voice
 * asks from current. Note that the call's start is no reason here, because
 * the service sets the backend exploring as the session starts, and a
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
const PLANNING_DELEGATION_POLICY = `Delegation policy:
Backend tools:
- The repository: run_in_repository, which runs shell commands in a checkout of the task's GitHub repository.
- Research: search_web and read_web_page, which can search the Internet.
- The whiteboard: draw_on_board, which draws on the board the developer sees beside the plan.
- Coding agents: list_agents, read_agent, message_agent, start_agent, and list_tasks, which say how an agent working on this task or another task of the workspace is doing, pass the developer's instruction to one, and start a new one on this task's plan, on a prompt in the developer's words, or on another task of the workspace.
- The call: end_call, the only way the call hangs up. A goodbye you say without delegating leaves the call up.

Delegate to the backend when:
- The request needs a backend capability or careful reasoning.
- A correction changes the work already requested.
- The developer answers a question, or says they are unsure: pass the answer to the backend so it can queue what the answer unblocked.
- You need a fact about the code (what exists, where it lives, how it works, what it is called): never ask the developer for one.
- The developer asks to see something drawn, or mentions something they drew on the board.
- The developer asks how a coding agent is doing, or tells an agent to do something: pass it to the backend, which answers with the agent's progress in a sentence or two, or says what it sent the agent.
- The developer asks to start a coding agent ("start an agent on this", "start Sonnet on fixing the invite emails"): pass it to the backend in one delegation, with everything they said the agent should do, and the backend starts one and says in a sentence what it started; do not delegate a follow-up for the agent until the developer asks for a change; never start one they did not ask for, and ask first only when it is unclear whether they want one or what it should do.
- The developer asks you to end the call, or clearly says they are done with it ("can you end the call", "bye", "see ya", "that's all", "thanks, I'm done", "let's stop here"): say a one-line goodbye and delegate as you start it, so the backend can end the call. Do it every time, even right after another request or while a coding agent works; never answer "sure" or say goodbye without delegating. Never on a bare "okay" or "thanks" mid-conversation, while the developer is mid-sentence, when they ask for it later ("end the call when the agent finishes"), or because the plan looks complete.

Do not delegate to the backend when:
- You can answer from the conversation or a still-current result, unless the developer is ending the call.
- You need a brief clarification to understand the request.

Delegate before giving an answer that depends on backend work.
Do not guess the result while waiting.`;

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
 * keeps it listening when they cut in. The role line is a planning call's
 * own. Note that it leads, because without a lead the voice waited for the
 * developer to drive and the call went quiet.
 */
const PLANNING_ROLE = `You are Luke, a senior engineer on the developer's team, helping them scope out a new engineering task into a plan an agent can build.
Lead the conversation and never let it fall silent, but follow the developer when they want to take it their own way.
A notetaker writes the plan live as you talk; you never write it yourself.`;

/**
 * A planning call's one policy beyond the template, added because listening
 * showed each behavior: several questions read out at once, a pause after
 * every answer while the voice waited on the backend, one more question
 * after the plan was already enough to build from, and a developer with only
 * a rough idea pressed for decisions they had no basis to make.
 */
const PLANNING_CONVERSATION_POLICY = `Conversation policy: Keep the conversation flowing naturally and ask one question at a time. You are handed the backend's questions one at a time: ask each one as it comes. When the developer answers, carry on with the next question you are handed while the backend thinks and reads the repository in the background. Do not assume the developer already knows what they want: when they are unsure, do not press them, say it is fine not to know yet, and pass that to the backend, which answers with concrete options to choose from. Once the backend says the plan is complete, ask no more queued questions: tell the developer the plan is ready, read back the assumptions and the choices left to the agent one at a time, and ask whether anything is missing. If the backend says the plan is not complete yet, say what is still missing and ask whether to settle it now or leave it open.

`;

/**
 * The policy that says who hangs up, beside the policies about holding the
 * call, added because listening showed the voice answering "Sure thing" to
 * "Can you end the call?" as though saying it ended the call: with the
 * delegation rule alone a live eval delegated that request 3 times in 8, and
 * with this line every end request in 18.
 */
const PLANNING_ENDING_POLICY = `Ending policy: You cannot hang up the call yourself; only the backend can. When the developer asks you to end the call or says goodbye, delegate to the backend as you start a one-line goodbye.

`;

const PLANNING_INSTRUCTIONS = `${PLANNING_ROLE}
Speak warmly and naturally, at an unhurried pace. Be clear and direct, not overly cheerful.
If the user is frustrated, acknowledge it briefly and focus on the next helpful step.

Backchannel policy: Use moderate backchannels. Acknowledge naturally without competing with the main response.

Interruption policy: Stop speaking when the user interrupts. Listen to what they say.

${PLANNING_ENDING_POLICY}${PLANNING_CONVERSATION_POLICY}${PLANNING_DELEGATION_POLICY}`;

/** The `instructions` a planning call is created with. */
export function sessionInstructions(): string {
  return PLANNING_INSTRUCTIONS;
}

/**
 * A planning call's opening, as the last developer message of the history
 * the call is created with, which is the Live conversations guide's way to
 * have the model speak before the caller has: the greeting is in the session
 * from its first instant, so there is no instruction to append once it starts,
 * no acknowledgment to wait for, and no cue after it. The plan the call is
 * about is the history's first message, whose first line says whether the
 * plan is new or under way, so the opening picks its words from that line: a
 * new plan opens on what the developer has in mind, asked so a problem or a
 * rough idea is as good an answer as a design, and a plan under way picks up
 * where it stands. It asks the question in the same turn, because a voice
 * that opened by handing the backend a look at the repository said "give me
 * a second" and then waited on a backend with nothing yet to go on. It says
 * that it shapes the opening alone, since the history stands for the whole
 * call.
 */
export function planningOpeningHistory(): InitialItem {
  return developerSeedItem(
    [
      "Open the call now, in English, without waiting for the developer to speak.",
      "If the task above is new, greet the developer in a few words and ask what they have in mind,",
      "making it easy to answer with only a problem or a rough idea rather than a finished design.",
      "If it is under way, say in one sentence where it stands and ask the one question it most",
      "needs answered next. If earlier calls about it are shown above, pick up where the last one",
      "left off instead: say in one sentence what you were discussing and ask the next question from there.",
      "Ask that question in this same turn: do not say you are looking anything",
      "up, do not ask the developer to wait, and do not wait for the backend first. Then pause and",
      "listen. This shapes the opening alone: once it is said, carry on as your other instructions say.",
    ].join(" "),
  );
}
