import {
  INBOX_ASK,
  INBOX_BOUNDS,
  INBOX_FIELD,
  INBOX_REPLY,
  type InboxAnswers,
  type InboxAsk,
  type InboxChoice,
  type InboxField,
  type InboxForm,
  recommendedLabels,
} from "@repo/features/inbox-wire";
import { FIELD_WORDS } from "@repo/features/words";
import {
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CHOICE_LOOK,
  CHOICE_SELECT,
  Checkbox,
  ChoiceList,
  type ChoiceOption,
  COMPOSER_LOOK,
  CodeCard,
  ComposerFrame,
  type FieldControl,
  FormField,
  GAP,
  LAYOUT_ELEMENT,
  QuietWords,
  ReadableControls,
  Stack,
  TEXT_ELEMENT,
  TEXT_FIELD_TYPE,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextField,
} from "@repo/ui";
import { isComposingKey } from "@repo/ui/composing-key";
import { CheckIcon, GLYPH, Undo2Icon } from "@repo/ui/icons";
import { useEffect, useRef } from "react";
import { copyThroughShell } from "../copy-feedback.js";
import { MarkdownMessage } from "../markdown-message.js";
import { INBOX_MISSING, type InboxMissing } from "./inbox-ask-words.js";
import { type FormTextDoors, type FormTextProps, InboxFormText } from "./inbox-form-text.js";
import {
  ANSWER_TONE,
  type AnswerTone,
  answeredDraft,
  decideButtons,
  doDecision,
  fieldValueOf,
  type InboxDraft,
  RECOMMENDED,
  shownTicks,
  stepParts,
  withDoPress,
  withStep,
  withValue,
} from "./inbox-model.js";
import { ANSWER_STATUS_TONE } from "./inbox-stamp.js";
import { REPLY_SCOPE } from "./reply-to-selection.js";
import { SentWords } from "./skill-chip.js";
import { useOpenLink } from "./use-open-link.js";

export const INBOX_ASK_BOX = "inbox-ask min-w-0";

export const INBOX_ASK_KIND = "inbox-ask-kind font-ui-medium text-foreground";

export const INBOX_ASK_STANDING =
  "inbox-ask-standing inline-flex min-w-0 items-center gap-tight-gap [&>svg]:size-ui-12 [&>svg]:flex-none";

const INBOX_ASK_PRESSES = "inbox-ask-presses flex flex-wrap gap-control-gap";

const CHOICE_LEGEND = "Options";

function choiceOptions(
  options: readonly { label: string; detail?: string | undefined; recommended: boolean }[],
): ChoiceOption<string>[] {
  return options.map((option) => ({
    value: option.label,
    label: option.label,
    detail: option.detail,
    badge: option.recommended ? RECOMMENDED : undefined,
  }));
}

const OPTIONS_ATTRIBUTE = "data-inbox-options";

export function optionRows(pane: HTMLElement): HTMLButtonElement[] {
  return [
    ...pane.querySelectorAll<HTMLButtonElement>(
      `[${OPTIONS_ATTRIBUTE}] [role="radio"], [${OPTIONS_ATTRIBUTE}] [role="checkbox"]`,
    ),
  ];
}

function ChoiceOptions({
  choice,
  draft,
  disabled,
  numbered = false,
  readOnly = false,
  onDraft,
}: {
  choice: Pick<InboxChoice, "options" | "multiple" | "recommended" | "recommendations">;
  draft: InboxDraft;
  disabled: boolean;
  numbered?: boolean;
  readOnly?: boolean;
  onDraft: (draft: InboxDraft) => void;
}): React.JSX.Element {
  const options = choiceOptions(
    choice.options.map((option) => ({
      ...option,
      recommended: recommendedLabels(choice).includes(option.label),
    })),
  );
  return (
    <div {...(readOnly ? {} : { [OPTIONS_ATTRIBUTE]: "" })}>
      <ChoiceList
        legend={CHOICE_LEGEND}
        options={options}
        value={draft.choices}
        select={choice.multiple === true ? CHOICE_SELECT.MANY : CHOICE_SELECT.ONE}
        look={CHOICE_LOOK.MARKED}
        numbered={numbered && !readOnly}
        clearable
        disabled={disabled}
        readOnly={readOnly}
        onChange={(choices) => onDraft({ ...draft, choices: [...choices] })}
      />
    </div>
  );
}

