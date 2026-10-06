import { Schema } from "effect";

export const LIVE_SCENE = {
  /** The desktop's conversation, with Luke's brain as its backend. */
  DESKTOP: "desktop",
  /** The first launch's introduction: no account, no backend, nothing to act on. */
  INTRODUCTION: "introduction",
  /** The Plans tab's call about one saved plan, with the planning model as its backend. */
  PLANNING: "planning",
} as const;

export type LiveScene = (typeof LIVE_SCENE)[keyof typeof LIVE_SCENE];

export const LiveSceneSchema = Schema.Literals(Object.values(LIVE_SCENE));

/**
 * The guide's Delegation section asks for concrete conditions, so the
 * capabilities name the backend's tools themselves rather than a summary of
 * them: the voice is choosing whether one call is needed, and a tool it
 * cannot name is a capability it will not reach for. The closing two lines
 * are the template's own. Note that the list is written out here rather than
 * read from the catalog, because `@sidecar/actions` already reaches this
 * package and an edge back would be a cycle, so a tool added to the catalog
 * is added here by hand or the voice never delegates for it.
 */
const DELEGATION_POLICY = `Delegation policy:
Backend tools:
- Read the desk: list_sessions, read_transcript, sessions_list, sessions_history.
- Act on a chat: send_session_message, run_session_control, open_session.
- Workspaces and names: create_workspace, add_workspace_agent, rename_workspace, rename_session.
- The app itself: change_app_setting, open_feedback_composer, run_update_action.
- Memory: read_workspace_file, write_workspace_file, append_daily_note, list_daily_notes, memory_search, memory_get.
- Hand off work: sessions_spawn, subagents.
- Speak and load guidance: announce, load_skill.

Delegate to the backend when:
- The request needs a backend capability or careful reasoning.
- A correction changes the work already requested.

Do not delegate to the backend when:
- You can answer from the conversation or a still-current result.
- You need a brief clarification to understand the request.

Delegate before giving an answer that depends on backend work.
Do not guess the result while waiting.`;

/**
 * Nothing answers a delegation during the introduction: the accountless
 * endpoint wires no carrier, so a model told it had backend tools would emit a
 * delegation nobody reads and promise an action it cannot reach, over a seed
 * that carries the developer's own detected session titles, which is exactly
 * what they will ask about first. This is the one thing the two scenes cannot
 * share.
 */
const INTRODUCTION_DELEGATION_POLICY = `Delegation policy:
Backend tools:
- None. Nothing is connected during the introduction.

Delegate to the backend when:
- Never during the introduction.

Do not delegate to the backend when:
- The developer asks anything at all: answer from the conversation, and where an answer would
  need their agents or an action, say what you will do for them once they sign in.`;

/**
 * A planning call's backend is the planning model, which holds the saved
 * document and reads the plan's repository; a notetaker beside the call
 * writes the plan, so there is no save to delegate. The policy is
 * the template's own conditions with the planning model's tools named, as
 * the desktop's names the brain's. Note that the backend keeps the question
 * queue, so every answer is a reason to delegate: it is what keeps the queue
 * the voice asks from current.
 */
const PLANNING_DELEGATION_POLICY = `Delegation policy:
Backend tools:
- The repository: run_in_repository, which runs shell commands in the plan's folder on the developer's Mac.
- Research: search_web and read_web_page, which can search the Internet.

Delegate to the backend when:
- The call has just started: ask the backend to start exploring the repository, and keep talking with the developer meanwhile.
- The request needs a backend capability or careful reasoning.
- A correction changes the work already requested.
- The developer answers a question: pass the answer to the backend so it can queue what the answer unblocked.
- You need a fact about the code (what exists, where it lives, how it works, what it is called): never ask the developer for one.

Do not delegate to the backend when:
- You can answer from the conversation or a still-current result.
- You need a brief clarification to understand the request.

Delegate before giving an answer that depends on backend work.
Do not guess the result while waiting.`;

/**
 * The Live prompting guide's starter template, cut to who is speaking and
 * how, the two policies about holding a conversation, and the delegation
 * policy that says when the backend is asked. The guide's instruction for a migration
 * from Realtime is to start from the template and only add a rule once
 * listening shows a behavior that needs changing; none of its optional
 * controls — exact wording, fixed response sequences, turn-taking, tool
 * narration, response length — stands here, so what the voice says of a
 * commentary it is handed is the model's own. The backchannel and
 * interruption policies stay because they are about the call rather than the
 * words: one keeps the model from talking over the developer, the other
 * keeps it listening when they cut in. The one departure from the words the
 * guide prints is "engineering manager" where the template reads "voice
 * assistant", and a planning call's role line is its own.
 */
const MANAGER_ROLE = "You are Luke, an engineering manager for the developer's coding agents.";
const PLANNING_ROLE = `You are Luke, a calm, friendly voice assistant planning out the implementation of a new engineering task with the user (a developer).
Lead the conversation until the backend says the plan is complete.
A notetaker writes the plan live as you talk; you never write it yourself.`;

/**
 * A planning call's one policy beyond the template, added because listening
 * showed each behavior: several questions read out at once, a pause after
 * every answer while the voice waited on the backend, and one more question
 * after the plan was already enough to build from.
 */
const PLANNING_CONVERSATION_POLICY = `Conversation policy: Keep the conversation flowing naturally and ask one question at a time. The backend queues its questions to you as it thinks of them: ask them in the order they were queued, and drop one the backend says is moot. When the developer answers, carry on with the next queued question while the backend thinks and reads the repository in the background. Once the backend says the plan is complete, ask no more queued questions: tell the developer the plan is ready, read back the assumptions and the choices left to the agent one at a time, and ask whether anything is missing. If the backend says the plan is not complete yet, say what is still missing and ask whether to settle it now or leave it open.

`;

