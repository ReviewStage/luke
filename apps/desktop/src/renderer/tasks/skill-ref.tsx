import {
  HOVER_CARD_ROW_LOOK,
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  HoverCardRow,
  INLINE_REF_LOOK,
} from "@luke/ui";
import { type SkillOption, skillWord } from "@luke/ui/skill-mention";
import { BookOpenIcon } from "lucide-react";
import { InlineRef } from "../inline-ref";
import { FileTypeIcon } from "./file-type-icon";

/**
 * skill-ref.tsx -- a skill named anywhere in the window: the card it hangs, and its `/name` as the one button that hangs that card and opens its `SKILL.md`.
 *
 * A skill is named as the words that load it, `/name`, wherever it is
 * drawn: a sent message's chip, the composer's chip, the composer's list,
 * the card, and a coding agent's "Loaded skill" row. Each place that can
 * open the skill's file hangs the one card while the pointer rests on the
 * name, drawn from every card's parts (`@luke/ui`'s `HoverCard`) and a task card's
 * rows (`task-card.tsx`): the skill's mark and name at its head, what it is
 * for under it, and its file's line, named from the repository's root,
 * which says and does not open, since every place hanging the card opens
 * that file itself. A press on the name, or Enter once it has the focus,
 * opens it. A name inside a message is the chip the composer drew it as
 * (`SkillRef`); a transcript's row that loaded the skill is a call's row,
 * which hangs the same card (`agent-tab.tsx`), as a row that opens an
 * agent's tab hangs that tab's card.
 */

/** A skill a place can open: the skill as the task's repository holds it, and what opens its `SKILL.md`. */
export interface SkillSubject {
  readonly skill: SkillOption;
  readonly onOpen: () => void;
}

/** The skill's card: its mark and name, what it is for, and its file's line. */
export function SkillCard({ subject }: { subject: SkillSubject }): React.JSX.Element {
  const { skill } = subject;
  return (
    <HoverCard data-skill-card="">
      <HoverCardHead glyph={<BookOpenIcon aria-hidden="true" />} name={skillWord(skill.name)} />
      {skill.description === "" ? null : <HoverCardNote>{skill.description}</HoverCardNote>}
      <HoverCardRow
        look={HOVER_CARD_ROW_LOOK.DETAIL}
        glyph={<FileTypeIcon name={skill.path} />}
        label={skill.path}
      />
    </HoverCard>
  );
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