function optionalField(field: InboxField): boolean {
  return field.required !== true;
}

function CheckboxWords({ field }: { field: InboxField }): React.JSX.Element {
  return (
    <>
      {field.label}
      {optionalField(field) ? (
        <>
          {" "}
          <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {FIELD_WORDS.OPTIONAL}
          </Text>
        </>
      ) : null}
    </>
  );
}

type FormText = (props: FormTextProps) => React.ReactNode;

function fieldFrame(field: InboxField, readOnly: boolean) {
  return readOnly
    ? ({
        className: "inbox-field flex min-w-0 flex-col gap-item-gap",
        "data-inbox-answered-field": field.type,
      } as const)
    : ({
        className: "inbox-field flex min-w-0 flex-col gap-item-gap",
        "data-inbox-field": field.type,
        "data-inbox-field-label": field.label,
      } as const);
}

function AnsweredText({
  control,
  words,
}: {
  control: FieldControl;
  words: string;
}): React.JSX.Element {
  return (
    <ComposerFrame look={COMPOSER_LOOK.INPUT} className="inbox-field-composer" data-read-only="">
      {/* biome-ignore lint/a11y/useSemanticElements: the words hold mention chips, which no native field can, and speak as the read-only field they stand for. */}
      <div
        className="inbox-field-words m-0 box-border min-h-inbox-field-words px-control-inset py-item-gap wrap-anywhere select-text"
        role="textbox"
        aria-readonly="true"
        aria-multiline="true"
        aria-labelledby={control.labelId}
        aria-describedby={control["aria-describedby"]}
        tabIndex={-1}
      >
        {words === "" ? null : <SentWords text={words} />}
      </div>
    </ComposerFrame>
  );
}

function InboxFormField({
  field,
  draft,
  disabled,
  readOnly,
  text,
  onDraft,
}: {
  field: InboxField;
  draft: InboxDraft;
  disabled: boolean;
  readOnly: boolean;
  text: FormText | undefined;
  onDraft: (draft: InboxDraft) => void;
}): React.JSX.Element {
  const value = fieldValueOf(draft, field.label);
  const set = (next: string | number | boolean | undefined) =>
    onDraft(withValue(draft, field.label, next));
  switch (field.type) {
    case INBOX_FIELD.TEXT:
      return (
        <div {...fieldFrame(field, readOnly)}>
          <FormField
            label={field.label}
            optional={optionalField(field)}
            count={
              readOnly
                ? undefined
                : {
                    length: value === undefined ? 0 : String(value).length,
                    limit: INBOX_BOUNDS.MAX_FIELD_VALUE_CHARS,
                  }
            }
          >
            {(control) => {
              const words = value === undefined ? "" : String(value);
              const onChange = (typed: string | undefined) =>
                set(typed === undefined || typed === "" ? undefined : typed);
              if (readOnly) return <AnsweredText control={control} words={words} />;
              return text === undefined ? (
                <TextField
                  field={control}
                  maxLength={INBOX_BOUNDS.MAX_FIELD_VALUE_CHARS}
                  value={words}
                  disabled={disabled}
                  onChange={onChange}
                />
              ) : (
                text({ field, control, value: words, disabled, onChange })
              );
            }}
          </FormField>
        </div>
      );
    case INBOX_FIELD.NUMBER:
      return (
        <div {...fieldFrame(field, readOnly)}>
          <FormField label={field.label} optional={optionalField(field)}>
            {(control) => (
              <div className="inbox-field-short max-w-inbox-field-short">
                {readOnly ? (
                  <AnsweredText
                    control={control}
                    words={value === undefined ? "" : String(value)}
                  />
                ) : (
                  <TextField
                    field={control}
                    type={TEXT_FIELD_TYPE.NUMBER}
                    maxLength={INBOX_BOUNDS.MAX_FIELD_VALUE_CHARS}
                    value={value === undefined ? undefined : Number(value)}
                    disabled={disabled}
                    onChange={set}
                  />
                )}
              </div>
            )}
          </FormField>
        </div>
      );
    case INBOX_FIELD.SELECT:
      return (
        <div {...fieldFrame(field, readOnly)}>
          <FormField label={field.label} optional={optionalField(field)}>
            {(control) => (
              <ChoiceList
                legend={field.label}
                describedBy={control["aria-describedby"]}
                required={control["aria-required"]}
                options={(field.options ?? []).map((option) => ({
                  value: option,
                  label: option,
                  badge: field.recommended === option ? RECOMMENDED : undefined,
                }))}
                value={(field.options ?? []).filter((option) => option === value)}
                look={CHOICE_LOOK.PILL}
                clearable
                disabled={disabled}
                readOnly={readOnly}
                onChange={(picked) => set(picked[0])}
              />
            )}
          </FormField>
        </div>
      );
    case INBOX_FIELD.BOOLEAN:
      return (
        <div {...fieldFrame(field, readOnly)}>
          <Checkbox checked={value === true} disabled={disabled} readOnly={readOnly} onChange={set}>
            <CheckboxWords field={field} />
          </Checkbox>
        </div>
      );
  }
}

