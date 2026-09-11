import { Schema } from "effect";

/**
 * What a session is created with: the Live prompting guide's starter prompt
 * template with its bracketed parts filled in, and nothing beside them. The
 * guide's instruction for a migration from Realtime is to start there and only
 * add a rule once listening shows a specific behavior that needs changing, so
 * every optional control from its appendix — exact wording, fixed response
 * sequences, turn-taking, tool narration — is absent rather than tuned, and
 * the persona stays the brain's, whose words the voice says. Two deliberate
 * departures: the identity line reads "chief of staff" where the template
 * reads "voice assistant", and the delegation conditions are Luke's own
 * rather than the starter's, because the guide's Delegation section asks for
 * concrete conditions and fills that part of its own example the same way.
 */

export const LIVE_SCENE = {
  /** The desktop's conversation, with Luke's brain as its backend. */
  DESKTOP: "desktop",
  /** The first launch's introduction: no account, no backend, nothing to act on. */
  INTRODUCTION: "introduction",
} as const;

export type LiveScene = (typeof LIVE_SCENE)[keyof typeof LIVE_SCENE];

export const LiveSceneSchema = Schema.Literal(...Object.values(LIVE_SCENE));

/** The sections a session's instructions are composed from, in the guide's order. */
export const INSTRUCTION_SECTION = {
  IDENTITY: "identity",
  BACKCHANNEL_POLICY: "backchannel-policy",
  INTERRUPTION_POLICY: "interruption-policy",
  DELEGATION_POLICY: "delegation-policy",
} as const;

export type InstructionSection = (typeof INSTRUCTION_SECTION)[keyof typeof INSTRUCTION_SECTION];

export const InstructionSectionSchema = Schema.Literal(...Object.values(INSTRUCTION_SECTION));

export interface InstructionBlock {
  section: InstructionSection;
  lines: readonly string[];
}

/**
 * The template's second and third identity sentences, which carry no bracket
 * and so stand verbatim for every scene.
 */
const IDENTITY_TONE: readonly string[] = [
  "Speak warmly and naturally, at an unhurried pace. Be clear and direct, not overly cheerful.",
  "If the user is frustrated, acknowledge it briefly and focus on the next helpful step.",
];

const DESKTOP_IDENTITY: readonly string[] = [
  "You are Luke, a calm, friendly chief of staff for the developer's coding agents.",
  ...IDENTITY_TONE,
];

const INTRODUCTION_IDENTITY: readonly string[] = [
  "You are Luke, a calm, friendly chief of staff for the developer's coding agents, meeting them for the first time with nothing connected yet.",
  ...IDENTITY_TONE,
];

/** The guide's default, kept whole; a blanket "never speak while the user speaks" rule beside it would suppress listening sounds. */
const BACKCHANNEL_POLICY: readonly string[] = [
  "Backchannel policy: Use moderate backchannels. Acknowledge naturally without competing with the main response.",
];

const INTERRUPTION_POLICY: readonly string[] = [
  "Interruption policy: Stop speaking when the user interrupts. Listen to what they say.",
];

/**
 * The guide's Delegation section asks for concrete conditions — "the user
 * asks to change a booking" rather than "delegate when needed" — and its own
 * example replaces the starter template's generic bullets with the product's,
 * so the capabilities and both lists of conditions name what Luke's backend
 * actually does and what actually reaches it. The closing two lines are the
 * template's own: the one thing the voice must never do is answer for work the
 * backend has not confirmed.
 */
