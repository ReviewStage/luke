/**
 * contract.ts -- what the panel and the editor bundle say to each other: a Markdown document's text and the composer's words, the two mount calls, and nothing that pulls TipTap into the panel.
 *
 * TipTap is too large for the bundle every window parses, so the panel's two
 * editors, a Markdown document's text (a plan's, and any other document the
 * panel edits, `../tasks/markdown-editor.tsx`) and an agent's message box, ship as one bundle of
 * their own (`plan-editor.js`, built from `./index.ts`) that the panel starts
 * loading after its first paint (`../bundle-loader.ts`), as the whiteboard
 * and a File tab's tree load the first time they are shown. That bundle exports
 * one module, `planEditor`, and this file is the whole of what the
 * two share. Nothing here imports a value, so the panel carries none of the
 * editor's libraries, and the voice window, which loads the panel's bundle,
 * parses none of them.
 */

import type {
  WRITING_MARK,
  WritingBlock,
  WritingInsert,
  WritingMark,
} from "@luke/settings/shortcuts";
import type { ComboboxFieldProps, TextAreaSubmit } from "@luke/ui";

/** A box in the window, in the coordinates `getBoundingClientRect` speaks. */
export interface EditorBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * The selection as a format toolbar reads it: where it stands in the text,
 * which moves the toolbar as it changes; whether it holds any words;
 * whether it touches a code block, where no toolbar stands; whether it
 * touches a table's cell, where no block can be turned; the marks every
 * selected word wears, Link's among them; the one kind of block it stands
 * in, none where it spans several; and the link it or the caret stands in.
 */
export interface EditorFormat {
  readonly from: number;
  readonly to: number;
  readonly empty: boolean;
  readonly code: boolean;
  readonly cell: boolean;
  readonly marks: readonly WritingMark[];
  readonly block: WritingBlock | undefined;
  readonly link: string | undefined;
}

/**
 * What a format toolbar hands an editor as it mounts: the selection told
 * after every change to it or its words (`onFormat`), and ⌘K over selected
 * words or in a link (`onLink`), which opens the owner's link field. Note
 * that ⌘K anywhere else is the window's command palette, so the editor
 * leaves it alone there.
 */
export interface EditorFormatDoors {
  readonly onFormat: (format: EditorFormat) => void;
  readonly onLink: () => void;
}

/** What a format toolbar does to an editor's selection, and where it reads it standing. */
export interface EditorFormatting {
  /** Where the selected words stand in the window, the editor focused or not; none where nothing is laid out to measure. */
  readonly selectionBox: () => EditorBox | undefined;
  /** A mark laid on every selected word, or taken off where every one wears it. */
  readonly toggleMark: (mark: Exclude<WritingMark, typeof WRITING_MARK.LINK>) => void;
  /** The blocks the selection stands in turned into `block`. */
  readonly turnInto: (block: WritingBlock) => void;
  /** The selected words, or the whole link the caret stands in, linked to `href`; unlinked where it is none. */
  readonly setLink: (href: string | undefined) => void;
  /** The editor focused, its selection as it stood. */
  readonly focus: () => void;
}

/**
 * The words a click landed on in a section as drawn: the section, the text
 * node's words, how many nodes of the same words came before it in the
 * section, and the offset in them. Note that the editor is placed by these
 * rather than by the click's point, because opening it can move what stands
 * under the point: a picture, a table, or a diagram's preview is drawn at
 * another height in the editor than in the text.
 */
export interface PlacedWords {
  readonly section: number;
  readonly text: string;
  readonly occurrence: number;
  readonly offset: number;
  /**
   * Whether the words stand in a code block, and so are counted only among
   * code's. Note that the two are counted apart, because the text draws a
   * diagram's code as its picture, while the editor keeps the code.
   */
  readonly code: boolean;
  /** Where their line stood in the window as they were clicked, which the panel keeps them at as the editor opens. */
  readonly top: number;
}

/** Where the caret goes as the editor opens: where a click landed, on the words it landed on where they are known, the end of a section, or the end of the text; the start of the text without any. */
export type PlanEditorPlacement =
  | { readonly x: number; readonly y: number; readonly words?: PlacedWords | undefined }
  | { readonly section: number }
  | typeof PLACEMENT_END;

/** The caret at the end of the text, as a press on the room under its last line puts it. */
export const PLACEMENT_END = { end: true } as const;

/** How the text was finished: ⌘↩, which a box sends or saves on, or Esc, which it lets go on; a plan finishes either way. */
export const FINISH = {
  SUBMIT: "submit",
  ESCAPE: "escape",
} as const;

