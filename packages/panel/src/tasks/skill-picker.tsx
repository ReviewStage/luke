import { noMatchWords, TERM } from "@luke/features/words";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { SHORTCUT_KEY } from "@luke/settings/shortcuts";
import {
  ALIGN,
  ComboboxList,
  comboboxOptionId,
  GAP,
  MENU_SURFACE_INSET,
  type MenuKey,
  MenuKeys,
  MenuSurface,
  menuKey,
  POPOVER_WIDTH,
  RectFloat,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { holdsSlashWord, matchingSkills, type SkillOption } from "@luke/ui/skill-mention";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { SettingsPageLink } from "../open-settings.js";
import type {
  ComposerChip,
  ComposerEditorHandle,
  ComposerTrigger,
} from "../plan-editor/contract.js";
import { MENTION_MENU_SIDE, type MentionMenuSide, wordBox } from "./mention-picker.js";
import { opensFile, SkillRef, type SkillWithFile, skillOption } from "./skill-ref.js";

/**
 * skill-picker.tsx -- the list a `/` in the composer opens, of the skills the task's repository keeps, and the chips the chosen ones are drawn as.
 *
 * The list opens the way an @-mention list does in every chat: at the
 * caret, as soon as a `/` starts a word (`skill-mention.ts`), with one row
 * per skill (`skillOption`): the book, its name, a muted line of what it is
 * for, and where it comes from, with the skill's card beside it, narrowed as
 * the name is typed. ↑ and ↓ move the highlight, Enter or Tab writes the
 * highlighted skill into the message as its chip, and Escape closes the
 * list until the caret leaves that word; the caret stays in the box
 * throughout, so the keys the list does not take are the box's own. The
 * skills are read the first time a `/` is typed in the box, from the
 * task's repository as the service finds them, then the member's
 * installed ones, and kept for the task (`repository-skills.ts`), so
 * nothing is read for a message that names none. Where there are none it
 * says so, and where one is installed or added.
 *
 * The box is an editor (`../plan-editor/composer-editor.ts`), which finds
 * the `/` word the caret ends and says where its slash stands in the
 * window, so the list hangs over that line (`@luke/ui`'s `RectFloat`), as
 * the box stands at the foot of its tab, and closes on a press outside it
 * and the box as on Escape. A chosen skill is a chip in the
 * words, an atom one Backspace takes out whole, which reads out as `/name`,
 * so the message sent is the words it always was; the editor draws each
 * through the box (`chip`), as the one pill a sent message's chip is (`skill-ref.tsx`), a press on which opens the skill's
 * `SKILL.md` in a File tab (`skill-chip.tsx`).
 */

/** The skills the composer offers, the repository's and the installed ones, as it reads them: the skills, or why they were not read. */
export type SkillsRead = { readonly skills: readonly SkillOption[] } | { readonly unread: string };

/** Reads the task's repository's skills; asked the first time a `/` is typed. */
export type SkillSource = () => Promise<SkillsRead>;

/** What the list says where it has no row to offer. */
const SKILL_MENU_NOTE = {
  READING: "Reading skills…",
  NONE: "No skills yet",
  /** Where a skill comes from, naming the page one is installed on by its link. */
  noneHint: (page: ReactNode) => (
    <>
      Install one in {page} settings, or add one at {".agents/skills/<name>/SKILL.md"}
    </>
  ),
  NO_MATCH: noMatchWords(TERM.SKILL),
} as const;

/** The list's own name, which its listbox is read by. */
const SKILL_MENU_LABEL = "Skills";

/** The keys the list hears, said at its foot. */
const SKILL_MENU_KEYS: readonly MenuKey[] = [
  menuKey("Move", SHORTCUT_KEY.UP, SHORTCUT_KEY.DOWN),
  menuKey("Insert", SHORTCUT_KEY.ENTER, SHORTCUT_KEY.TAB),
  menuKey("Close", SHORTCUT_KEY.ESCAPE),
];

/** No skill is known, before the read lands or where it did not. */
const NO_NAMES: ReadonlySet<string> = new Set();

/** The highlight as it was moved, held against the word it was moved in, so a word typed on starts it again at the first row. */
interface Highlight {
  readonly start: number;
  readonly query: string;
  readonly at: number;
}

/** What the composer draws and wires: the list while it is open, the chips, and what the editor hears and is told. */
export interface SkillPicker {
  /** The list, while a `/` word is being typed and not closed; nothing otherwise. */
  readonly menu: ReactNode;
  /** The editor's attributes that tie it to the list, for assistive technology. */
  readonly aria: Readonly<Record<string, string | undefined>>;
  /** The skills a `/name` names, which the editor draws as chips. */
  readonly names: ReadonlySet<string>;
  /** Hears the `/` word the caret ends, as the editor reports it. */
  readonly onTrigger: (trigger: ComposerTrigger | undefined) => void;
  /** Takes a key the list answers, and says whether it did. */
  readonly onKey: (event: KeyboardEvent) => boolean;
  /** A chip the editor draws, as the box draws it. */
  readonly chip: (chip: ComposerChip) => ReactNode;
  /** The repository's skills as read; nothing before they are, or where they could not be. */
  readonly known: readonly SkillOption[] | undefined;
  /** Whether the read of the skills came back unread, which an `@` list says could not be read; asking again reads them again. */
  readonly unread: boolean;
  /** Asks for the skills to be read, as an `@` list offering them does once it opens. */
  readonly ask: () => void;
}

/** The rows the list offers for the word under the caret; none while the skills are not read, or could not be. */
function offered(read: SkillsRead | undefined, trigger: ComposerTrigger | undefined) {
  if (read === undefined || "unread" in read || trigger === undefined) return [];
  return matchingSkills(read.skills, trigger.query);
}

/** What the list says where it offers no row. */
function MenuNote({ read }: { read: SkillsRead | undefined }): React.ReactNode {
  if (read === undefined) return SKILL_MENU_NOTE.READING;
  if ("unread" in read) return read.unread;
  if (read.skills.length > 0) return SKILL_MENU_NOTE.NO_MATCH;
  return (
    <Stack gap={GAP.TIGHT} align={ALIGN.CENTER}>
      <Text as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED}>
        {SKILL_MENU_NOTE.NONE}
      </Text>
      <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        {SKILL_MENU_NOTE.noneHint(<SettingsPageLink page={SETTINGS_VIEW.SKILLS} />)}
      </Text>
    </Stack>
  );
}