function FormFields({
  form,
  draft,
  disabled,
  readOnly = false,
  text,
  onDraft,
}: {
  form: Pick<InboxForm, "fields">;
  draft: InboxDraft;
  disabled: boolean;
  readOnly?: boolean;
  text?: FormText | undefined;
  onDraft: (draft: InboxDraft) => void;
}): React.JSX.Element {
  return (
    <Stack gap={GAP.FIELD}>
      {form.fields.map((field) => (
        <InboxFormField
          key={field.label}
          field={field}
          draft={draft}
          disabled={disabled}
          readOnly={readOnly}
          text={text}
          onDraft={onDraft}
        />
      ))}
    </Stack>
  );
}

function heldStill(): void {}

const WRITES_LINES = 'textarea, [contenteditable]:not([contenteditable="false"])';

export function takesTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches(`input, select, ${WRITES_LINES}`);
}

function writesLines(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches(WRITES_LINES);
}

export function bareKey(event: { metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean {
  return !event.metaKey && !event.ctrlKey && !event.altKey;
}

export function sendFromPane(pane: HTMLElement | null): void {
  pane?.querySelector<HTMLFormElement>("form.inbox-answer")?.requestSubmit();
}

const FIELD_CONTROL = 'input, [contenteditable="true"], button:not([tabindex="-1"]):not(:disabled)';

export function focusMissing(box: HTMLElement | null, missing: InboxMissing): void {
  if (box === null) return;
  switch (missing.kind) {
    case INBOX_MISSING.OPTION: {
      const rows = optionRows(box);
      const option =
        rows.find((row) => row.tabIndex === 0) ??
        rows[0] ??
        box.querySelector<HTMLElement>(`[${OPTIONS_ATTRIBUTE}] button`);
      option?.focus();
      return;
    }
    case INBOX_MISSING.FIELD: {
      const field = [...box.querySelectorAll<HTMLElement>("[data-inbox-field-label]")].find(
        (each) => each.dataset.inboxFieldLabel === missing.label,
      );
      field?.querySelector<HTMLElement>(FIELD_CONTROL)?.focus();
      return;
    }
    case INBOX_MISSING.WORDS:
      [...box.querySelectorAll<HTMLElement>('form.inbox-answer [contenteditable="true"]')]
        .find((editor) => editor.closest("[data-inbox-draft-ask]") === null)
        ?.focus();
  }
}

function opensLink(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.matches("a[href]");
}

function onResponseKey(
  pane: React.RefObject<HTMLElement | null>,
  event: React.KeyboardEvent,
): void {
  if (event.key !== "Enter" || event.shiftKey || event.altKey || isComposingKey(event)) return;
  if (writesLines(event.target) || opensLink(event.target)) return;
  event.preventDefault();
  sendFromPane(pane.current);
}

export const OPTION_NUMBER = /^[1-9]$/u;

const ASK_PRESS = {
  DONE: "Mark done",
  NOT_DONE: "Couldn't do it",
} as const;

interface AskDoors {
  readonly draft: InboxDraft;
  readonly disabled: boolean;
  readonly text: FormTextDoors;
  readonly onDraft: (draft: InboxDraft) => void;
}

function AskPress({
  label,
  variant = BUTTON_VARIANT.OUTLINE,
  recommended = false,
  tone,
  pressed,
  disabled = false,
  onPress,
}: {
  label: string;
  variant?: typeof BUTTON_VARIANT.OUTLINE | typeof BUTTON_VARIANT.QUIET;
  recommended?: boolean;
  tone: AnswerTone;
  pressed: boolean;
  disabled?: boolean;
  onPress?: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <Button
      variant={variant}
      size={BUTTON_SIZE.COMPACT}
      badge={recommended ? RECOMMENDED : undefined}
      pressed={pressed}
      disabled={disabled}
      readOnly={onPress === undefined}
      icon={<ToneGlyph tone={tone} pressed={pressed} />}
      onClick={onPress}
    >
      {label}
    </Button>
  );
}

const STEP_CODE_TITLE = "code";

function StepBox({
  step,
  at,
  checked,
  disabled,
  readOnly,
  onChange,
}: {
  step: string;
  at: number;
  checked: boolean;
  disabled?: boolean | undefined;
  readOnly?: boolean | undefined;
  onChange: () => void;
}): React.JSX.Element {
  const openLink = useOpenLink();
  const { say, fences } = stepParts(step);
  const detail =
    fences.length === 0 ? undefined : (
      <Stack gap={GAP.CONTROL}>
        {fences.map((fence, place) => (
          <CodeCard
            key={place}
            title={fence.lang ?? STEP_CODE_TITLE}
            code={fence.code}
            copy={copyThroughShell}
          />
        ))}
      </Stack>
    );
  return (
    <Checkbox
      checked={checked}
      disabled={disabled}
      readOnly={readOnly}
      onChange={onChange}
      detail={detail}
    >
      {say === "" ? `Step ${at + 1}` : <MarkdownMessage words={say} inline openLink={openLink} />}
    </Checkbox>
  );
}

function AskWords({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="inbox-ask-words contents" {...{ [REPLY_SCOPE]: "" }}>
      <ReadableControls>{children}</ReadableControls>
    </div>
  );
}

export function AskControls(props: {
  ask: InboxAsk;
  title: string | undefined;
  doors: AskDoors;
}): React.JSX.Element {
  return (
    <AskWords>
      <OpenControls {...props} />
    </AskWords>
  );
}

function OpenControls({
  ask,
  title,
  doors,
}: {
  ask: InboxAsk;
  title: string | undefined;
  doors: AskDoors;
}): React.JSX.Element | null {
  const { draft, disabled, onDraft } = doors;
  switch (ask.type) {
    case INBOX_ASK.DECIDE:
      return decideButtons(ask) ? (
        <div className={INBOX_ASK_PRESSES} {...{ [OPTIONS_ATTRIBUTE]: "" }}>
          {ask.options.map((option, at) => {
            const picked = draft.choices.includes(option.label);
            return (
              <AskPress
                key={option.label}
                label={option.label}
                recommended={recommendedLabels(ask).includes(option.label)}
                tone={at === 0 ? ANSWER_TONE.AHEAD : ANSWER_TONE.BACK}
                pressed={picked}
                disabled={disabled}
                onPress={() => onDraft({ ...draft, choices: picked ? [] : [option.label] })}
              />
            );
          })}
        </div>
      ) : (
        <div className="inbox-ask-options">
          <ChoiceOptions
            choice={ask}
            draft={draft}
            disabled={disabled}
            numbered
            onDraft={onDraft}
          />
        </div>
      );
    case INBOX_ASK.DO: {
      const steps = stepsOf(ask, title);
      const ticked = new Set(shownTicks(ask, draft));
      const decision = doDecision(ask, draft);
      return (
        <>
          {steps.length === 0 ? null : (
            <Stack as={LAYOUT_ELEMENT.UL} gap={GAP.CONTROL} aria-label="Steps">
              {steps.map((step, at) => (
                <li key={at} data-inbox-step="">
                  <StepBox
                    step={step}
                    at={at}
                    checked={ticked.has(at)}
                    disabled={disabled}
                    onChange={() => onDraft(withStep(ask, draft, at))}
                  />
                </li>
              ))}
            </Stack>
          )}
          <div className={INBOX_ASK_PRESSES} {...{ [OPTIONS_ATTRIBUTE]: "" }}>
            <AskPress
              label={ASK_PRESS.DONE}
              tone={ANSWER_TONE.AHEAD}
              pressed={decision === INBOX_REPLY.DONE}
              disabled={disabled}
              onPress={() => onDraft(withDoPress(ask, draft, INBOX_REPLY.DONE))}
            />
            <AskPress
              label={ASK_PRESS.NOT_DONE}
              variant={BUTTON_VARIANT.QUIET}
              tone={ANSWER_TONE.BACK}
              pressed={decision === INBOX_REPLY.NOT_DONE}
              disabled={disabled}
              onPress={() => onDraft(withDoPress(ask, draft, INBOX_REPLY.NOT_DONE))}
            />
          </div>
        </>
      );
    }
    case INBOX_ASK.ANSWER:
      return ask.fields === undefined ? null : (
        <div className="inbox-ask-fields">
          <FormFields
            form={{ fields: ask.fields }}
            draft={draft}
            disabled={disabled}
            text={(props) => <InboxFormText {...props} doors={doors.text} />}
            onDraft={onDraft}
          />
        </div>
      );
  }
}

function ToneGlyph({ tone, pressed }: { tone: AnswerTone; pressed: boolean }): React.JSX.Element {
  return (
    <span
      className="inbox-ask-pressed inline-flex text-tone-ink"
      data-tone={pressed ? ANSWER_STATUS_TONE[tone] : undefined}
    >
      {tone === ANSWER_TONE.AHEAD ? (
        <CheckIcon aria-hidden="true" />
      ) : (
        <Undo2Icon aria-hidden="true" />
      )}
    </span>
  );
}

export function HeldControls(props: {
  ask: InboxAsk;
  title: string | undefined;
  draft: InboxDraft;
}): React.JSX.Element {
  return (
    <AskWords>
      <LeftControls {...props} />
    </AskWords>
  );
}

function LeftControls({
  ask,
  title,
  draft,
}: {
  ask: InboxAsk;
  title: string | undefined;
  draft: InboxDraft;
}): React.JSX.Element | null {
  switch (ask.type) {
    case INBOX_ASK.DECIDE:
      return decideButtons(ask) ? (
        <div className={INBOX_ASK_PRESSES}>
          {ask.options.map((option, at) => (
            <AskPress
              key={option.label}
              label={option.label}
              recommended={recommendedLabels(ask).includes(option.label)}
              tone={at === 0 ? ANSWER_TONE.AHEAD : ANSWER_TONE.BACK}
              pressed={draft.choices.includes(option.label)}
            />
          ))}
        </div>
      ) : (
        <ChoiceOptions choice={ask} draft={draft} disabled={false} readOnly onDraft={heldStill} />
      );
    case INBOX_ASK.DO: {
      const steps = stepsOf(ask, title);
      const ticked = new Set(draft.steps ?? []);
      return (
        <>
          {steps.length === 0 ? null : (
            <Stack as={LAYOUT_ELEMENT.UL} gap={GAP.CONTROL} aria-label="Steps">
              {steps.map((step, at) => (
                <li key={at} data-inbox-step="">
                  <StepBox
                    step={step}
                    at={at}
                    checked={ticked.has(at)}
                    readOnly
                    onChange={heldStill}
                  />
                </li>
              ))}
            </Stack>
          )}
          <div className={INBOX_ASK_PRESSES}>
            <AskPress
              label={ASK_PRESS.DONE}
              tone={ANSWER_TONE.AHEAD}
              pressed={draft.press === INBOX_REPLY.DONE}
            />
            <AskPress
              label={ASK_PRESS.NOT_DONE}
              variant={BUTTON_VARIANT.QUIET}
              tone={ANSWER_TONE.BACK}
              pressed={draft.press === INBOX_REPLY.NOT_DONE}
            />
          </div>
        </>
      );
    }
    case INBOX_ASK.ANSWER:
      return ask.fields === undefined ? null : (
        <FormFields
          form={{ fields: ask.fields }}
          draft={draft}
          disabled={false}
          readOnly
          onDraft={heldStill}
        />
      );
  }
}

export function hasControls(ask: InboxAsk): boolean {
  return ask.type !== INBOX_ASK.ANSWER || ask.fields !== undefined;
}

export function DraftQuestion({
  pane,
  close,
  children,
}: {
  pane: React.RefObject<HTMLElement | null>;
  close?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className="inbox-draft-ask flex min-w-0 items-start gap-tight-gap px-list-inset pt-list-inset pb-tight-gap"
      data-inbox-draft-ask=""
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the keys it hears come from the options and fields inside it, whose Enter sends the card. */}
      <div
        className="flex min-w-0 flex-1 flex-col gap-block-gap"
        onKeyDown={(event) => onResponseKey(pane, event)}
      >
        {children}
      </div>
      {close}
    </div>
  );
}

const RESOLVING = "Resolving without answering";

const UNDO_RESOLVE = "Undo";

export function DraftResolving({
  takesFocus,
  onUndo,
}: {
  takesFocus: boolean;
  onUndo: () => void;
}): React.JSX.Element {
  const undo = useRef<HTMLButtonElement>(null);
  const focused = useRef(takesFocus);
  useEffect(() => {
    if (focused.current) undo.current?.focus();
  }, []);
  return (
    <div
      className="inbox-draft-resolving flex min-w-0 items-center justify-between gap-tight-gap px-list-inset pt-list-inset pb-tight-gap"
      data-inbox-draft-ask=""
    >
      <Text tone={TEXT_TONE.MUTED}>
        <span className={INBOX_ASK_STANDING}>
          <GLYPH.CLOSE aria-hidden="true" />
          {RESOLVING}
        </span>
      </Text>
      <Button ref={undo} variant={BUTTON_VARIANT.QUIET} size={BUTTON_SIZE.COMPACT} onClick={onUndo}>
        {UNDO_RESOLVE}
      </Button>
    </div>
  );
}

function stepsOf(ask: Extract<InboxAsk, { type: typeof INBOX_ASK.DO }>, title: string | undefined) {
  if (ask.steps.length > 0) return ask.steps;
  return title === undefined ? [] : [title];
}

export function AnsweredCard({
  ask,
  title,
  answers,
}: {
  ask: InboxAsk;
  title: string | undefined;
  answers: InboxAnswers;
}): React.JSX.Element | null {
  if (!hasControls(ask)) return null;
  return (
    <div
      className="inbox-ask-answered mb-tight-gap flex min-w-0 flex-col gap-block-gap"
      data-inbox-answered=""
    >
      <HeldControls ask={ask} title={title} draft={answeredDraft(ask, answers)} />
    </div>
  );
}

export const ANSWERED = "Answered";

export function WithdrawnWhy({ reason }: { reason: string | undefined }): React.JSX.Element | null {
  if (reason === undefined) return null;
  return (
    <p
      className="inbox-ask-why m-0 text-muted-foreground wrap-anywhere"
      data-inbox-withdrawn-why=""
    >
      {reason}
    </p>
  );
}

export function WaitingMarker({ on }: { on: string }): React.JSX.Element {
  return (
    <span data-inbox-marker="">
      <QuietWords>Waiting on {on}</QuietWords>
    </span>
  );
}
