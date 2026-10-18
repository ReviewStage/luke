import { INTEGRATION_STATUS } from "@luke/features/integration-wire";
import { namedServers } from "@luke/ui/agent-servers-model";
import type { ReactNode, RefObject } from "react";
import type { IntegrationStatuses } from "../integration-statuses";
import type { ComposerChip, ComposerEditorHandle, ComposerTrigger } from "../plan-editor/contract";
import type { ComposerFieldMentions } from "./composer-field";
import { MentionNodeChip, pastedMentionNode } from "./mention-chip";
import { MENTION_MENU_SIDE, useMentionPicker } from "./mention-picker";
import { MentionedServers, type MentionedServersPlace } from "./server-card";
import { useSkillOpener } from "./skill-chip";
import { type SkillSource, useSkillPicker } from "./skill-picker";
import { useTaskMentions } from "./task-mentions";
import { DICTATION_PHASE, type DictationControl, useDictation } from "./use-dictation";
import { useKnownNames } from "./use-known-names";

/**
 * composer-pickers.tsx -- what a box written to an agent offers inside its field, alike in the agent's message box and the Inbox's answer box: the `@` list of mentions, the `/` list of skills, dictation, and the keys that work them.
 *
 * Both boxes write words an agent reads as one of the developer's messages,
 * so both take the same things: an `@` at the start of a word, where the box
 * stands on a page that hands mentions (`task-mentions.tsx`), opens the list
 * of what the words may mention, written in as its link and drawn as its
 * chip (`mention-picker.tsx`, `mention-chip.tsx`), the repository's skills
 * and the account's connected servers among them; a `/` opens the
 * repository's skills, written in as a skill's chip (`skill-picker.tsx`);
 * and the microphone records words into the box at the caret
 * (`use-dictation.ts`). A list that stands answers the keys it takes first,
 * then dictation does, and Escape otherwise leaves the box. What a server's
 * chip says a send does with it is the box's to tell (`servers.place`).
 */

/** The field's props the pickers own, laid onto `ComposerField` as they are. */
interface PickedField {
  readonly skills: ReadonlySet<string>;
  readonly aria: Readonly<Record<string, string | undefined>>;
  readonly onKey: (event: KeyboardEvent) => boolean;
  readonly onTrigger: (trigger: ComposerTrigger | undefined) => void;
  readonly chip: (chip: ComposerChip) => ReactNode;
  readonly mentions: ComposerFieldMentions | undefined;
  readonly children: ReactNode;
}

/** What the box holds of its pickers: its dictation, whether one runs, and what its field takes. */
export interface ComposerPickers {
  readonly dictation: DictationControl;
  readonly dictating: boolean;
  readonly field: PickedField;
}

/** The pickers of a box written to an agent, as above. */
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
}: {
  /** The box's editor; nothing until it has mounted. */
  editor: RefObject<ComposerEditorHandle | undefined>;
  /** The box's field, which the lists stand inside. */
  room: RefObject<HTMLDivElement | null>;
  draft: string;
  placeholder: string;
  /** The agent the words go to, which the `@` list does not offer; none for a draft not yet started. */
  self: string | undefined;
  /** Where the repository's skills are read from; nothing where the box offers none. */
  skills: SkillSource | undefined;
  /** The words a dictation is likely to say (`dictation-keywords.ts`). */
  keywords: readonly string[];
  /** Where the account's servers stand, which the `@` list offers, and what a send does with one the words name. */
  servers: { readonly statuses: IntegrationStatuses; readonly place: MentionedServersPlace };
  /** Says why a dictation left nothing, or clears what the last one said. */
  onNote: (note: string | undefined) => void;
}): ComposerPickers {
  const dictation = useDictation({ editor, keywords, onNote });
  const openSkill = useSkillOpener();
  const skillPicker = useSkillPicker({ editor, room, draft, source: skills, onOpen: openSkill });
  // An `@` picks a mention of the page the box stands on, where it stands on one that hands them.
  const taskMentions = useTaskMentions();
  // A Luke address pasted whole is called by the name the window holds for what it names.
  const known = useKnownNames();
  const mentionPicker = useMentionPicker({
    source: taskMentions,
    self,
    // The repository's skills, a pick written as the `/name` chip the `/` list writes.
    skills:
      skills === undefined
        ? undefined
        : {
            known: skillPicker.known,
            ask: skillPicker.ask,
            onChoose: (name) => editor.current?.chooseSkillAtMention(name),
          },
    // The servers the account connected, each one a mention hands the agent's next turn.
    servers: namedServers({
      statusOf: servers.statuses.statusOf,
      accountsOf: servers.statuses.accountsOf,
      standing: (status) => status === INTEGRATION_STATUS.CONNECTED,
    }),
    room,
    side: MENTION_MENU_SIDE.ABOVE,
    onChoose: (mention) => editor.current?.chooseMention(mention),
  });

  const onKey = (event: KeyboardEvent): boolean => {
    if (dictation.onFieldKey(event) || skillPicker.onKey(event) || mentionPicker.onKey(event)) {
      return true;
    }
    if (event.key !== "Escape") return false;
    event.stopPropagation();
    editor.current?.blur();
    return true;
  };

  return {
    dictation,
    dictating: dictation.phase !== DICTATION_PHASE.IDLE,
    field: {
      skills: skillPicker.names,
      aria: { ...skillPicker.aria, "aria-placeholder": placeholder },
      onKey,
      onTrigger: skillPicker.onTrigger,
      chip: skillPicker.chip,
      mentions:
        taskMentions === undefined
          ? undefined
          : {
              onTrigger: mentionPicker.onTrigger,
              // A server's chip in the box says what a send now does with it.
              chip: (mention) => (
                <MentionedServers value={servers.place}>
                  <MentionNodeChip mention={mention} doors={taskMentions.doors} />
                </MentionedServers>
              ),
              pasted: (words) =>
                pastedMentionNode(words, taskMentions.doors.place, {
                  known,
                  planId: taskMentions.taskId,
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