export type Finish = (typeof FINISH)[keyof typeof FINISH];

/** What an empty plan says until a word is typed, the editor's own where a document names none. */
export const PLAN_PLACEHOLDER = "Write the plan";

/** What the `/` menu lays in beyond the writing vocabulary's blocks, each the menu's own. */
export const SLASH_INSERT = {
  DIAGRAM: "slash-diagram",
  TABLE: "slash-table",
  PICTURE: "slash-picture",
  MENTION: "slash-mention",
} as const;

type SlashInsert = (typeof SLASH_INSERT)[keyof typeof SLASH_INSERT];

/** A block the `/` menu offers: one a line is turned into, the divider, or one of the menu's own. */
export type SlashBlock = WritingBlock | WritingInsert | SlashInsert;

/** A block of a document's own its `/` menu offers, laid in as the Markdown it names. */
interface SlashMarkdown {
  readonly markdown: string;
}

/** What a choice in the `/` menu lays in: one of the menu's blocks, or a document's own. */
export type SlashChoice = SlashBlock | SlashMarkdown;

/**
 * The plan editor's `/`, as the panel draws its menu: the `/` word the caret
 * ends reported (`onTrigger`), and the keys the menu over it takes first
 * (`onKey`), answering whether it took one.
 */
export interface PlanEditorBlocks {
  readonly onTrigger: (trigger: ComposerTrigger | undefined) => void;
  readonly onKey: (event: KeyboardEvent) => boolean;
}

/**
 * What a document hands the editor as it mounts it: a plan in place of its
 * text's drawn sections, or another Markdown document in place of its drawn
 * words. What a plan alone takes, its sections' placement, mentions,
 * pictures, comment threads, and diagrams, is each left out where the
 * document takes none.
 */
export interface PlanEditorProps {
  /** The text as the document holds it, which the editor opens on. */
  readonly markdown: string;
  /** Where the caret goes as the editor opens; the start of the text where none is given. */
  readonly placement?: PlanEditorPlacement | undefined;
  /** Whether the editor takes the keyboard as it mounts, as a task opened by a click or a key does and a page drawing it does not. */
  readonly focus: boolean;
  readonly label: string;
  /** What the empty text says until a word is typed; "Write the plan" where none is given. */
  readonly placeholder?: string | undefined;
  /** The read view's own classes, so the editor's words stand where the drawn words stood. */
  readonly className: string;
  /** The text as it would be saved now, after each change, and where the comment threads' words stand in it, where the editor carries any. */
  readonly onDraft: (markdown: string, anchors?: EditorAnchors) => void;
  /** Esc or ⌘↩, with the section the caret stood in, counted as `planSections` counts them, and which of the two it was. */
  readonly onFinish: (section: number, how: Finish) => void;
  /** ↑ from the first line of the text, which goes to the title above it; none where nothing stands above the text, where ↑ is the editor's own. */
  readonly onLeaveUp?: (() => void) | undefined;
  /** What the text's mentions are drawn and picked with; none where the text takes no mentions, as a template does not. */
  readonly mentions?: PlanEditorMentions | undefined;
  /**
   * Draws a Mermaid code block's diagram into the element the editor stands
   * under the block, as the panel draws it in the read view, so the panel's
   * one copy of the diagram bundle serves both; answers what takes the
   * drawing down. None where the text draws no diagrams.
   */
  readonly drawDiagram?: ((element: HTMLElement, diagram: EditorDiagram) => () => void) | undefined;
  /** What the text's pictures are drawn and taken in with; none where the text takes no pictures, as a template does not. */
  readonly pictures?: PlanEditorPictures | undefined;
  /** The open comment threads' words, in offsets of `markdown`, which the editor carries as its words move; none where the text has no comments. */
  readonly anchors?: readonly EditorAnchor[] | undefined;
  /** What a format toolbar over the text hears of its selection; none where no toolbar stands over it. */
  readonly format?: EditorFormatDoors | undefined;
  /** What the `/` menu over the text hears of its `/` word and its keys; none where no menu stands over it, which an empty line then does not offer. */
  readonly blocks?: PlanEditorBlocks | undefined;
}

/** The words one comment thread is on, as offsets into a plan's Markdown. */
export interface EditorAnchor {
  readonly thread: string;
  readonly from: number;
  readonly to: number;
}

/**
 * Where the editor's comment threads stand in a draft's Markdown, and the
 * threads it carries: a carried thread with no anchor had its words deleted
 * in the editor; one with its anchor back had them brought back by undo.
 */
export interface EditorAnchors {
  readonly anchors: readonly EditorAnchor[];
  readonly carried: readonly string[];
}

