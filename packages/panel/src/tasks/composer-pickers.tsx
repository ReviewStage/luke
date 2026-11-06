import { INTEGRATION_STATUS } from "@repo/features/integration-wire";
import { namedServers } from "@repo/ui/agent-servers-model";
import type { ReactNode, RefObject } from "react";
import type { IntegrationStatuses } from "../integration-statuses.js";
import type {
  ComposerChip,
  ComposerEditorHandle,
  ComposerTrigger,
} from "../description-editor/contract.js";
import type { ComposerFieldMentions } from "./composer-field.js";
import { MentionNodeChip, pastedMentionNode } from "./mention-chip.js";
import { holderTaskId } from "./mention-holder.js";
import { MENTION_MENU_SIDE, type MentionMenuSide, useMentionPicker } from "./mention-picker.js";
import { MentionedServers, type MentionedServersPlace } from "./server-card.js";
import { useSkillOpener } from "./skill-chip.js";
import { type SkillSource, useSkillPicker } from "./skill-picker.js";
import { useTaskMentions } from "./task-mentions.js";
import { DICTATION_PHASE, type DictationControl, useDictation } from "./use-dictation.js";
import { useKnownNames } from "./use-known-names.js";
import { useNumberedTaskIdOf } from "./use-link-standing.js";

interface PickedField {
  readonly skills: ReadonlySet<string>;
  readonly aria: Readonly<Record<string, string | undefined>>;
  readonly onKey: (event: KeyboardEvent) => boolean;
  readonly onTrigger: (trigger: ComposerTrigger | undefined) => void;
  readonly chip: (chip: ComposerChip) => ReactNode;
  readonly mentions: ComposerFieldMentions | undefined;
  readonly children: ReactNode;
}

export interface ComposerPickers {
  readonly dictation: DictationControl;
  readonly dictating: boolean;
  readonly field: PickedField;
}

export function useComposerPickers({
  editor,
  room,
  draft,
  placeholder,
  self,
  skills,
  keywords,
  servers,
  onNote,
  onLeave,
  side = MENTION_MENU_SIDE.ABOVE,
}: {
  editor: RefObject<ComposerEditorHandle | undefined>;
  room: RefObject<HTMLDivElement | null>;
  draft: string;
  placeholder: string;
  self: string | undefined;
  skills: SkillSource | undefined;
  keywords: readonly string[];
  servers: { readonly statuses: IntegrationStatuses; readonly place: MentionedServersPlace };
  onNote: (note: string | undefined) => void;
  onLeave?: (() => void) | undefined;
  side?: MentionMenuSide;
}): ComposerPickers {
  const dictation = useDictation({ editor, keywords, onNote });
  const openSkill = useSkillOpener();
  const skillPicker = useSkillPicker({
    editor,
    room,
    draft,
    source: skills,
    onOpen: openSkill,
    side,
  });
  const taskMentions = useTaskMentions();
  const known = useKnownNames();
  const taskIdOf = useNumberedTaskIdOf();
  const mentionPicker = useMentionPicker({
    source: taskMentions,
    self,
    skills:
      skills === undefined
        ? undefined
        : {
            known: skillPicker.known,
            unread: skillPicker.unread,
            ask: skillPicker.ask,
            onChoose: (name) => editor.current?.chooseSkillAtMention(name),
          },
    servers: namedServers({
      statusOf: servers.statuses.statusOf,
      accountsOf: servers.statuses.accountsOf,
      standing: (status) => status === INTEGRATION_STATUS.CONNECTED,
    }),
    room,
    side,
    onChoose: (mention) => editor.current?.chooseMention(mention),
  });

  const onKey = (event: KeyboardEvent): boolean => {
    if (dictation.onFieldKey(event) || skillPicker.onKey(event) || mentionPicker.onKey(event)) {
      return true;
    }
    if (event.key !== "Escape") return false;
    event.stopPropagation();
    if (onLeave === undefined) editor.current?.blur();
    else onLeave();
    return true;
  };

  return {
    dictation,
    dictating: dictation.phase !== DICTATION_PHASE.IDLE,
    field: {
      skills: skillPicker.names,
      aria: {
        ...(mentionPicker.aria["aria-expanded"] === "true" ? mentionPicker.aria : skillPicker.aria),
        "aria-placeholder": placeholder,
      },
      onKey,
      onTrigger: skillPicker.onTrigger,
      chip: skillPicker.chip,
      mentions:
        taskMentions === undefined
          ? undefined
          : {
              onTrigger: mentionPicker.onTrigger,
              chip: (mention, node) => (
                <MentionedServers value={servers.place}>
                  <MentionNodeChip
                    mention={mention}
                    doors={taskMentions.doors}
                    edit={{ node, pickDate: mentionPicker.pickDate }}
                  />
                </MentionedServers>
              ),
              pasted: (words) =>
                taskMentions.doors.place === undefined
                  ? undefined
                  : pastedMentionNode(words, taskMentions.doors.place, {
                      known,
                      taskIdOf,
                      taskId: holderTaskId(taskMentions.holder),
                      text: taskMentions.text,
                    }),
            },
      children: (
        <>
          {skillPicker.menu}
          {mentionPicker.menu}
        </>
      ),
    },
  };
}
