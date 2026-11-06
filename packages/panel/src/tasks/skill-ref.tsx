import { TASK_SKILL_SOURCE, type TaskSkillSource } from "@repo/features/task-wire";
import { THING_KIND, THING_WORD } from "@repo/features/thing-kind";
import {
  type ComboboxOption,
  HOVER_CARD_ROW_LOOK,
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  HoverCardRow,
  HoverCardSkeleton,
  INLINE_REF_LOOK,
  InlineRef,
} from "@repo/ui";
import { type SkillOption, skillWord } from "@repo/ui/skill-mention";
import { BookOpenIcon } from "lucide-react";
import { FileTypeIcon } from "./file-type-icon.js";
import { SkillSourceBadge } from "./skill-source-badge.js";

export function SkillMark(): React.JSX.Element {
  return <BookOpenIcon aria-hidden="true" />;
}

export type SkillWithFile = SkillOption & { readonly path: string };

export function opensFile(skill: SkillOption): skill is SkillWithFile {
  return skill.path !== undefined;
}

export interface SkillSubject {
  readonly skill: SkillOption;
  readonly onOpen: () => void;
}

const SKILL_SOURCE_SUB = {
  [TASK_SKILL_SOURCE.REPOSITORY]: "Repository skill",
  [TASK_SKILL_SOURCE.WORKSPACE]: "Workspace skill",
  [TASK_SKILL_SOURCE.PERSONAL]: "Your skill",
} as const satisfies Record<TaskSkillSource, string>;

export function SkillCard({ subject }: { subject: SkillSubject }): React.JSX.Element {
  const { skill } = subject;
  return (
    <HoverCard data-skill-card="">
      <HoverCardHead
        glyph={<SkillMark />}
        name={skillWord(skill.name)}
        sub={SKILL_SOURCE_SUB[skill.source]}
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

export function SkillRef({
  name,
  skill,
  onOpen,
}: {
  name: string;
  skill: SkillOption | undefined;
  onOpen: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <InlineRef
      look={INLINE_REF_LOOK.PILL}
      glyph={<SkillMark />}
      kind={THING_WORD[THING_KIND.SKILL]}
      label={skillWord(name)}
      onPress={onOpen === undefined ? undefined : () => onOpen()}
      hintLabel={skill?.path}
      card={
        skill === undefined ? (
          <HoverCardSkeleton glyph={<SkillMark />} name={skillWord(name)} data-skill-card="" />
        ) : (
          <SkillCard subject={{ skill, onOpen: () => onOpen?.() }} />
        )
      }
      data-skill-ref=""
    />
  );
}