/**
 * A picture the plan's text holds, as the editor's node keeps it: its
 * address, its alt text, and its caption, the Markdown title; and, while
 * the picture is still being kept, the upload it waits on, which the panel
 * names and the address stays empty for. A picture with an upload writes
 * nothing to the text, so no draft or save ever carries one half-kept.
 */
export interface PictureNode {
  readonly src: string;
  readonly alt: string;
  readonly title: string;
  readonly upload: string;
}

/** What the panel may do to the picture it draws: describe it anew, or take it out of the text. */
export interface PictureNodeDoors {
  readonly describe: (change: { readonly alt?: string; readonly title?: string }) => void;
  readonly remove: () => void;
}

/** A picture as the panel draws it into its node's element: drawn again as the node changes or is selected, and taken down. */
interface PictureDrawing {
  readonly redraw: (picture: PictureNode, selected: boolean) => void;
  readonly undraw: () => void;
}

/** A picture laid into the text that is still to be kept: a file pasted, dropped, or chosen, or a picture of another plan pasted from its address. */
export type PictureTaken =
  | { readonly upload: string; readonly file: File }
  | { readonly upload: string; readonly from: string };

/**
 * The plan editor's pictures, as the panel draws and keeps them: each
 * picture the text holds drawn into its node's own element (`draw`), the
 * pictures laid in that are still to be kept handed over under the upload
 * each node waits on (`take`), and whether a pasted picture's address is
 * another plan's, which is kept again on this one (`copies`).
 */
export interface PlanEditorPictures {
  readonly draw: (
    element: HTMLElement,
    picture: PictureNode,
    doors: PictureNodeDoors,
  ) => PictureDrawing;
  readonly take: (taken: readonly PictureTaken[]) => void;
  readonly copies: (src: string) => boolean;
}

/**
 * A Mermaid code block as the editor asks its diagram drawn: its code, and
 * the code the block held before the change that asked again, whose picture
 * may stand while the new one is drawn; nothing for a block just opened.
 */
export interface EditorDiagram {
  readonly code: string;
  readonly previous: string | undefined;
}

/**
 * What the panel may do to a mention it draws: name it anew in place, the
 * caret put after it and the editor focused where asked, in one change undo
 * takes back whole; take it out of the words; or put the caret after it
 * and the editor focused, as a picker it opened closes.
 */
export interface MentionNodeDoors {
  readonly rename: (mention: MentionNode, focus: boolean) => void;
  readonly remove: () => void;
  readonly focusAfter: () => void;
}

/** Draws a mention into the element its node stands as, with the doors to its node; answers what takes the drawing down. */
export type MentionDrawer = (
  element: HTMLElement,
  mention: MentionNode,
  doors: MentionNodeDoors,
) => () => void;

