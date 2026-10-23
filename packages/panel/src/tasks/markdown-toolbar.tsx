import {
  SHORTCUT_KEY,
  type ShortcutChord,
  shortcutMatches,
  WRITING_BLOCK,
  WRITING_MARK,
  WRITING_SHORTCUTS,
  type WritingAction,
  type WritingShortcut,
} from "@luke/settings/shortcuts";
import { IconButton, Tooltip } from "@luke/ui";
import {
  BoldIcon,
  CodeIcon,
  FileDiffIcon,
  Heading2Icon,
  ItalicIcon,
  LinkIcon,
  ListChecksIcon,
  ListIcon,
  ListOrderedIcon,
  StrikethroughIcon,
  TextQuoteIcon,
} from "lucide-react";
import {
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useRef,
  useState,
} from "react";
import {
  MARKDOWN_FORMAT,
  type MarkdownEdit,
  type MarkdownFormat,
  markdownEdit,
  suggestionEdit,
} from "./markdown-edits.js";

/**
 * markdown-toolbar.tsx -- the compact row of formatting presses over a comment's words, GitHub's own set: heading, bold, italic, strikethrough, quote, code, link, and the three lists, with a suggestion before them where the comment is on lines of the head.
 *
 * Each press makes its edit (`markdown-edits.ts`) in the field as the
 * browser's own insertion, so ⌘Z takes it back as it takes back typing,
 * and leaves the field holding the focus, with what the press wrote
 * selected. The writing chords (`WRITING_SHORTCUTS`) in the field press their
 * formats, and ⌘K presses link, as in GitHub's own box, and are the field's while it has the
 * keyboard rather than the window's. The row is one toolbar to the
 * keyboard: Tab stops on it once, and the arrows, Home and End move along
 * it. A press never takes the focus from the field under the pointer, so
 * what was selected there stays selected for the press to wrap.
 */

/** The toolbar's own words. */
const TOOLBAR_WORDS = {
  GROUP: "Formatting",
  SUGGESTION: "Add a suggestion",
} as const;

/**
 * One formatting press: what it writes, what it is called, its glyph, and the
 * writing action whose chord the field answers for it. Link has no chord in
 * the vocabulary, so `chord` is the one this box keeps for it, ⌘K, as GitHub's does.
 */
interface FormatPress {
  readonly format: MarkdownFormat;
  readonly label: string;
  readonly icon: ReactNode;
  readonly action?: WritingAction;
  readonly chord?: ShortcutChord;
}

/** The chord a press answers: the vocabulary's for its action, or its own where it has none. */
function chordOf(press: FormatPress): ShortcutChord | undefined {
  if (press.action === undefined) return press.chord;
  const shortcut: WritingShortcut = WRITING_SHORTCUTS[press.action];
  return shortcut.chord;
}

/** The presses in the order they are drawn, in groups a rule stands between, as GitHub's own are. */
const FORMAT_GROUPS: readonly (readonly FormatPress[])[] = [
  [
    {
      format: MARKDOWN_FORMAT.HEADING,
      label: "Heading",
      icon: <Heading2Icon aria-hidden="true" />,
    },
    {
      format: MARKDOWN_FORMAT.BOLD,
      label: "Bold",
      icon: <BoldIcon aria-hidden="true" />,
      action: WRITING_MARK.BOLD,
    },
    {
      format: MARKDOWN_FORMAT.ITALIC,
      label: "Italic",
      icon: <ItalicIcon aria-hidden="true" />,
      action: WRITING_MARK.ITALIC,
    },
    {
      format: MARKDOWN_FORMAT.STRIKE,
      label: "Strikethrough",
      icon: <StrikethroughIcon aria-hidden="true" />,
      action: WRITING_MARK.STRIKE,
    },
  ],
  [
    {
      format: MARKDOWN_FORMAT.QUOTE,
      label: "Quote",
      icon: <TextQuoteIcon aria-hidden="true" />,
      action: WRITING_BLOCK.QUOTE,
    },
    {
      format: MARKDOWN_FORMAT.CODE,
      label: "Code",
      icon: <CodeIcon aria-hidden="true" />,
      action: WRITING_MARK.CODE,
    },
    {
      format: MARKDOWN_FORMAT.LINK,
      label: "Link",
      icon: <LinkIcon aria-hidden="true" />,
      chord: { key: SHORTCUT_KEY.K },
    },
  ],
  [
    {
      format: MARKDOWN_FORMAT.BULLETS,
      label: "Bulleted list",
      action: WRITING_BLOCK.BULLETED_LIST,
      icon: <ListIcon aria-hidden="true" />,
    },
    {
      format: MARKDOWN_FORMAT.NUMBERS,
      label: "Numbered list",
      action: WRITING_BLOCK.NUMBERED_LIST,
      icon: <ListOrderedIcon aria-hidden="true" />,
    },
    {
      format: MARKDOWN_FORMAT.TASKS,
      label: "Task list",
      action: WRITING_BLOCK.TODO_LIST,
      icon: <ListChecksIcon aria-hidden="true" />,
    },
  ],
];

