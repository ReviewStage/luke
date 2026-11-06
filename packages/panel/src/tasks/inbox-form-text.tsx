import { useAtomValue } from "@effect/atom-react";
import { AGENT_STATUS, type AgentSummary } from "@repo/features/agent-wire";
import { INBOX_BOUNDS, type InboxField } from "@repo/features/inbox-wire";
import { COMPOSER_LOOK, ComposerFrame, type FieldControl } from "@repo/ui";
import { SERVER_HANDED } from "@repo/ui/agent-servers-model";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useEffect, useRef } from "react";
import { useSideBundles } from "../bundle-loader.js";
import { useIntegrationStatuses } from "../integration-statuses.js";
import { PANEL_SPAN } from "../panel-spans.js";
import { COMPOSER_INPUT, type ComposerEditorHandle } from "../description-editor/contract.js";
import { ComposerField } from "./composer-field.js";
import { useComposerPickers } from "./composer-pickers.js";
import type { SkillSource } from "./skill-picker.js";

export interface FormTextProps {
  readonly field: InboxField;
  readonly control: FieldControl;
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (typed: string | undefined) => void;
}

export interface FormTextDoors {
  readonly self: string | undefined;
  readonly agent: AgentSummary | undefined;
  readonly skills: SkillSource | undefined;
  readonly keywords: readonly string[];
  readonly onEnter: () => void;
}

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
  const bundle = useAtomValue(useSideBundles().descriptionEditor);
  const module = AsyncResult.isSuccess(bundle) ? bundle.value : undefined;
  const { agent } = doors;
  const { labelId } = control;
  useEffect(() => {
    const name = document.getElementById(labelId);
    if (name === null) return;
    const focus = () => editor.current?.focus();
    name.addEventListener("click", focus);
    return () => name.removeEventListener("click", focus);
  }, [labelId]);
  const pickers = useComposerPickers({
    editor,
    room,
    draft: value,
    placeholder: "",
    self: doors.self,
    skills: doors.skills,
    keywords: doors.keywords,
    servers: {
      statuses,
      place: {
        disabled: agent?.disabledServers ?? [],
        handed: agent?.status === AGENT_STATUS.RUNNING ? SERVER_HANDED.STEERS : SERVER_HANDED.OPENS,
      },
    },
    onNote: () => undefined,
  });
  return (
    <ComposerFrame
      look={COMPOSER_LOOK.INPUT}
      className="inbox-field-composer"
      data-disabled={disabled ? "" : undefined}
    >
      <ComposerField
        keystrokeSpan={PANEL_SPAN.KEYSTROKE_INBOX_ANSWER}
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
        aria={{
          ...pickers.field.aria,
          "aria-labelledby": labelId,
          "aria-describedby": control["aria-describedby"],
          "aria-required": control["aria-required"] === true ? "true" : undefined,
        }}
        onEnter={doors.onEnter}
        onPasteFiles={() => false}
      />
    </ComposerFrame>
  );
}