/** The list itself: a row per skill offered, the highlighted one washed, or the line saying why there is none. */
function SkillMenu({
  id,
  rows,
  at,
  read,
  onHover,
  onChoose,
}: {
  id: string;
  rows: readonly SkillOption[];
  at: number;
  read: SkillsRead | undefined;
  onHover: (index: number) => void;
  onChoose: (skill: SkillOption) => void;
}): React.JSX.Element {
  const options = rows.map(skillOption);
  return (
    <MenuSurface className="skill-menu" inset={MENU_SURFACE_INSET.NONE}>
      <ComboboxList
        id={id}
        label={SKILL_MENU_LABEL}
        groups={[{ options }]}
        active={at}
        onActiveChange={onHover}
        onChoose={(index) => {
          const skill = rows[index];
          if (skill !== undefined) onChoose(skill);
        }}
        note={rows.length === 0 ? <MenuNote read={read} /> : undefined}
      />
      <MenuKeys keys={SKILL_MENU_KEYS} />
    </MenuSurface>
  );
}

/**
 * A chosen skill in the box: the one chip a sent message draws (`SkillRef`),
 * which a press opens the skill's `SKILL.md` from where the box stands on a
 * task's page. Note that it hangs the placeholder card until the skill is read.
 */
function BoxChip({
  name,
  skill,
  onOpen,
}: {
  name: string;
  skill: SkillOption | undefined;
  onOpen: ((skill: SkillWithFile) => void) | undefined;
}): React.JSX.Element {
  // Note that an installed skill names no file of the repository's, so its chip opens nothing.
  const file = skill !== undefined && opensFile(skill) ? skill : undefined;
  return (
    <SkillRef
      name={name}
      skill={skill}
      onOpen={file === undefined || onOpen === undefined ? undefined : () => onOpen(file)}
    />
  );
}