/** A press as the toolbar draws it: its name, its glyph, the chord it answers, and what it does. */
interface ToolbarPress {
  readonly label: string;
  readonly icon: ReactNode;
  readonly chord?: ShortcutChord | undefined;
  readonly press: () => void;
}

/** Every press that answers a chord. */
const CHORDED = FORMAT_GROUPS.flat().filter((press) => chordOf(press) !== undefined);

/** Where each roving key moves the toolbar's one stop, from the stop it stands on among `count`. */
const ROVING_KEYS = new Map([
  ["ArrowRight", (at: number, count: number) => (at + 1) % count],
  ["ArrowLeft", (at: number, count: number) => (at - 1 + count) % count],
  ["Home", () => 0],
  ["End", (_at: number, count: number) => count - 1],
]);

/**
 * Makes an edit in the field as the browser's own insertion, which its undo
 * takes back, then selects what the edit left selected. Note that where
 * the browser makes no insertion, as a test's document, which has no
 * `execCommand`, cannot, the words are put in place and announced as
 * typing announces them, so the owner hears them either way.
 */
export function applyMarkdownEdit(field: HTMLTextAreaElement, edit: MarkdownEdit): void {
  field.focus();
  field.setSelectionRange(edit.from, edit.to);
  const inserted =
    "execCommand" in document && document.execCommand("insertText", false, edit.text);
  if (!inserted) {
    field.setRangeText(edit.text, edit.from, edit.to);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  field.setSelectionRange(edit.selectFrom, edit.selectTo);
}

/** The format a key pressed in the field asks for: a writing chord, or ⌘K for a link; none for any other key. */
export function formatForKey(
  event: Parameters<typeof shortcutMatches>[1],
): MarkdownFormat | undefined {
  return CHORDED.find((press) => {
    const chord = chordOf(press);
    if (chord === undefined) return false;
    // Note that Shift turns a digit into its symbol (⇧8 is "*"), so a shifted digit is told by its physical key.
    if (chord.shift === true && /^\d$/u.test(chord.key.key)) {
      const { metaKey, ctrlKey, altKey, shiftKey, code } = event;
      return metaKey && shiftKey && !ctrlKey && !altKey && code === chord.key.code;
    }
    return shortcutMatches(chord, event);
  })?.format;
}

/** The edit a press makes to the field as it stands now. */
export function fieldEdit(field: HTMLTextAreaElement, format: MarkdownFormat): MarkdownEdit {
  return markdownEdit(format, {
    value: field.value,
    start: field.selectionStart,
    end: field.selectionEnd,
  });
}

/**
 * The toolbar over the field `field` holds. `suggestion`, where given, is
 * the lines the comment is on as they read now, which Add a suggestion
 * writes as a suggestion block; without it no suggestion is offered.
 */
export function MarkdownToolbar({
  field,
  suggestion,
  disabled,
}: {
  field: RefObject<HTMLTextAreaElement | null>;
  suggestion?: string | undefined;
  disabled: boolean;
}): React.JSX.Element {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [stop, setStop] = useState(0);
  const edit = (make: (area: HTMLTextAreaElement) => MarkdownEdit) => {
    const area = field.current;
    if (area !== null && !disabled) applyMarkdownEdit(area, make(area));
  };
  const suggest: ToolbarPress[] =
    suggestion === undefined
      ? []
      : [
          {
            label: TOOLBAR_WORDS.SUGGESTION,
            icon: <FileDiffIcon aria-hidden="true" />,
            press: () =>
              edit((area) =>
                suggestionEdit(
                  { value: area.value, start: area.selectionStart, end: area.selectionEnd },
                  suggestion,
                ),
              ),
          },
        ];
  const groups = [
    suggest,
    ...FORMAT_GROUPS.map((group) =>
      group.map(
        (each): ToolbarPress => ({
          label: each.label,
          icon: each.icon,
          chord: chordOf(each),
          press: () => edit((area) => fieldEdit(area, each.format)),
        }),
      ),
    ),
  ].filter((group) => group.length > 0);
  const presses = groups.flat();
  // The presses a rule stands after: each group's last but the last group's.
  const ruled = new Set(groups.slice(0, -1).map((group) => group.at(-1)));
  const at = Math.min(stop, presses.length - 1);
  const rove = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = ROVING_KEYS.get(event.key);
    if (move === undefined) return;
    event.preventDefault();
    const next = move(at, presses.length);
    setStop(next);
    buttons.current[next]?.focus();
  };
  return (
    <div
      className="markdown-toolbar"
      role="toolbar"
      aria-label={TOOLBAR_WORDS.GROUP}
      onKeyDown={rove}
    >
      {presses.map((each, index) => (
        <Fragment key={each.label}>
          <Tooltip label={each.label} chord={each.chord}>
            <IconButton
              ref={(button) => {
                buttons.current[index] = button;
              }}
              icon={each.icon}
              label={each.label}
              disabled={disabled}
              tabbable={index === at}
              keepFocus
              onFocus={() => setStop(index)}
              onClick={each.press}
            />
          </Tooltip>
          {ruled.has(each) ? <span className="markdown-toolbar-rule" aria-hidden="true" /> : null}
        </Fragment>
      ))}
    </div>
  );
}