/** The composer's mentions, as the box picks and draws them. */
interface ComposerMentions {
  readonly onTrigger: (trigger: ComposerTrigger | undefined) => void;
  readonly drawMention: MentionDrawer;
  /** The mention words pasted whole stand for, an address of Luke's own or a page of an integration's; nothing for any other words, which paste as words. */
  readonly pasted: (words: string) => MentionNode | undefined;
  /** The `#` word the caret ends, as it changes, where the box names channels (chat's); none where it names none. */
  readonly onChannelTrigger?: ((trigger: ComposerTrigger | undefined) => void) | undefined;
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
 * headings of the text (`retarget`), answering the target under the
 * section's heading now, or nothing where the section it names kept its
 * heading and its anchor, or names none.
 */
export interface PlanEditorMentions {
  readonly onTrigger: (trigger: ComposerTrigger | undefined) => void;
  readonly onKey: (event: KeyboardEvent) => boolean;
  readonly drawMention: MentionDrawer;
  readonly retarget: (target: string, change: HeadingsChange) => MentionNode | undefined;
  /** The mention words pasted whole stand for, an address of Luke's own or a page of an integration's; nothing for any other words, which paste as words. */
  readonly pasted: (words: string) => MentionNode | undefined;
  /** Whether a link's target names a mention, which the read view draws as its chip, so the editor draws the link in a chip's light look. */
  readonly namesMention: (target: string) => boolean;
}

/** Words of the editor a thread is started on: where they stand in `text`, the Markdown the editor would hand over now, and the words themselves. */
export interface EditorSpan {
  readonly from: number;
  readonly to: number;
  readonly quote: string;
  readonly text: string;
}

/** An editor as mounted. */
export interface PlanEditorHandle extends EditorFormatting {
  /**
   * A save's merged answer taken in: Luke's part of `merged`, against what was
   * `sent`, laid in place of the blocks it changed. Answers the text the next
   * save is a change from, and the text the editor holds now.
   */
  readonly take: (sent: string, merged: string) => { readonly base: string; readonly text: string };
  /** The `@` word the caret ends written as the mention chosen, a space after it, the caret after the space. */
  readonly chooseMention: (mention: MentionNode) => void;
  /** The `/` word the caret ends deleted, and `block` run on the block the caret stands in, or a document's own Markdown laid in there; with no `/` word, a document's own Markdown laid in after the caret's block. */
  readonly insertBlock: (block: SlashChoice) => void;
  /** The text as the editor holds it now, ahead of the draft it hands over once typing pauses. */
  readonly markdown: () => string;
  /** The attributes that tie the text to the `@` list or the `/` menu over it (`listAria`), which name it a combobox while the list stands (`rootAria`). */
  readonly setAria: (aria: EditorAria) => void;
  /** The caret put where the placement says and the editor focused, as a press on the text's room does while it is open. */
  readonly focusAt: (placement: PlanEditorPlacement) => void;
  /** Where the line of the words a click opened the editor on stands in the window, down from its top; none where it opened elsewhere, the words not found, or the caret has since been put elsewhere, or where it cannot be measured. */
  readonly wordsTop: () => number | undefined;
  /** The words the caret stands in, as the drawn text finds them again, and where their line stands in the window; none off any words, or where nothing is laid out. The panel keeps them where they stood as the editor closes. */
  readonly caretWords: () => PlacedWords | undefined;
  /** Image files laid in as pictures after the block the caret stands in, each handed to the panel to keep. */
  readonly insertPictures: (files: readonly File[]) => void;
  /** The picture waiting on `upload` given its address, kept at last, which the text now names. */
  readonly settlePicture: (upload: string, src: string) => void;
  /** The picture waiting on `upload` taken out of the text, as its Remove does. */
  readonly removePicture: (upload: string) => void;
  /** The words selected, as a thread started on them anchors them; nothing where none are. */
  readonly selectionSpan: () => EditorSpan | undefined;
  /** The block `element` is drawn in, whole, as a thread started on it anchors it; nothing where it is no block of the text, a diagram's preview say. */
  readonly blockSpan: (element: Element) => EditorSpan | undefined;
  readonly destroy: () => void;
}

/** A word being typed after a trigger character, as the composer's trigger reports it: where the character stands, what follows it up to the caret, and where it stands in the window. */
export interface ComposerTrigger {
  /** Where the character stands in the words, which names the word while it is typed on. */
  readonly start: number;
  readonly query: string;
  readonly rect: { readonly left: number; readonly top: number; readonly bottom: number };
}

/** Whether two reports say the same, so an unchanged word is not reported again. */
export function sameTrigger(
  a: ComposerTrigger | undefined,
  b: ComposerTrigger | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.start === b.start &&
    a.query === b.query &&
    a.rect.left === b.rect.left &&
    a.rect.top === b.rect.top &&
    a.rect.bottom === b.rect.bottom
  );
}

/** The editor's root element, whichever it names itself: a textbox, or a combobox while a list over it stands (`rootAria`). */
export const EDITOR_ROOT_SELECTOR = ".ProseMirror";

/** An editor root's attributes for assistive technology, each a string, or none where it takes one away. */
export type EditorAria = Readonly<Record<string, string | undefined>>;

/** The names a list's field carries (`useComboboxField`'s), as the editor root that steers the list takes them; the root's role is the editor's own (`rootAria`). */
export function listAria(field: ComboboxFieldProps): EditorAria {
  return {
    "aria-expanded": String(field["aria-expanded"]),
    "aria-controls": field["aria-controls"],
    "aria-autocomplete": field["aria-autocomplete"],
    "aria-activedescendant": field["aria-activedescendant"],
  };
}

/** Whether two sets of attributes say the same, so an editor handed what it holds already is not updated again. */
export function sameAria(a: EditorAria, b: EditorAria): boolean {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...names].every((name) => a[name] === b[name]);
}

/**
 * The editor root's attributes beside its list's (`listAria`): the combobox
 * that names the list and its active row while the list stands, and the
 * multi-line textbox it is otherwise, which takes none of a combobox's
 * relationships. Note that an attribute with no value is left out rather
 * than handed on, because ProseMirror writes every value it is handed as a
 * string.
 */
