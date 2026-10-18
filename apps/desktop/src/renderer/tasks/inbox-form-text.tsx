import { useAtomValue } from "@effect/atom-react";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { INBOX_BOUNDS, type InboxField } from "@luke/features/inbox-wire";
import type { FieldControl } from "@luke/ui";
import { SERVER_HANDED } from "@luke/ui/agent-servers-model";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useRef } from "react";
import { useSideBundles } from "../bundle-loader";
import { useIntegrationStatuses } from "../integration-statuses";
import { COMPOSER_INPUT, type ComposerEditorHandle } from "../plan-editor/contract";
import { ComposerField } from "./composer-field";
import { useComposerPickers } from "./composer-pickers";
import type { SkillSource } from "./skill-picker";

/**
 * inbox-form-text.tsx -- a text field of an Inbox form, written in the composer's own field, as the item's box is.
 *
 * The field is the composer's (`composer-field.tsx`), through the same
 * pickers the box takes (`composer-pickers.tsx`): an `@` opens what the
 * words may mention, written in as its link and drawn as its chip, and a
 * `/` opens the repository's skills; it is drawn at a field's size under
 * the field's name rather than as a card. What it holds is the field's
 * value, links and all, so a mention reaches the agent as a note's does.
 * Enter sends the item's answer, or takes the keyboard to what it lacks,
 * as Enter anywhere in the item does, Shift+Enter is a new line, and
 * Escape leaves the field. Like the box, it never takes the caret as the
 * item opens, because K and J step the list.
 */

/** What a form's own text field is handed: the field, the ids its name is read by, and what it holds. */
export interface FormTextProps {
  readonly field: InboxField;
  readonly control: FieldControl;
  readonly value: string;
  readonly disabled: boolean;
  /** Hands the field's words back, nothing for an empty field. */
  readonly onChange: (typed: string | undefined) => void;
}

/** What every text field of an item's form is written with: whom the words go to, what they may name, and the item's send. */
export interface FormTextDoors {
  /** The item's agent, which the `@` list does not offer. */
  readonly self: string;
  /** The item's agent as its holder's read lists it, whose servers' switches a server's chip reads. */
  readonly agent: CodingAgentSummary | undefined;
  /** Where the item's repository's skills are read from; nothing where none can be. */
  readonly skills: SkillSource | undefined;
  /** The words a dictation is likely to say (`dictation-keywords.ts`). */
  readonly keywords: readonly string[];
  /** Sends the item's answer, or takes the keyboard to what it lacks. */
  readonly onEnter: () => void;
}

/** One text field of a form as the composer's field, sized as a field. */
export function InboxFormText({
  field,
  control,
  value,
  disabled,
  onChange,
  doors,
}: FormTextProps & { doors: FormTextDoors }): React.JSX.Element {
  const editor = useRef<ComposerEditorHandle | undefined>(undefined);
  const room = useRef<HTMLDivElement>(null);
  const statuses = useIntegrationStatuses();
  const bundle = useAtomValue(useSideBundles().planEditor);
  const module = AsyncResult.isSuccess(bundle) ? bundle.value : undefined;
  const { agent } = doors;
  const pickers = useComposerPickers({
    editor,
    room,
    draft: value,
    placeholder: "",
    self: doors.self,
    skills: doors.skills,
    keywords: doors.keywords,
    // A server's chip says what the answer does with it, as the box's does.
    servers: {
      statuses,
      place: {
        disabled: agent?.disabledServers ?? [],
        handed:
          agent?.status === CODING_AGENT_STATUS.RUNNING
            ? SERVER_HANDED.STEERS
            : SERVER_HANDED.OPENS,
      },
    },
    // Note that the field has no microphone, so no dictation of its own has anything to say.
    onNote: () => undefined,
  });
  return (
    <div className="inbox-field-composer" data-disabled={disabled ? "" : undefined}>
      <ComposerField
        module={module}
        editor={editor}
        room={room}
        draft={value}
        setDraft={(typed) => onChange(typed === "" ? undefined : typed)}
        placeholder=""
        label={field.label}
        input={disabled ? COMPOSER_INPUT.DISABLED : COMPOSER_INPUT.EDITABLE}
        maxLength={INBOX_BOUNDS.MAX_FIELD_VALUE_CHARS}
        takesFocus={false}
        {...pickers.field}
        aria={{ ...pickers.field.aria, "aria-describedby": control["aria-describedby"] }}
        onEnter={doors.onEnter}
        onPasteFiles={() => false}
      />
    </div>
  );
}
