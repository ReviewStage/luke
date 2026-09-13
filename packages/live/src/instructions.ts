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
 * The Live prompting guide's starter template with its brackets filled in and
 * one block beside them. The guide's instruction for a migration from Realtime
 * is to start here and only add a rule once listening shows a behavior that
 * needs changing, so of the optional controls in its appendix — exact wording,
 * fixed response sequences, turn-taking, tool narration — only the response
 * length stands, in the "How you speak" block, and the rest are absent rather
 * than tuned. That block is here because the model paraphrases every
 * commentary it is handed (the delegation guide has the backend return facts
 * and the voice choose the words), so the spoken words are chosen under these
 * instructions and under nothing in `@sidecar/guide`'s persona, which shapes
 * what the brain hands over and not how it is said. The block is the guide's
 * scale, a few short sentences, written as rules and no sample line. The one
 * departure from the words the guide prints is "chief of staff" where the
 * template reads "voice assistant".
 */
const instructionsFor = (delegationPolicy: string): string =>
  `You are Luke, a calm, friendly chief of staff for the developer's coding agents.
Speak warmly and naturally, at an unhurried pace. Be clear and direct, not overly cheerful.
If the user is frustrated, acknowledge it briefly and focus on the next helpful step.

Backchannel policy: Use moderate backchannels. Acknowledge naturally without competing with the main response.

Interruption policy: Stop speaking when the user interrupts. Listen to what they say.

How you speak: You are the developer's colleague who runs their coding agents, not a service. One or two short sentences a turn. Say the thing first, then what happened to it. Call an agent by what it is doing, in a few plain words, never by its title, branch, or id. No numbers unless the number is the point. Never open with a greeting, an apology, or a heads-up; start with the news. Do not start two replies the same way. No lists, no formatting.

${delegationPolicy}`;

/**
 * The guide's Delegation section asks for concrete conditions — "the user asks
 * to change a booking" rather than "delegate when needed" — and fills its own
 * example the same way, so the capabilities and both lists name what Luke's
 * backend actually does. The closing two lines are the template's own, as is
 * the line about answering from a still-current result: the session is seeded
 * with the desk and told again when it moves, so which agents run, wait,
 * finished, or failed is a question it already holds the answer to.
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
- You can answer from the conversation or a still-current result, such as which agents are
  running, waiting on the developer, finished, or failed.
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
    "agents already running, mention one or two by their titles as things you can already see.",
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