export function rootAria(aria: EditorAria): Readonly<Record<string, string>> {
  const open = aria["aria-expanded"] === "true";
  const named: EditorAria = open
    ? { ...aria, role: "combobox" }
    : {
        ...aria,
        role: "textbox",
        "aria-multiline": "true",
        "aria-expanded": undefined,
        "aria-controls": undefined,
        "aria-activedescendant": undefined,
      };
  return Object.fromEntries(
    Object.entries(named).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/** A chip the composer draws in its words: a skill, written `/name`. */
export interface ComposerChip {
  readonly name: string;
}

/** A quote of the agent's words the composer holds as a block of its own (`@luke/ui/reply-quote`): its words, and what takes it out of the box. */
export interface ComposerQuote {
  readonly words: string;
  readonly remove: () => void;
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
  /** Enter with no Shift, while no input method is composing; on a coarse pointer, where Enter is a new line, only with ⌘ or Ctrl. */
  readonly onEnter: () => void;
  /** The key that sends, as it stands now: Enter where the box leaves it out, ⌘ or Ctrl with Enter where Enter must break the line. */
  readonly submitKey?: (() => TextAreaSubmit) | undefined;
  /** Files pasted; answers whether the owner took them, which keeps them out of the words. */
  readonly onPasteFiles: (files: readonly File[]) => boolean;
  /** A paste that ran past the bound and was cut to the room left, or laid in nowhere for want of it; the owner says so, since the words it sees are not the words pasted. */
  readonly onPasteCut?: (() => void) | undefined;
  /** The `/` word the caret stands at the end of, as it changes; nothing once it stands in none. */
  readonly onTrigger: (trigger: ComposerTrigger | undefined) => void;
  /** Draws a chip into the element its node stands as; answers what takes the drawing down. */
  readonly drawChip: (element: HTMLElement, chip: ComposerChip) => () => void;
  /** Draws a quote into the element its block stands as; answers what takes the drawing down. Where none is given, the quote's words are drawn as they are. */
  readonly drawQuote?: ((element: HTMLElement, quote: ComposerQuote) => () => void) | undefined;
  /** What the box's mentions are picked and drawn with: an `@` word reported as `/` words are, and each mention drawn into its node's element; none where the box takes no mentions. */
  readonly mentions?: ComposerMentions | undefined;
  /** The format toolbar's doors, the selection told to it and ⌘K over words handed to it, where one stands over the box. */
  readonly format?: EditorFormatDoors | undefined;
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

/** A composer's editor as mounted: every change from outside goes through one of these, never through the words handed back, a format toolbar's presses among them. Note that the box holds no block, so its toolbar offers no Turn into. */
export interface ComposerEditorHandle extends EditorFormatting {
  /** Empties the words, as a send that was taken does. */
  readonly clear: () => void;
  /** Lays in words whole, the caret at their end, as Retry's restored message does. */
  readonly replace: (text: string) => void;
  /** Marks the caret where it stands, for words that land later (dictation). */
  readonly mark: () => ComposerMark;
  /** The `/` word the caret ends written as the skill named, a space after it. */
  readonly chooseSkill: (name: string) => void;
  /**
   * Words of the agent's laid in as a quote block under the line the caret
   * stands on, or in its place where the line is empty, the caret on an
   * empty line under it and the box focused; cut where the bound cuts it.
   * Answers whether any went in.
   */
  readonly insertQuote: (words: string) => boolean;
  /** The `@` word the caret ends written as the mention chosen, a space after it, the caret after the space. */
  readonly chooseMention: (mention: MentionNode) => void;
  /** The `@` word the caret ends written as the skill named, as a `/` word's pick writes it. */
  readonly chooseSkillAtMention: (name: string) => void;
  /** The `#` word the caret ends, or else its `@` word, written as the plain words given (`#general`), a space after them. */
  readonly chooseWords: (words: string) => void;
  /** A mention made elsewhere (a File tab's ⌥K) laid in where the caret stands, a space after it, the box focused; nothing where it has no room under the bound. */
  readonly insertMention: (mention: MentionNode) => void;
  /** The skills a `/name` names: each such word is drawn as a chip from now on. */
  readonly setSkills: (skills: ReadonlySet<string>) => void;
  /** Whether the words take a change: off while a message is held, read-only while a dictation stands, which keeps the caret. */
  readonly setInput: (input: ComposerInput) => void;
  /** The attributes that tie the editor element to its list (`listAria`), which name it a combobox while the list stands (`rootAria`). */
  readonly setAria: (aria: EditorAria) => void;
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

/** What the editor bundle's entry exports, which the panel imports the first time it is needed (`../bundle-loader.ts`). */
export interface PlanEditorModule {
  readonly mount: (host: HTMLElement, props: PlanEditorProps) => PlanEditorHandle;
  readonly mountComposer: (host: HTMLElement, props: ComposerEditorProps) => ComposerEditorHandle;
}
