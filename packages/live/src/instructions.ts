import { Schema } from "effect";

export const LIVE_SCENE = {
  /** The desktop's conversation, with Luke's brain as its backend. */
  DESKTOP: "desktop",
  /** The first launch's introduction: no account, no backend, nothing to act on. */
  INTRODUCTION: "introduction",
} as const;

export type LiveScene = (typeof LIVE_SCENE)[keyof typeof LIVE_SCENE];

export const LiveSceneSchema = Schema.Literal(...Object.values(LIVE_SCENE));

/**
 * The Live prompting guide's starter template with its brackets filled in and
 * nothing beside them. The guide's instruction for a migration from Realtime
 * is to start here and only add a rule once listening shows a behavior that
 * needs changing, so every optional control from its appendix — exact wording,
 * fixed response sequences, turn-taking, tool narration — is absent rather
 * than tuned, and no persona stands here: `@sidecar/guide`'s is the brain's,
 * whose words the voice says. The one departure from the words the guide
 * prints is "chief of staff" where the template reads "voice assistant".
 */
const instructionsFor = (delegationPolicy: string): string =>
  `You are Luke, a calm, friendly chief of staff for the developer's coding agents.
Speak warmly and naturally, at an unhurried pace. Be clear and direct, not overly cheerful.
If the user is frustrated, acknowledge it briefly and focus on the next helpful step.

Backchannel policy: Use moderate backchannels. Acknowledge naturally without competing with the main response.

Interruption policy: Stop speaking when the user interrupts. Listen to what they say.

${delegationPolicy}`;

/**
 * The guide's Delegation section asks for concrete conditions — "the user asks
 * to change a booking" rather than "delegate when needed" — and fills its own
 * example the same way, so the capabilities and both lists name what Luke's
 * backend actually does. The closing two lines are the template's own.
 */
const DESKTOP_DELEGATION_POLICY = `Delegation policy:
Backend tools:
- Coding agents: read what each agent is doing, has finished, or is waiting on, and answer what needs the developer.
- Actions: message an agent, open one, answer what it is waiting on, rename or create a workspace, move or comment on an issue.
- Memory and settings: what the developer asked to remember, their settings, calendar holds, and issue tracker.

Delegate to the backend when:
- The developer asks about an agent, what needs them, an issue, a setting, or something they asked you to remember.
- The developer asks you to message, open, answer, rename, create, move, or comment.
- A correction changes a request already in progress.
- The answer needs careful reasoning beyond a simple reply.

Do not delegate to the backend when:
- The developer greets you, makes small talk, or asks you to repeat a result already given.
- You cannot tell what they are asking for without a brief clarification.

Delegate before giving an answer that depends on backend work.
Do not guess the result while waiting.`;

/**
 * Nothing answers a delegation during the introduction: the accountless
 * endpoint wires no carrier, so a model told it had backend tools would emit a
 * delegation nobody reads and promise an action it cannot reach — over a seed
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

const SCENE_INSTRUCTIONS = {
  [LIVE_SCENE.DESKTOP]: instructionsFor(DESKTOP_DELEGATION_POLICY),
  [LIVE_SCENE.INTRODUCTION]: instructionsFor(INTRODUCTION_DELEGATION_POLICY),
} satisfies Record<LiveScene, string>;

/** The `instructions` a session of this scene is created with. */
export function sessionInstructions(scene: LiveScene): string {
  return SCENE_INSTRUCTIONS[scene];
}

/**
 * The introduction's opening, sent as one `session.instructions.append` with
 * a null delegation once `session.started` arrives, which is the guide's way
 * to have the model speak before the caller has: the exact welcome text, its
 * language, and the instruction to greet at once and then listen. The voice
 * service sends it from the trusted side, so an accountless caller can open a
 * bounded introduction and nothing else. The detected sessions it may mention
 * arrive as a developer message in the session's `input`, never inside this
 * text, which is why the welcome is fixed and only what follows it varies.
 */
export function greetingInstruction(): string {
  return [
    "Greet the developer now, in English, without waiting for them to speak. Open with exactly",
    "these words: \"Hi, I'm Luke. I've just moved in at the top of your screen, by the notch.\"",
    "Then say that when one of their coding agents needs them, hits an error, or finishes, you",
    "will say so. If a developer message above lists agents already running, mention one or two",
    "by their titles as things you can already see. Keep it to two or three short sentences in",
    "all, then pause and listen.",
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
