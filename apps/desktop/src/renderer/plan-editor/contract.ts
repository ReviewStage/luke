/**
 * contract.ts -- what the panel and the editor bundle say to each other: the plan's text and the composer's words, the two mount calls, and nothing that pulls TipTap into the panel.
 *
 * TipTap is too large for the bundle every window parses, so the panel's two
 * editors, a plan's text and an agent's message box, ship as one bundle of
 * their own (`plan-editor.js`, built from `./index.ts`) that the panel starts
 * loading after its first paint (`../editor-bundle.ts`), as the whiteboard
 * and a File tab's tree load the first time they are shown. That bundle sets
 * one global, `window.lukePlanEditor`, and this file is the whole of what the
 * two share. Nothing here imports a value, so the panel carries none of the
 * editor's libraries, and the voice window, which loads the panel's bundle,
 * parses none of them.
 */

/** Where the caret goes as the editor opens: where a click landed, or the end of a section; the start of the text without either. */
export type PlanEditorPlacement =
  | { readonly x: number; readonly y: number }
  | { readonly section: number };

/** What the document hands the editor as it mounts it in place of the text's drawn sections. */
export interface PlanEditorProps {
  /** The text as the document holds it, which the editor opens on. */
  readonly markdown: string;
  readonly placement: PlanEditorPlacement | undefined;
  /** Whether the editor takes the keyboard as it mounts, as a plan opened by a click or a key does and a page drawing it does not. */
  readonly focus: boolean;
  readonly label: string;
  /** The read view's own classes, so the editor's words stand where the drawn words stood. */
  readonly className: string;
  /** The text as it would be saved now, after each change. */
  readonly onDraft: (markdown: string) => void;
  /** Esc or ⌘↩, with the section the caret stood in, counted as `planSections` counts them. */
  readonly onFinish: (section: number) => void;
  /** ↑ from the first line of the text, which goes to the title above it. */
  readonly onLeaveUp: () => void;
  /** What the text's mentions are drawn and picked with; none where the text takes no mentions, as a template does not. */
  readonly mentions?: PlanEditorMentions | undefined;
}

/** The composer's mentions, as the box picks and draws them. */
interface ComposerMentions {
  readonly onTrigger: (trigger: ComposerTrigger | undefined) => void;
  readonly drawMention: (element: HTMLElement, mention: MentionNode) => () => void;
  /** The mention words pasted whole stand for, a page of an integration's address; nothing for any other words, which paste as words. */
  readonly pasted: (words: string) => MentionNode | undefined;
}

/** A mention the plan's text holds: the name it was written with, without its `@`, and its link's target, which the panel alone reads. */
export interface MentionNode {
  readonly name: string;
  readonly target: string;
}

/**
 * The text's section headings, as `planSections` knows them, before an edit
 * and after it, and where each section the edit kept, its heading still the
 * block it was, stands among them now: what the panel reads a section's
 * anchor moving off, since only it spells anchors.
 */
export interface HeadingsChange {
  readonly before: readonly string[];
  readonly after: readonly string[];
  /** A kept section's place among `before`, to its place among `after`. */
  readonly kept: ReadonlyMap<number, number>;
}

/**
 * The plan editor's mentions, as the panel draws and picks them: an `@` word
 * the caret ends reported (`onTrigger`), the keys a list over it takes first
 * (`onKey`), each mention the text holds drawn into its node's own element
 * (`drawMention`), and a target named again where the edit changed the
 * headings of the text (`retarget`), answering the new target or nothing
 * where the section it names kept its anchor, or names none.
 */
export interface PlanEditorMentions {
  readonly onTrigger: (trigger: ComposerTrigger | undefined) => void;
  readonly onKey: (event: KeyboardEvent) => boolean;
  readonly drawMention: (element: HTMLElement, mention: MentionNode) => () => void;
  readonly retarget: (target: string, change: HeadingsChange) => string | undefined;
  /** The mention words pasted whole stand for, a page of an integration's address; nothing for any other words, which paste as words. */
  readonly pasted: (words: string) => MentionNode | undefined;
}

/** An editor as mounted. */
export interface PlanEditorHandle {
  /**
   * A save's merged answer taken in: Luke's part of `merged`, against what was
   * `sent`, laid in place of the blocks it changed. Answers the text the next
   * save is a change from, and the text the editor holds now.
   */
  readonly take: (sent: string, merged: string) => { readonly base: string; readonly text: string };
  /** The `@` word the caret ends written as the mention chosen, a space after it, the caret after the space. */
  readonly chooseMention: (mention: MentionNode) => void;
  /** The text as the editor holds it now, ahead of the draft it hands over once typing pauses. */
  readonly markdown: () => string;
  readonly destroy: () => void;
}

