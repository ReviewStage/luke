import { INTEGRATION_STATUS } from "@luke/features/integration-wire";
import type { MentionPlace } from "@luke/features/mention-link";
import { namedServers } from "@luke/ui/agent-servers-model";
import type { ReactNode, RefObject } from "react";
import type { IntegrationStatuses } from "../integration-statuses.js";
import type {
  ComposerChip,
  ComposerEditorHandle,
  ComposerTrigger,
} from "../plan-editor/contract.js";
import type { ChatComposerMentions } from "./chat-composer.js";
import type { ComposerFieldMentions } from "./composer-field.js";
import { type MentionDoors, MentionNodeChip, pastedMentionNode } from "./mention-chip.js";
import { MENTION_MENU_SIDE, type MentionMenuSide, useMentionPicker } from "./mention-picker.js";
import { MentionedServers, type MentionedServersPlace } from "./server-card.js";
import { useSkillOpener } from "./skill-chip.js";
import { type SkillSource, useSkillPicker } from "./skill-picker.js";
import { type TaskMentionsValue, useMentionDoors, useTaskMentions } from "./task-mentions.js";
import { DICTATION_PHASE, type DictationControl, useDictation } from "./use-dictation.js";
import { useKnownNames } from "./use-known-names.js";

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
 * then dictation does, and Escape otherwise leaves the box, or does what its
 * owner says instead (`onLeave`), as New task's closes its card. What a server's
 * chip says a send does with it is the box's to tell (`servers.place`).
 *
 * A box answering a chat message's ask is handed that channel's offer
 * instead (`chat`, `chat-mention-source.ts`), as the chat's own box is: its
 * `@` lists the members a mention there tells, then the channel's task, and
 * its `#` names the channels, with no server, since the words are a chat
 * answer rather than an agent's turn.
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

/** Where a box's mentions are written: the doors its chips open through, and the place, task, and plan text an address pasted whole is read against; no place where one pastes as its words. */
interface MentionsAt {
  readonly doors: MentionDoors;
  readonly place: MentionPlace | undefined;
  readonly taskId: string;
  readonly text: () => string;
}

/**
 * Where a box's mentions are written: the page's, where it hands them; the
 * chat channel's the box answers in, under the workspace that channel's
 * links are written in, an address pasting as its words before that is
 * known, as the chat's own box pastes it; none where the box takes no
 * mention.
 */
function mentionsAt(
  page: TaskMentionsValue | undefined,
  chat: ChatComposerMentions | undefined,
  windowDoors: MentionDoors,
): MentionsAt | undefined {
  if (chat === undefined) {
    if (page === undefined) return undefined;
    return { doors: page.doors, place: page.doors.place, taskId: page.taskId, text: page.text };
  }
  const doors = page?.doors ?? windowDoors;
  const { workspace, taskId, text } = chat.source;
  return {
    doors,
    place: workspace === "" ? undefined : { ...doors.place, workspace },
    taskId,
    text,
  };
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
  chat,
  onNote,
  onLeave,
  side = MENTION_MENU_SIDE.ABOVE,
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
  /** What a chat channel offers where the words answer an ask posted in it, in place of the page's mentions and the servers; none where they go to an agent. */
  chat?: ChatComposerMentions | undefined;
  /** Says why a dictation left nothing, or clears what the last one said. */
  onNote: (note: string | undefined) => void;
  /** What Escape does where no list or dictation takes it: New task's box closes its card; the box gives up the caret where none is given. */
  onLeave?: (() => void) | undefined;
  /** Which side of the caret's line the `@` and `/` lists stand: over it, as at a tab's foot, or under it, where the box stands at the top of its page. */
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
  // An `@` picks a mention of the page the box stands on, where it stands on one that hands them, or of the chat channel the box answers in.
  const taskMentions = useTaskMentions();
  const windowDoors = useMentionDoors();
  const at = mentionsAt(taskMentions, chat, windowDoors);
  // A Luke address pasted whole is called by the name the window holds for what it names.
  const known = useKnownNames();
  const mentionPicker = useMentionPicker({
    source: chat === undefined ? taskMentions : chat.source,
    self,
    // The repository's skills, a pick written as the `/name` chip the `/` list writes.
    skills:
      skills === undefined
        ? undefined
        : {
            known: skillPicker.known,
            unread: skillPicker.unread,
            ask: skillPicker.ask,
            onChoose: (name) => editor.current?.chooseSkillAtMention(name),
          },
    // The servers the account connected, each one a mention hands the agent's next turn; none in a chat answer, which opens no turn.
    servers:
      chat === undefined
        ? namedServers({
            statusOf: servers.statuses.statusOf,
            accountsOf: servers.statuses.accountsOf,
            standing: (status) => status === INTEGRATION_STATUS.CONNECTED,
          })
        : [],
    members: chat?.members,
    // A channel is written as its word, as the chat's own box writes it.
    channels:
      chat === undefined
        ? undefined
        : {
            known: chat.channels,
            onChoose: (name) => editor.current?.chooseWords(`#${name}`),
          },
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
      // Note that one list stands at a time, so the field names whichever of the two stands.
      aria: {
        ...(mentionPicker.aria["aria-expanded"] === "true" ? mentionPicker.aria : skillPicker.aria),
        "aria-placeholder": placeholder,
      },
      onKey,
      onTrigger: skillPicker.onTrigger,
      chip: skillPicker.chip,
      mentions:
        at === undefined
          ? undefined
          : {
              onTrigger: mentionPicker.onTrigger,
              onChannelTrigger: chat === undefined ? undefined : mentionPicker.onChannelTrigger,
              // A server's chip in the box says what a send now does with it.
              chip: (mention, node) => (
                <MentionedServers value={servers.place}>
                  <MentionNodeChip
                    mention={mention}
                    doors={at.doors}
                    edit={{ node, pickDate: mentionPicker.pickDate }}
                  />
                </MentionedServers>
              ),
              pasted: (words) =>
                at.place === undefined
                  ? undefined
                  : pastedMentionNode(words, at.place, {
                      known,
                      taskId: at.taskId,
                      text: at.text,
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
