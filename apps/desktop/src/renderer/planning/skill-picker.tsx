import {
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  chooseSkill,
  holdsSlashWord,
  matchingSkills,
  mentionAt,
  type SkillMention,
  type SkillOption,
  skillTokens,
  type TextRange,
  withoutTokenBefore,
} from "./skill-mention";

/**
 * skill-picker.tsx -- the list a `/` in the composer opens, of the skills the plan's repository keeps, and the chips the chosen ones are drawn as.
 *
 * The list opens the way an @-mention list does in every chat: at the
 * caret, as soon as a `/` starts a word (`skill-mention.ts`), with one row
 * per skill, its name and a muted line of what it is for, narrowed as the
 * name is typed. ↑ and ↓ move the highlight, Enter or Tab writes the
 * highlighted skill into the message as `/name`, and Escape closes the
 * list until the caret leaves that word; the caret stays in the box
 * throughout, so the keys the list does not take are the box's own. The
 * skills are read the first time a `/` is typed in the box, from the
 * plan's repository as the service finds them, and kept for the plan
 * (`repository-skills.ts`), so nothing is read for a message that names
 * none. A repository that keeps none says so, and where one is added.
 *
 * A chosen skill is drawn as a chip in the words: the box stays a plain
 * textarea, and a layer under it, set in the same type at the same
 * insets, lays a pill behind each `/name` that names one of the
 * repository's skills. A Backspace at a chip's end takes the whole word
 * out. The list stands above the caret's line, since the box stands at
 * the foot of its tab, and inside the box's width.
 */

/** The skills the plan's repository keeps, as the composer reads them: the skills, or why they were not read. */
export type SkillsRead = { readonly skills: readonly SkillOption[] } | { readonly unread: string };

/** Reads the plan's repository's skills; asked the first time a `/` is typed. */
export type SkillSource = () => Promise<SkillsRead>;

/** What the list says where it has no row to offer. */
const SKILL_MENU_NOTE = {
  READING: "Reading skills…",
  NONE: "No skills in this repository",
  NONE_HINT: "Add one at .agents/skills/<name>/SKILL.md",
  NO_MATCH: "No matching skills",
} as const;

/** The list's own name, which its listbox is read by. */
const SKILL_MENU_LABEL = "Skills";

/** The gap between the caret's line and the list over it. */
const MENU_GAP = 4;

/** The list's width, as the stylesheet sets it (`.skill-menu`), which keeps it inside the box. */
const MENU_WIDTH = 320;

/** The styles a textarea's text is laid out by, copied onto the mirror that measures where its caret stands. */
const MIRRORED = [
  "box-sizing",
  "width",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "line-height",
  "text-transform",
  "word-spacing",
  "tab-size",
  "text-indent",
] as const;

/** Where a character of the field stands, from the field's top left as it is scrolled now. */
interface FieldPoint {
  readonly left: number;
  readonly top: number;
}

/**
 * Where the character at the index stands in the field, measured on a
 * hidden copy of its text laid out as the field lays it out, since a
 * textarea says where its caret is in characters and never in pixels.
 */
function caretPoint(field: HTMLTextAreaElement, index: number): FieldPoint {
  const mirror = document.createElement("div");
  const style = getComputedStyle(field);
  for (const property of MIRRORED) {
    mirror.style.setProperty(property, style.getPropertyValue(property));
  }
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.textContent = field.value.slice(0, index);
  const marker = document.createElement("span");
  marker.textContent = field.value.slice(index) || ".";
  mirror.append(marker);
  document.body.append(mirror);
  const point = { left: marker.offsetLeft, top: marker.offsetTop - field.scrollTop };
  mirror.remove();
  return point;
}

/** The message cut at the chips, each chip's words marked, for the layer under the box. */
function chipped(text: string, tokens: readonly TextRange[]): ReactNode[] {
  const pieces: ReactNode[] = [];
  let at = 0;
  for (const token of tokens) {
    pieces.push(text.slice(at, token.start));
    pieces.push(
      <mark key={token.start} className="skill-chip">
        {text.slice(token.start, token.end)}
      </mark>,
    );
    at = token.end;
  }
  pieces.push(text.slice(at));
  return pieces;
}

/** The highlight as it was moved, held against the word it was moved in, so a word typed on starts it again at the first row. */
interface Highlight {
  readonly start: number;
  readonly query: string;
  readonly at: number;
}

