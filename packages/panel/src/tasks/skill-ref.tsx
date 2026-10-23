import {
  type ComboboxOption,
  HOVER_CARD_ROW_LOOK,
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  HoverCardRow,
  INLINE_REF_LOOK,
  InlineRef,
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
 * the card, and a coding agent's "Loaded skill" row. Wherever a list draws
 * one it leads with the same book (`SkillMark`), as Settings › Skills does
 * and the Add skill dialog, and hangs this card. Each place that can
 * open the skill's file hangs the one card while the pointer rests on the
 * name, drawn from every card's parts (`@luke/ui`'s `HoverCard`) and a task card's
 * rows (`task-card.tsx`): the skill's mark and name at its head, with where
 * it comes from at the head's right (`skill-source-badge.tsx`), what it is
 * for under it, and, for one of the repository's, its file's line, named
 * from the repository's root, which says and does not open, since every
 * place hanging the card opens that file itself. A press on the name, or
 * Enter once it has the focus, opens it; an installed skill has no file
 * of the repository's to open, so its name hangs the card alone. A name inside a message is the chip the composer drew it as
 * (`SkillRef`); a transcript's row that loaded the skill is a call's row,
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

/** A skill named in place: its `/name` as a mention's pill, one button that hangs its card and opens its file. */
export function SkillRef({ subject }: { subject: SkillSubject }): React.JSX.Element {
  return (
    <InlineRef
      look={INLINE_REF_LOOK.PILL}
      label={skillWord(subject.skill.name)}
      onPress={() => subject.onOpen()}
      hintLabel={subject.skill.path}
      card={<SkillCard subject={subject} />}
      data-skill-ref=""
    />
  );
}
