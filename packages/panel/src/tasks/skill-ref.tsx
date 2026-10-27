import {
  type ComboboxOption,
  HOVER_CARD_ROW_LOOK,
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  HoverCardRow,
  INLINE_REF_LOOK,
  InlineRef,
  Skeleton,
  SkeletonRegion,
} from "@luke/ui";
import { type SkillOption, skillWord } from "@luke/ui/skill-mention";
import { BookOpenIcon } from "lucide-react";
import { FileTypeIcon } from "./file-type-icon.js";
import { SkillSourceBadge } from "./skill-source-badge.js";

/**
 * skill-ref.tsx -- a skill named anywhere in the window: the card it hangs, and its `/name` as the one button that hangs that card and opens its `SKILL.md`.
 *
 * A skill is named as the words that load it, `/name`, wherever it is
 * drawn: a sent message's chip, the composer's chip, the composer's list,
 * the card, and a coding agent's "Loaded skill" row. Wherever a list or a
 * chip draws one it leads with the same book (`SkillMark`), as Settings ›
 * Skills does and the Add skill dialog, and hangs this card. The chip is one
 * pill (`SkillRef`) in a sent message and in the composer's box alike, and
 * its card is the one a skill's row hangs, read as the skills land. Each place that can
 * open the skill's file hangs the one card while the pointer rests on the
 * name, drawn from every card's parts (`@luke/ui`'s `HoverCard`) and a task card's
 * rows (`task-card.tsx`): the skill's mark and name at its head, with where
 * it comes from at the head's right (`skill-source-badge.tsx`), what it is
 * for under it, and, for one of the repository's, its file's line, named
 * from the repository's root, which says and does not open, since every
 * place hanging the card opens that file itself. A press on the name, or
 * Enter once it has the focus, opens it; an installed skill has no file
 * of the repository's to open, so its name hangs the card alone. A name
 * inside a message is the chip the composer drew it as (`SkillRef`); a transcript's row that loaded the skill is a call's row,
 * which hangs the same card (`agent-tab.tsx`), as a row that opens an
 * agent's tab hangs that tab's card.
 */

/** The book every skill leads with, in a menu's row, a settings row, and its card's head. */
export function SkillMark(): React.JSX.Element {
  return <BookOpenIcon aria-hidden="true" />;
}

/** A skill of the repository's, which names its `SKILL.md`. */
export type SkillWithFile = SkillOption & { readonly path: string };

/** Whether the skill names a file of the repository's to open, as an installed one does not. */
export function opensFile(skill: SkillOption): skill is SkillWithFile {
  return skill.path !== undefined;
}

/** A skill a place can name: the skill as it is offered, and what opens its `SKILL.md`, which does nothing for an installed skill. */
export interface SkillSubject {
  readonly skill: SkillOption;
  readonly onOpen: () => void;
}

/** What a card says while the skill it hangs for is still being read. */
const SKILL_READING = "Reading skill…";

/** How much of its line the card's description stands in for while it is read. */
const SKILL_CARD_NOTE_WIDTH = "80%";

/** The skill's card: its mark, name, and source, what it is for, and its file's line where it has one. */
export function SkillCard({ subject }: { subject: SkillSubject }): React.JSX.Element {
  const { skill } = subject;
  return (
    <HoverCard data-skill-card="">
      <HoverCardHead
        glyph={<SkillMark />}
        name={skillWord(skill.name)}
        corner={<SkillSourceBadge source={skill.source} />}
      />
      {skill.description === "" ? null : <HoverCardNote>{skill.description}</HoverCardNote>}
      {skill.path === undefined ? null : (
        <HoverCardRow
          look={HOVER_CARD_ROW_LOOK.DETAIL}
          glyph={<FileTypeIcon name={skill.path} />}
          label={skill.path}
        />
      )}
    </HoverCard>
  );
}

/**
 * A skill as a menu draws its row: the book, its `/name`, what it is for as
 * the detail, where it comes from at the end, and the card the chip hangs
 * beside it. Note that a row opens nothing from its card, since a press on
 * the row is the menu's own choice.
 */
export function skillOption(skill: SkillOption): ComboboxOption {
  return {
    id: skill.name,
    label: skillWord(skill.name),
    icon: <SkillMark />,
    detail: skill.description,
    hint: <SkillSourceBadge source={skill.source} />,
    card: <SkillCard subject={{ skill, onOpen: () => undefined }} />,
  };
}

/** The skill's card while its skill is read: its mark and name, which the chip knows, and the line of what it is for as a placeholder. */
function SkillCardSkeleton({ name }: { name: string }): React.JSX.Element {
  return (
    <HoverCard data-skill-card="">
      <HoverCardHead glyph={<SkillMark />} name={skillWord(name)} />
      <SkeletonRegion label={SKILL_READING}>
        <Skeleton width={SKILL_CARD_NOTE_WIDTH} />
      </SkeletonRegion>
    </HoverCard>
  );
}

/**
 * A skill named in place: the book and its `/name` as a mention's pill, which
 * hangs its card and, handed `onOpen`, is one button that opens its file. Note
 * that a skill not yet read (`skill` none) still stands as its name and hangs
 * the card's placeholder, which the read fills in.
 */
export function SkillRef({
  name,
  skill,
  onOpen,
}: {
  name: string;
  skill: SkillOption | undefined;
  /** Opens the skill's file; none where the place cannot, so the pill is words that hang the card. */
  onOpen: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <InlineRef
      look={INLINE_REF_LOOK.PILL}
      glyph={<SkillMark />}
      label={skillWord(name)}
      onPress={onOpen === undefined ? undefined : () => onOpen()}
      hintLabel={skill?.path}
      card={
        skill === undefined ? (
          <SkillCardSkeleton name={name} />
        ) : (
          <SkillCard subject={{ skill, onOpen: () => onOpen?.() }} />
        )
      }
      data-skill-ref=""
    />
  );
}
