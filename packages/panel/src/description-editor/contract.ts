import type {
  WRITING_MARK,
  WritingBlock,
  WritingInsert,
  WritingMark,
} from "@repo/settings/shortcuts";
import type { ComboboxFieldProps } from "@repo/ui";

export interface EditorBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

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

export interface EditorFormatDoors {
  readonly onFormat: (format: EditorFormat) => void;
  readonly onLink: () => void;
}

export interface EditorFormatting {
  readonly selectionBox: () => EditorBox | undefined;
  readonly toggleMark: (mark: Exclude<WritingMark, typeof WRITING_MARK.LINK>) => void;
  readonly turnInto: (block: WritingBlock) => void;
  readonly setLink: (href: string | undefined) => void;
  readonly focus: () => void;
}

export interface PlacedWords {
  readonly section: number;
  readonly text: string;
  readonly occurrence: number;
  readonly offset: number;
  readonly code: boolean;
  readonly top: number;
}

export type DescriptionEditorPlacement =
  | {
      readonly x: number;
      readonly y: number;
      readonly words?: PlacedWords | undefined;
      readonly from?: PlacedWords | undefined;
    }
  | { readonly section: number }
  | typeof PLACEMENT_END;

export const PLACEMENT_END = { end: true } as const;

export const FINISH = {
  SUBMIT: "submit",
  ESCAPE: "escape",
} as const;

export type Finish = (typeof FINISH)[keyof typeof FINISH];

export const DESCRIPTION_PLACEHOLDER = "Write the description";

export const SLASH_INSERT = {
  DIAGRAM: "slash-diagram",
  TABLE: "slash-table",
  PICTURE: "slash-picture",
  MENTION: "slash-mention",
} as const;

type SlashInsert = (typeof SLASH_INSERT)[keyof typeof SLASH_INSERT];

export type SlashBlock = WritingBlock | WritingInsert | SlashInsert;

interface SlashMarkdown {
  readonly markdown: string;
}

export type SlashChoice = SlashBlock | SlashMarkdown;

export interface DescriptionEditorBlocks {
  readonly onTrigger: (trigger: ComposerTrigger | undefined) => void;
  readonly onKey: (event: KeyboardEvent) => boolean;
}

export interface DescriptionEditorProps {
  readonly markdown: string;
  readonly placement?: DescriptionEditorPlacement | undefined;
  readonly focus: boolean;
  readonly label: string;
  readonly placeholder?: string | undefined;
  readonly className: string;
  readonly onDraft: (markdown: string, anchors?: EditorAnchors) => void;
  readonly onFinish: (section: number, how: Finish) => void;
  readonly sendsOnEnter?: boolean | undefined;
  readonly onLeaveUp?: (() => void) | undefined;
  readonly mentions?: DescriptionEditorMentions | undefined;
  readonly drawDiagram?: ((element: HTMLElement, diagram: EditorDiagram) => () => void) | undefined;
  readonly drawTaskBox?: TaskBoxDrawer | undefined;
  readonly pictures?: DescriptionEditorPictures | undefined;
  readonly anchors?: readonly EditorAnchor[] | undefined;
  readonly format?: EditorFormatDoors | undefined;
  readonly blocks?: DescriptionEditorBlocks | undefined;
}

export interface EditorAnchor {
  readonly thread: string;
  readonly from: number;
  readonly to: number;
}

export interface EditorAnchors {
  readonly anchors: readonly EditorAnchor[];
  readonly carried: readonly string[];
}

export interface PictureNode {
  readonly src: string;
  readonly alt: string;
  readonly title: string;
  readonly upload: string;
}

export interface PictureNodeDoors {
  readonly describe: (change: { readonly alt?: string; readonly title?: string }) => void;
  readonly remove: () => void;
}

interface PictureDrawing {
  readonly redraw: (picture: PictureNode, selected: boolean) => void;
  readonly undraw: () => void;
}

export type PictureTaken =
  | { readonly upload: string; readonly file: File }
  | { readonly upload: string; readonly from: string };

export interface DescriptionEditorPictures {
  readonly draw: (
    element: HTMLElement,
    picture: PictureNode,
    doors: PictureNodeDoors,
  ) => PictureDrawing;
  readonly take: (taken: readonly PictureTaken[]) => void;
  readonly copies: (src: string) => boolean;
}

export interface EditorDiagram {
  readonly code: string;
  readonly previous: string | undefined;
}

export interface EditorTaskBox {
  readonly label: string;
  readonly checked: boolean;
  readonly toggle: (checked: boolean) => void;
}

export type TaskBoxDrawer = (element: HTMLElement, box: EditorTaskBox) => () => void;

export interface MentionNodeDoors {
  readonly rename: (mention: MentionNode, focus: boolean) => void;
  readonly remove: () => void;
  readonly focusAfter: () => void;
}

export type MentionDrawer = (
  element: HTMLElement,
  mention: MentionNode,
  doors: MentionNodeDoors,
) => () => void;