const instructionsFor = (delegationPolicy: string, role = MANAGER_ROLE, scenePolicy = ""): string =>
  `${role}
Speak warmly and naturally, at an unhurried pace. Be clear and direct, not overly cheerful.
If the user is frustrated, acknowledge it briefly and focus on the next helpful step.

Backchannel policy: Use frequent, eager backchannels. Acknowledge naturally without competing with the main response.

Interruption policy: Stop speaking when the user interrupts. Listen to what they say.

${scenePolicy}${delegationPolicy}`;

const SCENE_INSTRUCTIONS = {
  [LIVE_SCENE.DESKTOP]: instructionsFor(DELEGATION_POLICY),
  [LIVE_SCENE.INTRODUCTION]: instructionsFor(INTRODUCTION_DELEGATION_POLICY),
  [LIVE_SCENE.PLANNING]: instructionsFor(
    PLANNING_DELEGATION_POLICY,
    PLANNING_ROLE,
    PLANNING_CONVERSATION_POLICY,
  ),
} satisfies Record<LiveScene, string>;

/** The `instructions` a session of this scene is created with. */
export function sessionInstructions(scene: LiveScene): string {
  return SCENE_INSTRUCTIONS[scene];
}

/**
 * The introduction's opening, sent as one `session.instructions.append` with
 * a null delegation once `session.started` arrives, which is the guide's way
 * to have the model speak before the caller has: the exact welcome text, its
 * language, and the instruction to greet at once and then stop. The greeting
 * is scripted, not a conversation: the takeover never unmutes the session,
 * so the developer cannot be heard, and the instruction says so rather than
 * letting the model invite an answer nothing will carry. The voice service
 * sends it from the trusted side, so an accountless caller can open a
 * bounded introduction and nothing else. The detected sessions it may mention
 * arrive as a developer message in the session's `input`, never inside this
 * text, which is why the welcome is fixed and only what follows it varies.
 */
export function greetingInstruction(): string {
  return [
    "Greet the developer now, in English, without waiting for them to speak. Open with exactly",
    "these words: \"Hi, I'm Luke. I've just moved in at the top of your screen, by the notch.\"",
    "If a developer message above gives the developer's first name, say it after the Hi, as",
    '"Hi <name>, I\'m Luke.", and nowhere else. Then say that when one of their coding agents',
    "needs them, hits an error, or finishes, you will say so. If a developer message above lists",
    "agents already running, mention one or two by what they are doing, in a few plain words of",
    "your own rather than their titles, as things you can already see.",
    'Close with exactly these words: "Let\'s get you set up." Keep it to three or four short',
    "sentences in all, then stop. This is a one-way greeting: the developer's microphone is off,",
    "so do not ask them anything, do not wait for a reply, and say nothing further.",
  ].join(" ");
}

/**
 * The launch greeting's instruction, the same guide form as the introduction's
 * and sent the same way, by the host once a signed-in launch's session
 * starts: the welcome's language, its exact words, and the instruction to
 * speak first and then listen. The developer's first name is the one value
 * that enters it, already bounded, and it stands inside the quoted welcome
 * as a name to say, not a sentence to follow. Without one the welcome is the
 * same line unaddressed. Unlike the introduction's, this session stays open
 * to listen, and an instructions append is standing text, so the instruction
 * says in as many words that it shapes the greeting alone and nothing after
 * it.
 */
export function launchGreetingInstruction(firstName: string | undefined): string {
  const welcome =
    firstName === undefined
      ? "Hey, I'm here and ready to help out. Anything you need me to do?"
      : `Hey ${firstName}, I'm here and ready to help out. Anything you need me to do?`;
  return [
    "Greet the developer now, in English, without waiting for them to speak. The greeting is",
    `exactly these words: "${welcome}"`,
    "Then pause and listen. This shapes the greeting alone: once it is said, answer whatever",
    "the developer says as you normally would.",
  ].join(" ");
}

/**
 * A planning call's opening, the same guide form as the introduction's and
 * sent the same way, by the voice service once a newly created planning
 * call starts, because a Live session waits for the caller's first words
 * until it is told to speak and the planning role is to lead. The plan the
 * call is about is already the session's seed, whose first line says
 * whether the plan is new or under way, so the instruction picks the
 * opening from that line: a new plan opens on what to build, and a plan
 * under way picks up where it stands. It asks the question in the same
 * turn, because a voice that opened by handing the backend a look at the
 * repository said "give me a second" and then waited on a backend with
 * nothing yet to go on. Like the launch greeting's, it says that it shapes
 * the opening alone, since an instructions append is standing text.
 */
export function planningOpeningInstruction(): string {
  return [
    "Open the call now, in English, without waiting for the developer to speak.",
    "If the plan above is new, greet the developer in a few words and ask what they want to build",
    "and what problem it solves. If it is under way, say in one sentence where it stands and ask",
    "the one question it most needs answered next. Ask that question in this same turn: do not",
    "say you are looking anything up, do not ask the developer to wait, and do not wait for the",
    "backend first. Then stop and listen. This shapes the opening alone: once it is said, carry",
    "on as your other instructions say.",
  ].join(" ");
}

/**
 * The cue that follows the greeting's acknowledgment, sent as one
 * `session.commentary.append` with a null delegation. It is the guide's own
 * sentence for a greeting that has to follow application instructions, kept
 * word for word: the instructions carry what to say, and this asks only that
 * the model begin saying it.
 */
export function greetingCue(): string {
  return "Begin the conversation now, following the instructions provided.";
}