const DESKTOP_DELEGATION_POLICY: readonly string[] = [
  "Delegation policy:",
  "Backend tools:",
  "- Coding agents: read what each agent is doing, has finished, or is waiting on, and answer what needs the developer.",
  "- Actions: message an agent, open one, answer what it is waiting on, rename or create a workspace, move or comment on an issue.",
  "- Memory and settings: what the developer asked to remember, their settings, calendar holds, and issue tracker.",
  "",
  "Delegate to the backend when:",
  "- The developer asks about an agent, what needs them, an issue, a setting, or something they asked you to remember.",
  "- The developer asks you to message, open, answer, rename, create, move, or comment.",
  "- A correction changes a request already in progress.",
  "- The answer needs careful reasoning beyond a simple reply.",
  "",
  "Do not delegate to the backend when:",
  "- The developer greets you, makes small talk, or asks you to repeat a result already given.",
  "- You cannot tell what they are asking for without a brief clarification.",
  "",
  "Delegate before giving an answer that depends on backend work.",
  "Do not guess the result while waiting.",
];

/**
 * The introduction runs with no backend listening, so its capabilities and
 * conditions fill as nothing; the labels stay so the model reads the same
 * structure it reads on every other session, and the closing two lines, which
 * govern waiting on a backend, have nothing to govern.
 */
const INTRODUCTION_DELEGATION_POLICY: readonly string[] = [
  "Delegation policy:",
  "Backend tools:",
  "- None. Nothing is connected during the introduction.",
  "",
  "Delegate to the backend when:",
  "- Never during the introduction.",
  "",
  "Do not delegate to the backend when:",
  "- The developer asks anything at all: answer from the conversation, and where an answer would",
  "  need their agents or an action, say what you will do for them once they sign in.",
];

const SCENE_BLOCKS = {
  [LIVE_SCENE.DESKTOP]: [
    { section: INSTRUCTION_SECTION.IDENTITY, lines: DESKTOP_IDENTITY },
    { section: INSTRUCTION_SECTION.BACKCHANNEL_POLICY, lines: BACKCHANNEL_POLICY },
    { section: INSTRUCTION_SECTION.INTERRUPTION_POLICY, lines: INTERRUPTION_POLICY },
    { section: INSTRUCTION_SECTION.DELEGATION_POLICY, lines: DESKTOP_DELEGATION_POLICY },
  ],
  [LIVE_SCENE.INTRODUCTION]: [
    { section: INSTRUCTION_SECTION.IDENTITY, lines: INTRODUCTION_IDENTITY },
    { section: INSTRUCTION_SECTION.BACKCHANNEL_POLICY, lines: BACKCHANNEL_POLICY },
    { section: INSTRUCTION_SECTION.INTERRUPTION_POLICY, lines: INTERRUPTION_POLICY },
    { section: INSTRUCTION_SECTION.DELEGATION_POLICY, lines: INTRODUCTION_DELEGATION_POLICY },
  ],
} satisfies Record<LiveScene, readonly InstructionBlock[]>;

/** The blocks a scene's instructions are composed from, in the order they are emitted. */
export function sessionInstructionBlocks(scene: LiveScene): readonly InstructionBlock[] {
  return SCENE_BLOCKS[scene];
}

/** The `instructions` a session of this scene is created with: the blocks joined by a blank line. */
export function sessionInstructions(scene: LiveScene): string {
  return sessionInstructionBlocks(scene)
    .map((block) => block.lines.join("\n"))
    .join("\n\n");
}

/**
 * The introduction's opening, sent as one `session.instructions.append` with
 * a null delegation once `session.started` arrives, which is the guide's way
 * to have the model speak before the caller has: the greeting, its language,
 * and the instruction to greet at once and then listen. The voice service
 * sends it from the trusted side, so an accountless caller can open a bounded
 * introduction and nothing else. The detected sessions it may mention arrive
 * as a developer message in the session's `input`, never inside this text.
 */
export function greetingInstruction(): string {
  return [
    "Greet the developer now, in English, without waiting for them to speak. Say that you are",
    "Luke, that you have just been installed and live at the top of their screen by the notch,",
    "and that when one of their coding agents needs them, hits an error, or finishes, you will",
    "say so. If a developer message above lists agents already running, mention one or two by",
    "their titles as things you can already see. Keep it to two or three short sentences, then",
    "pause and listen.",
  ].join(" ");
}