/** What the composer draws and wires: the list while it is open, the layer of chips, and the field's handlers. */
export interface SkillPicker {
  /** The list, while a `/` word is being typed and not closed; nothing otherwise. */
  readonly menu: ReactNode;
  /** The layer under the box that draws the chips. */
  readonly chips: ReactNode;
  /** The field's attributes that tie it to the list, for assistive technology. */
  readonly fieldProps: {
    readonly "aria-autocomplete": "list";
    readonly "aria-expanded": boolean;
    readonly "aria-controls": string | undefined;
    readonly "aria-activedescendant": string | undefined;
  };
  /** Takes a key the list or a chip answers, and says whether it did. */
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** Hears the caret move, a type or a press or a selection. */
  readonly onCaret: () => void;
  /** Hears the box lose the caret, which closes the list. */
  readonly onBlur: () => void;
  /** Hears the box scroll, which the chips follow. */
  readonly onScroll: () => void;
}

/** The rows the list offers for the word under the caret; none while the skills are not read, or could not be. */
function offered(read: SkillsRead | undefined, mention: SkillMention | undefined) {
  if (read === undefined || "unread" in read || mention === undefined) return [];
  return matchingSkills(read.skills, mention.query);
}

/** The line the list shows where it offers no row. */
function MenuNote({ read }: { read: SkillsRead | undefined }): React.JSX.Element {
  if (read === undefined)
    return <p className="plan-compose-menu-note">{SKILL_MENU_NOTE.READING}</p>;
  if ("unread" in read) return <p className="plan-compose-menu-note">{read.unread}</p>;
  if (read.skills.length > 0) {
    return <p className="plan-compose-menu-note">{SKILL_MENU_NOTE.NO_MATCH}</p>;
  }
  return (
    <div className="plan-compose-menu-note skill-menu-none">
      <span>{SKILL_MENU_NOTE.NONE}</span>
      <span className="skill-menu-hint">{SKILL_MENU_NOTE.NONE_HINT}</span>
    </div>
  );
}

/** One row's id, under the list's own, which the field names as the row the keys would choose. */
function optionId(listId: string, index: number): string {
  return `${listId}-${index}`;
}

/** The list itself: a row per skill offered, the highlighted one washed, or the line saying why there is none. */
function SkillMenu({
  id,
  rows,
  at,
  read,
  place,
  onHover,
  onChoose,
}: {
  id: string;
  rows: readonly SkillOption[];
  at: number;
  read: SkillsRead | undefined;
  /** Where the list stands in the box: its left edge, and how far its foot stands above the box's foot. */
  place: { readonly left: number; readonly bottom: number };
  onHover: (index: number) => void;
  onChoose: (skill: SkillOption) => void;
}): React.JSX.Element {
  return (
    <div className="plan-compose-menu skill-menu" style={place}>
      {/* Note that a press on a row keeps the caret in the box, where the keys are read. */}
      <div
        id={id}
        className="plan-compose-menu-list"
        role="listbox"
        aria-label={SKILL_MENU_LABEL}
        onMouseDown={(event) => event.preventDefault()}
      >
        {rows.map((skill, index) => (
          <button
            key={skill.name}
            id={optionId(id, index)}
            type="button"
            role="option"
            tabIndex={-1}
            className="plan-compose-menu-row"
            aria-selected={index === at}
            onMouseMove={() => onHover(index)}
            onClick={() => onChoose(skill)}
          >
            <span className="plan-compose-menu-name">/{skill.name}</span>
            <span className="skill-menu-description">{skill.description}</span>
          </button>
        ))}
        {rows.length === 0 ? <MenuNote read={read} /> : null}
      </div>
    </div>
  );
}

