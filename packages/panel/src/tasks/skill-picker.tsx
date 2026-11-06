import { noMatchWords, TERM } from "@repo/features/words";
import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import { SHORTCUT_KEY } from "@repo/settings/shortcuts";
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
} from "@repo/ui";
import { holdsSlashWord, matchingSkills, type SkillOption } from "@repo/ui/skill-mention";
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
} from "../description-editor/contract.js";
import { MENTION_MENU_SIDE, type MentionMenuSide, wordBox } from "./mention-picker.js";
import { opensFile, SkillRef, type SkillWithFile, skillOption } from "./skill-ref.js";

export type SkillsRead = { readonly skills: readonly SkillOption[] } | { readonly unread: string };

export type SkillSource = () => Promise<SkillsRead>;

const SKILL_MENU_NOTE = {
  READING: "Reading skills…",
  NONE: "No skills yet",
  noneHint: (page: ReactNode) => (
    <>
      Install one in {page} settings, or add one at {".agents/skills/<name>/SKILL.md"}
    </>
  ),
  NO_MATCH: noMatchWords(TERM.SKILL),
} as const;

const SKILL_MENU_LABEL = "Skills";

const SKILL_MENU_KEYS: readonly MenuKey[] = [
  menuKey("Move", SHORTCUT_KEY.UP, SHORTCUT_KEY.DOWN),
  menuKey("Insert", SHORTCUT_KEY.ENTER, SHORTCUT_KEY.TAB),
  menuKey("Close", SHORTCUT_KEY.ESCAPE),
];

const NO_NAMES: ReadonlySet<string> = new Set();

interface Highlight {
  readonly start: number;
  readonly query: string;
  readonly at: number;
}

export interface SkillPicker {
  readonly menu: ReactNode;
  readonly aria: Readonly<Record<string, string | undefined>>;
  readonly names: ReadonlySet<string>;
  readonly onTrigger: (trigger: ComposerTrigger | undefined) => void;
  readonly onKey: (event: KeyboardEvent) => boolean;
  readonly chip: (chip: ComposerChip) => ReactNode;
  readonly known: readonly SkillOption[] | undefined;
  readonly unread: boolean;
  readonly ask: () => void;
}

function offered(read: SkillsRead | undefined, trigger: ComposerTrigger | undefined) {
  if (read === undefined || "unread" in read || trigger === undefined) return [];
  return matchingSkills(read.skills, trigger.query);
}

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

function BoxChip({
  name,
  skill,
  onOpen,
}: {
  name: string;
  skill: SkillOption | undefined;
  onOpen: ((skill: SkillWithFile) => void) | undefined;
}): React.JSX.Element {
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
  editor: RefObject<ComposerEditorHandle | undefined>;
  room: RefObject<HTMLElement | null>;
  draft: string;
  source: SkillSource | undefined;
  onOpen: ((skill: SkillWithFile) => void) | undefined;
  side?: MentionMenuSide;
}): SkillPicker {
  const listId = useId();
  const [trigger, setTrigger] = useState<ComposerTrigger | undefined>(undefined);
  const [read, setRead] = useState<
    { source: SkillSource; read: SkillsRead; start: number | undefined; asked: number } | undefined
  >();
  const [highlight, setHighlight] = useState<Highlight | undefined>(undefined);
  const [closedAt, setClosedAt] = useState<number | undefined>(undefined);
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
  const wantsSkills = source !== undefined && (asked > 0 || holdsSlashWord(draft));

  const inWord = mention !== undefined;
  useEffect(() => {
    if (inWord) return;
    setClosedAt(undefined);
    setRead((was) => (was?.start === undefined ? was : { ...was, start: undefined }));
  }, [inWord]);

  const start = open ? mention.start : undefined;
  const settled =
    read !== undefined &&
    read.source === source &&
    (start !== undefined ? read.start === start : "skills" in read.read || read.asked === asked);
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
