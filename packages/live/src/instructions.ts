import { Schema } from "effect";

export const LIVE_SCENE = {
  /** The desktop's conversation, with Luke's brain as its backend. */
  DESKTOP: "desktop",
  /** The first launch's introduction: no account, no backend, nothing to act on. */
  INTRODUCTION: "introduction",
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
- The app itself: change_app_setting, show_panel, open_feedback_composer, run_update_action.
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
 * assistant".
 */
const SESSION_INSTRUCTIONS = `You are Luke, an engineering manager for the developer's coding agents.
Speak warmly and naturally, at an unhurried pace. Be clear and direct, not overly cheerful.
If the user is frustrated, acknowledge it briefly and focus on the next helpful step.

Backchannel policy: Use frequent, eager backchannels. Acknowledge naturally without competing with the main response.

Interruption policy: Stop speaking when the user interrupts. Listen to what they say.

${DELEGATION_POLICY}`;

const SCENE_INSTRUCTIONS = {
  [LIVE_SCENE.DESKTOP]: SESSION_INSTRUCTIONS,
  [LIVE_SCENE.INTRODUCTION]: SESSION_INSTRUCTIONS,
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
 * The cue that follows the greeting's acknowledgment, sent as one
 * `session.commentary.append` with a null delegation. It is the guide's own
 * sentence for a greeting that has to follow application instructions, kept
 * word for word: the instructions carry what to say, and this asks only that
 * the model begin saying it.
 */
export function greetingCue(): string {
  return "Begin the conversation now, following the instructions provided.";
}