export function useSkillPicker({
  field,
  draft,
  setDraft,
  source,
  maxLength,
}: {
  field: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: (text: string) => void;
  /** The longest message the box takes, which a chosen skill's name may not carry it past. */
  maxLength: number;
  /** Where the skills are read from; nothing where the box offers none. */
  source: SkillSource | undefined;
}): SkillPicker {
  const listId = useId();
  const [caret, setCaret] = useState<number | undefined>(undefined);
  const [read, setRead] = useState<
    { source: SkillSource; read: SkillsRead; start: number | undefined } | undefined
  >();
  const [highlight, setHighlight] = useState<Highlight | undefined>(undefined);
  const [closedAt, setClosedAt] = useState<number | undefined>(undefined);
  const [point, setPoint] = useState<FieldPoint | undefined>(undefined);
  const [scroll, setScroll] = useState(0);
  // Note that the caret an edit leaves is set once the words it goes with
  // are in the box, because the box takes its value only on the next render.
  const pendingCaret = useRef<number | undefined>(undefined);

  const skills = source !== undefined && read?.source === source ? read.read : undefined;
  const mention = source === undefined || caret === undefined ? undefined : mentionAt(draft, caret);
  const open = mention !== undefined && closedAt !== mention.start;
  const rows = open ? offered(skills, mention) : [];
  const held =
    highlight !== undefined &&
    mention !== undefined &&
    highlight.start === mention.start &&
    highlight.query === mention.query
      ? highlight.at
      : 0;
  const at = Math.min(held, Math.max(rows.length - 1, 0));
  const names = new Set(
    skills !== undefined && "skills" in skills ? skills.skills.map((each) => each.name) : [],
  );
  // Note that a message already naming a skill reads them too, so its chips are drawn.
  const wantsSkills = source !== undefined && skills === undefined && holdsSlashWord(draft);

  // A word closed with Escape stays closed only while the caret is in it.
  const inWord = mention !== undefined;
  useEffect(() => {
    if (!inWord) setClosedAt(undefined);
  }, [inWord]);

  // The skills are read the first time a `/` word is typed and kept; a read
  // that failed is asked again as the next `/` word opens the list.
  const start = open ? mention.start : undefined;
  // Note that a failed read waits for a `/` word other than the one it was
  // read for to open the list, never for the list to close or the caret to move.
  const settled =
    read !== undefined &&
    read.source === source &&
    ("skills" in read.read || start === undefined || read.start === start);
  useEffect(() => {
    if (source === undefined || (!open && !wantsSkills) || settled) return;
    let live = true;
    source().then((answer) => {
      if (live) setRead({ source, read: answer, start });
    });
    return () => {
      live = false;
    };
  }, [source, open, wantsSkills, settled, start]);

  useLayoutEffect(() => {
    if (pendingCaret.current === undefined || field.current === null) return;
    field.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
    setCaret(pendingCaret.current);
    pendingCaret.current = undefined;
  }, [draft, field]);

  // The list is measured to its word's slash as the word opens it, and again
  // as the box scrolls or its words rewrap under it.
  const measure = () => {
    if (start !== undefined && field.current !== null) setPoint(caretPoint(field.current, start));
  };
  // Note that the words are a dependency, because an edit before the slash rewraps the line it stands on.
  useLayoutEffect(measure, [start, draft, field]);

  const edit = (text: string, nextCaret: number) => {
    pendingCaret.current = nextCaret;
    setDraft(text);
  };
  const choose = (skill: SkillOption) => {
    if (mention === undefined) return;
    const written = chooseSkill(draft, mention, skill.name);
    // A name the message has no room left for is not written, as a key typed past the bound is not.
    if (written.text.length > maxLength) return;
    edit(written.text, written.caret);
  };
  const onCaret = () => {
    const now = field.current;
    if (now === null) return;
    setCaret(now.selectionStart === now.selectionEnd ? now.selectionStart : undefined);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const box = event.currentTarget;
    if (event.key === "Backspace" && box.selectionStart === box.selectionEnd) {
      const without = withoutTokenBefore(draft, box.selectionStart, names);
      if (without === undefined) return false;
      event.preventDefault();
      edit(without.text, without.caret);
      return true;
    }
    if (!open) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setClosedAt(mention.start);
      return true;
    }
    const row = rows[at];
    if (row === undefined) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : rows.length - 1;
      setHighlight({ start: mention.start, query: mention.query, at: (at + step) % rows.length });
      return true;
    }
    if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
      event.preventDefault();
      choose(row);
      return true;
    }
    return false;
  };

  const room = field.current?.parentElement;
  const menu =
    !open || point === undefined ? null : (
      <SkillMenu
        id={listId}
        rows={rows}
        at={at}
        read={skills}
        place={{
          left: Math.max(0, Math.min(point.left, (room?.clientWidth ?? 0) - MENU_WIDTH)),
          bottom: (room?.clientHeight ?? 0) - point.top + MENU_GAP,
        }}
        onHover={(index) => setHighlight({ start: mention.start, query: mention.query, at: index })}
        onChoose={choose}
      />
    );

  const tokens = skillTokens(draft, names);
  const chips = (
    <div className="skill-chips ph-no-capture" aria-hidden="true">
      <div style={{ transform: `translateY(${-scroll}px)` }}>
        {tokens.length === 0 ? null : chipped(draft, tokens)}
      </div>
    </div>
  );

  return {
    menu,
    chips,
    fieldProps: {
      "aria-autocomplete": "list",
      "aria-expanded": menu !== null,
      "aria-controls": menu === null ? undefined : listId,
      "aria-activedescendant":
        menu === null || rows.length === 0 ? undefined : optionId(listId, at),
    },
    onKeyDown,
    onCaret,
    onBlur: () => setCaret(undefined),
    onScroll: () => {
      setScroll(field.current?.scrollTop ?? 0);
      measure();
    },
  };
}