/** A word being typed after a trigger character, as the composer's trigger reports it: where the character stands, what follows it up to the caret, and where it stands in the window. */
export interface ComposerTrigger {
  /** Where the character stands in the words, which names the word while it is typed on. */
  readonly start: number;
  readonly query: string;
  readonly rect: { readonly left: number; readonly top: number; readonly bottom: number };
}

/** A chip the composer draws in its words: a skill, written `/name`. */
export interface ComposerChip {
  readonly name: string;
}

/** What the message box hands its editor as it mounts it. */
export interface ComposerEditorProps {
  /** The words it opens on, each `/name` of a known skill a chip. */
  readonly text: string;
  /** The skills a `/name` names, which become chips. */
  readonly skills: ReadonlySet<string>;
  /** The longest the words may grow, counted as the draft string counts them. */
  readonly maxLength: number;
  readonly label: string;
  readonly className: string;
  /** Whether the editor takes the keyboard as it mounts. */
  readonly focus: boolean;
  /** The words as they stand after each change, the one way they leave the editor. */
  readonly onDraft: (text: string) => void;
  /** A key, heard before the editor's own handling; answers whether the owner took it. */
  readonly onKey: (event: KeyboardEvent) => boolean;
  /** Enter with no Shift, while no input method is composing. */
  readonly onEnter: () => void;
  /** Files pasted; answers whether the owner took them, which keeps them out of the words. */
  readonly onPasteFiles: (files: readonly File[]) => boolean;
  /** The `/` word the caret stands at the end of, as it changes; nothing once it stands in none. */
  readonly onTrigger: (trigger: ComposerTrigger | undefined) => void;
  /** Draws a chip into the element its node stands as; answers what takes the drawing down. */
  readonly drawChip: (element: HTMLElement, chip: ComposerChip) => () => void;
  /** What the box's mentions are picked and drawn with: an `@` word reported as `/` words are, and each mention drawn into its node's element; none where the box takes no mentions. */
  readonly mentions?: ComposerMentions | undefined;
}

/** The caret as it stood when marked, carried through every change since, and the words put in there. */
export interface ComposerMark {
  /**
   * The words put in where the mark now stands, spaced from a word on either
   * side and cut where the bound cuts them, the caret after them; answers
   * whether any went in. The mark is let go either way.
   */
  readonly insert: (words: string) => boolean;
  readonly release: () => void;
}

/** A composer's editor as mounted: every change from outside goes through one of these, never through the words handed back. */
export interface ComposerEditorHandle {
  /** Empties the words, as a send that was taken does. */
  readonly clear: () => void;
  /** Lays in words whole, the caret at their end, as Retry's restored message does. */
  readonly replace: (text: string) => void;
  /** Marks the caret where it stands, for words that land later (dictation). */
  readonly mark: () => ComposerMark;
  /** The `/` word the caret ends written as the skill named, a space after it. */
  readonly chooseSkill: (name: string) => void;
  /** The `@` word the caret ends written as the mention chosen, a space after it, the caret after the space. */
  readonly chooseMention: (mention: MentionNode) => void;
  /** The `@` word the caret ends written as the skill named, as a `/` word's pick writes it. */
  readonly chooseSkillAtMention: (name: string) => void;
  /** A mention made elsewhere (a File tab's ⌥K) laid in where the caret stands, a space after it, the box focused; nothing where it has no room under the bound. */
  readonly insertMention: (mention: MentionNode) => void;
  /** The skills a `/name` names: each such word is drawn as a chip from now on. */
  readonly setSkills: (skills: ReadonlySet<string>) => void;
  /** Whether the words take a change: off while a message is held, read-only while a dictation stands, which keeps the caret. */
  readonly setInput: (input: ComposerInput) => void;
  /** The editor element's attributes that tie it to an open list, for assistive technology. */
  readonly setAria: (aria: Readonly<Record<string, string | undefined>>) => void;
  readonly focus: () => void;
  readonly blur: () => void;
  readonly destroy: () => void;
}

/** Whether the composer's words take a change. */
export const COMPOSER_INPUT = {
  EDITABLE: "editable",
  /** Keeps the caret and the keys, refusing every change but a mark's. */
  READ_ONLY: "read-only",
  DISABLED: "disabled",
} as const;

export type ComposerInput = (typeof COMPOSER_INPUT)[keyof typeof COMPOSER_INPUT];

/** What the editor bundle sets on `window` once it has loaded. */
export interface PlanEditorModule {
  readonly mount: (host: HTMLElement, props: PlanEditorProps) => PlanEditorHandle;
  readonly mountComposer: (host: HTMLElement, props: ComposerEditorProps) => ComposerEditorHandle;
}

declare global {
  interface Window {
    lukePlanEditor?: PlanEditorModule;
  }
}

/** The file the plan editor's bundle is, beside `index.html`. */
export const PLAN_EDITOR_ASSET = { SCRIPT: "plan-editor.js" } as const;