export function useSkillPicker({
  editor,
  room,
  draft,
  source,
  onOpen,
  side = MENTION_MENU_SIDE.ABOVE,
}: {
  /** The box's editor, which a chosen skill is written into; nothing until it has mounted. */
  editor: RefObject<ComposerEditorHandle | undefined>;
  /** The box's field, a press in which is the box's own rather than one away from the list. */
  room: RefObject<HTMLElement | null>;
  /** The box's words, which say whether a skill is named already, so its chip wants the skills read. */
  draft: string;
  /** Where the skills are read from; nothing where the box offers none. */
  source: SkillSource | undefined;
  /** Opens a chosen skill's `SKILL.md`; nothing where the box stands on no task's page. */
  onOpen: ((skill: SkillWithFile) => void) | undefined;
  /** Which side of the slash's line the list stands: over it, as at the foot of an agent's tab, or under it, as on a new account's welcome. */
  side?: MentionMenuSide;
}): SkillPicker {
  const listId = useId();
  const [trigger, setTrigger] = useState<ComposerTrigger | undefined>(undefined);
  const [read, setRead] = useState<
    { source: SkillSource; read: SkillsRead; start: number | undefined; asked: number } | undefined
  >();
  const [highlight, setHighlight] = useState<Highlight | undefined>(undefined);
  const [closedAt, setClosedAt] = useState<number | undefined>(undefined);
  // Each opening of an `@` list that asks for the skills, counted, so a read that failed is asked again by the next.
  const [asked, setAsked] = useState(0);
  const ask = useCallback(() => setAsked((count) => count + 1), []);

  const skills = source !== undefined && read?.source === source ? read.read : undefined;
  const mention = source === undefined ? undefined : trigger;
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
  const known = skills !== undefined && "skills" in skills ? skills.skills : undefined;
  const unread = skills !== undefined && "unread" in skills;
  const names = useMemo(
    () => (known === undefined ? NO_NAMES : new Set(known.map((each) => each.name))),
    [known],
  );
  // Note that a message already naming a skill reads them too, so its chips are drawn.
  const wantsSkills = source !== undefined && (asked > 0 || holdsSlashWord(draft));

  // A word closed with Escape stays closed only while the caret is in it.
  const inWord = mention !== undefined;
  useEffect(() => {
    if (!inWord) setClosedAt(undefined);
  }, [inWord]);

  // The skills are read the first time a `/` word is typed and kept; a read
  // that failed is asked again as the next `/` word opens the list.
  const start = open ? mention.start : undefined;
  // Note that a failed read waits for a `/` word other than the one it was
  // read for to open the list, or another opening of an `@` list, never for
  // a list to close or the caret to move.
  const settled =
    read !== undefined &&
    read.source === source &&
    ("skills" in read.read || (start === undefined ? read.asked === asked : read.start === start));
  useEffect(() => {
    if (source === undefined || (!open && !wantsSkills) || settled) return;
    let live = true;
    source().then((answer) => {
      if (live) setRead({ source, read: answer, start, asked });
    });
    return () => {
      live = false;
    };
  }, [source, open, wantsSkills, settled, start, asked]);

  // Note that a name the message has no room left for is not written, as a key typed past the bound is not.
  const choose = (skill: SkillOption) => editor.current?.chooseSkill(skill.name);

  const onKey = (event: KeyboardEvent): boolean => {
    if (!open) return false;
    if (event.key === "Escape") {
      event.stopPropagation();
      setClosedAt(mention.start);
      return true;
    }
    const row = rows[at];
    if (row === undefined) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const step = event.key === "ArrowDown" ? 1 : rows.length - 1;
      setHighlight({ start: mention.start, query: mention.query, at: (at + step) % rows.length });
      return true;
    }
    if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
      choose(row);
      return true;
    }
    return false;
  };

  // The list hangs by the slash's line, on the side asked; a press outside it and the box closes it as Escape does, and it fades as it closes.
  const menu = (
    <RectFloat
      open={open}
      anchor={() => (mention === undefined ? undefined : wordBox(mention))}
      side={side}
      width={POPOVER_WIDTH.REGULAR}
      onPressAway={() => {
        if (mention !== undefined) setClosedAt(mention.start);
      }}
      holds={(target) => room.current?.contains(target) === true}
    >
      {!open ? null : (
        <SkillMenu
          id={listId}
          rows={rows}
          at={at}
          read={skills}
          onHover={(index) =>
            setHighlight({ start: mention.start, query: mention.query, at: index })
          }
          onChoose={choose}
        />
      )}
    </RectFloat>
  );

  return {
    menu,
    aria: {
      "aria-autocomplete": "list",
      "aria-expanded": String(open),
      "aria-controls": open ? listId : undefined,
      "aria-activedescendant":
        !open || rows.length === 0 ? undefined : comboboxOptionId(listId, at),
    },
    names,
    onTrigger: setTrigger,
    onKey,
    known,
    unread,
    ask,
    chip: ({ name }) => (
      <BoxChip name={name} skill={known?.find((each) => each.name === name)} onOpen={onOpen} />
    ),
  };
}