interface ComposerMentions {
  readonly onTrigger: (trigger: ComposerTrigger | undefined) => void;
  readonly drawMention: MentionDrawer;
  readonly pasted: (words: string) => MentionNode | undefined;
}

export interface MentionNode {
  readonly name: string;
  readonly target: string;
}

export interface HeadingsChange {
  readonly before: readonly string[];
  readonly after: readonly string[];
  readonly kept: ReadonlyMap<number, number>;
}

export interface DescriptionEditorMentions {
  readonly onTrigger: (trigger: ComposerTrigger | undefined) => void;
  readonly onKey: (event: KeyboardEvent) => boolean;
  readonly drawMention: MentionDrawer;
  readonly retarget: (target: string, change: HeadingsChange) => MentionNode | undefined;
  readonly pasted: (words: string) => MentionNode | undefined;
  readonly namesMention: (target: string) => boolean;
}

export interface EditorSpan {
  readonly from: number;
  readonly to: number;
  readonly quote: string;
  readonly text: string;
}

export interface DescriptionEditorHandle extends EditorFormatting {
  readonly take: (sent: string, merged: string) => { readonly base: string; readonly text: string };
  readonly chooseMention: (mention: MentionNode) => void;
  readonly insertBlock: (block: SlashChoice) => void;
  readonly markdown: () => string;
  readonly replaceAnchors: (
    text: string,
    anchors: readonly EditorAnchor[] | undefined,
    open: readonly string[],
  ) => void;
  readonly setAria: (aria: EditorAria) => void;
  readonly focusAt: (placement: DescriptionEditorPlacement) => void;
  readonly wordsTop: () => number | undefined;
  readonly caretWords: () => PlacedWords | undefined;
  readonly insertPictures: (files: readonly File[]) => void;
  readonly settlePicture: (upload: string, src: string) => void;
  readonly removePicture: (upload: string) => void;
  readonly selectionSpan: () => EditorSpan | undefined;
  readonly blockSpan: (element: Element) => EditorSpan | undefined;
  readonly destroy: () => void;
}

export interface ComposerTrigger {
  readonly start: number;
  readonly query: string;
  readonly rect: { readonly left: number; readonly top: number; readonly bottom: number };
}

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

export const EDITOR_ROOT_SELECTOR = ".ProseMirror";

export type EditorAria = Readonly<Record<string, string | undefined>>;

export function listAria(field: ComboboxFieldProps): EditorAria {
  return {
    "aria-expanded": String(field["aria-expanded"]),
    "aria-controls": field["aria-controls"],
    "aria-autocomplete": field["aria-autocomplete"],
    "aria-activedescendant": field["aria-activedescendant"],
  };
}

export function sameAria(a: EditorAria, b: EditorAria): boolean {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...names].every((name) => a[name] === b[name]);
}

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

export interface ComposerChip {
  readonly name: string;
}

export interface ComposerQuote {
  readonly words: string;
  readonly remove: () => void;
}

export interface ComposerEditorProps {
  readonly text: string;
  readonly skills: ReadonlySet<string>;
  readonly maxLength: number;
  readonly label: string;
  readonly className: string;
  readonly focus: boolean;
  readonly onDraft: (text: string) => void;
  readonly onKey: (event: KeyboardEvent) => boolean;
  readonly onEnter: () => void;
  readonly onPasteFiles: (files: readonly File[]) => boolean;
  readonly onPasteCut?: (() => void) | undefined;
  readonly onTrigger: (trigger: ComposerTrigger | undefined) => void;
  readonly drawChip: (element: HTMLElement, chip: ComposerChip) => () => void;
  readonly drawQuote?: ((element: HTMLElement, quote: ComposerQuote) => () => void) | undefined;
  readonly mentions?: ComposerMentions | undefined;
  readonly format?: EditorFormatDoors | undefined;
}

export interface ComposerMark {
  readonly insert: (words: string) => boolean;
  readonly release: () => void;
}

export interface ComposerEditorHandle extends EditorFormatting {
  readonly clear: () => void;
  readonly replace: (text: string) => void;
  readonly mark: () => ComposerMark;
  readonly chooseSkill: (name: string) => void;
  readonly insertQuote: (words: string) => boolean;
  readonly chooseMention: (mention: MentionNode) => void;
  readonly chooseSkillAtMention: (name: string) => void;
  readonly insertMention: (mention: MentionNode) => void;
  readonly setSkills: (skills: ReadonlySet<string>) => void;
  readonly setInput: (input: ComposerInput) => void;
  readonly setAria: (aria: EditorAria) => void;
  readonly blur: () => void;
  readonly destroy: () => void;
}

export const COMPOSER_INPUT = {
  EDITABLE: "editable",
  READ_ONLY: "read-only",
  DISABLED: "disabled",
} as const;

export type ComposerInput = (typeof COMPOSER_INPUT)[keyof typeof COMPOSER_INPUT];

export interface DescriptionEditorModule {
  readonly mount: (host: HTMLElement, props: DescriptionEditorProps) => DescriptionEditorHandle;
  readonly mountComposer: (host: HTMLElement, props: ComposerEditorProps) => ComposerEditorHandle;
}
