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
} from "@luke/features/inbox-wire";
import { SHORTCUT_KEY, type ShortcutChord } from "@luke/settings/shortcuts";
import {
  Badge,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CHOICE_LOOK,
  CHOICE_SELECT,
  Checkbox,
  ChoiceList,
  type ChoiceOption,
  COMPOSER_LOOK,
  ComposerFrame,
  type FieldControl,
  FormField,
  GAP,
  LAYOUT_ELEMENT,
  ReadableControls,
  Stack,
  TEXT_AREA_SUBMIT,
  TEXT_FIELD_TYPE,
  TextField,
} from "@luke/ui";
import type { Actor } from "@luke/ui/actor-model";
import { CheckIcon, CircleSlashIcon, Undo2Icon } from "lucide-react";
import { ActorLine, ActorRef } from "../actor-ref.js";
import { modEnterSends } from "../enter-sends.js";
import { type FormTextDoors, type FormTextProps, InboxFormText } from "./inbox-form-text.js";
import {
  ANSWER_TONE,
  type AnswerTone,
  answeredDraft,
  CLOSED_WORDS,
  decideButtons,
  doDecision,
  fieldValueOf,
  INBOX_MISSING,
  type InboxDraft,
  type InboxMissing,
  severalFields,
  shownTicks,
  withDoPress,
  withStep,
  withValue,
} from "./inbox-model.js";
import { REPLY_SCOPE } from "./reply-to-selection.js";
import { SentWords } from "./skill-chip.js";

/**
 * inbox-ask-controls.tsx -- what an ask asks for, drawn as the Inbox draws it and as Chat's asks compose it: a `decide`'s options or its two presses, a `do`'s steps and presses, an `answer`'s fields, open or as an answer left them, and the words an ask stands at once it no longer waits.
 *
 * The pieces here are the Inbox's own (`inbox-pane.tsx`), moved so a chat
 * ask (`chat-ask.tsx`) draws an ask with the same controls rather than a
 * copy of them. An open ask's controls attach its answer to a draft as they
 * are pressed, picked, ticked, or filled, the box's Send sending it; an
 * answered ask's stand as the answer left them, read-only and at full
 * strength. Enter on an option or in a field sends the box the controls
 * stand in (`DraftQuestion`), save in a form of several fields, where Enter
 * only picks and ⌘ or Ctrl with Enter sends, and a send lacking something
 * takes the keyboard to it (`focusMissing`). An ask's words, its options and its
 * steps, select and copy whether it is open or not (`ReadableControls`), a
 * drag over them picking and ticking nothing, and stand Reply over them as
 * the words around them do (`reply-to-selection.tsx`), a field's own
 * typing aside. Nothing here knows where the ask came from: an Inbox
 * item's thread or a chat message.
 */

/** The words a choice's open options are named by, for a reader that does not see the question over them. */
const CHOICE_LEGEND = "Options";

/** The badge an option the agent recommends wears, a choice's or a form's select's. */
const RECOMMENDED = "Recommended";

/** A choice's options as `@luke/ui`'s ChoiceList draws them, each the agent recommends wearing its badge. */
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

/** Where a choice's open options stand, which a number key and Enter's way to what is missing find them by. */
const OPTIONS_ATTRIBUTE = "data-inbox-options";

/** The options of the open item's choice, in their order. */
export function optionRows(pane: HTMLElement): HTMLButtonElement[] {
  return [
    ...pane.querySelectorAll<HTMLButtonElement>(
      `[${OPTIONS_ATTRIBUTE}] [role="radio"], [${OPTIONS_ATTRIBUTE}] [role="checkbox"]`,
    ),
  ];
}

/**
 * A choice's options, a radio list where it takes one and a checkbox list
 * where it takes several, each pressed to pick it and pressed again to let
 * it go. Where `numbered`, each of the first nine wears the number that
 * picks it, which the Inbox's pane answers (`useOptionNumbers`). Read-only,
 * it is the choice as it was answered, the picks checked, which no press,
 * key, or number reaches, and which Enter's way to an option passes by.
 */
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

/** What marks a field that may be left empty, since most must be filled. */
const OPTIONAL = "Optional";

/** A field's name, and "Optional" after it where it may be left empty. */
function FieldLabel({ field }: { field: InboxField }): React.JSX.Element {
  return (
    <>
      {field.label}
      {field.required === true ? null : <span className="inbox-field-optional">{OPTIONAL}</span>}
    </>
  );
}

/** How a form's text fields are drawn where the caller draws its own: the Inbox's composer field. */
type FormText = (props: FormTextProps) => React.ReactNode;

/**
 * The parts of a field a frame's attributes name, which Enter's way to an
 * empty field finds it by; a field filled in as answered is named apart,
 * so that way never lands on one.
 */
function fieldFrame(field: InboxField, readOnly: boolean) {
  return readOnly
    ? ({ className: "inbox-field", "data-inbox-answered-field": field.type } as const)
    : ({
        className: "inbox-field",
        "data-inbox-field": field.type,
        "data-inbox-field-label": field.label,
      } as const);
}

/**
 * A text field's words as an answer gave them, in the field's own frame:
 * drawn as the agent's tab draws a sent message, so a mention they hold is
 * its chip, and empty where the field was left empty. Note that the
 * composer's editor is not loaded for it, since nothing is written here.
 */
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
        className="inbox-words inbox-field-words"
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

/**
 * One field of a form, its name over its control and left-aligned as every
 * field is, "Optional" after the name of one that may be left empty: a
 * text field the caller's own or `@luke/ui`'s, a number a short field, a
 * select its options as pills that wrap, the one the agent recommends
 * wearing its badge, its pick taken back by pressing it again, since a
 * field left empty, required or not, is sent without it, and a yes or no a
 * checkbox beside its name. Read-only, each
 * control stands as the answer filled it, which nothing changes.
 */
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
            label={<FieldLabel field={field} />}
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
          <FormField label={<FieldLabel field={field} />}>
            {(control) => (
              <div className="inbox-field-short">
                <TextField
                  field={control}
                  type={TEXT_FIELD_TYPE.NUMBER}
                  maxLength={INBOX_BOUNDS.MAX_FIELD_VALUE_CHARS}
                  value={value === undefined ? undefined : Number(value)}
                  disabled={disabled}
                  readOnly={readOnly}
                  onChange={set}
                />
              </div>
            )}
          </FormField>
        </div>
      );
    case INBOX_FIELD.SELECT:
      return (
        <div {...fieldFrame(field, readOnly)}>
          <span className="inbox-field-name" aria-hidden="true">
            <FieldLabel field={field} />
          </span>
          <ChoiceList
            legend={field.label}
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
        </div>
      );
    case INBOX_FIELD.BOOLEAN:
      return (
        <div {...fieldFrame(field, readOnly)}>
          <Checkbox checked={value === true} disabled={disabled} readOnly={readOnly} onChange={set}>
            <FieldLabel field={field} />
          </Checkbox>
        </div>
      );
  }
}

/** A form's fields, stacked in the agent's order; its text fields drawn by `text` where it is given; read-only, as an answer filled them. */
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

/** Answers no change, for the controls of an answer already given. */
function heldStill(): void {}

/** What an editor's own element matches, its words written in place, and a field of several lines. */
const WRITES_LINES = 'textarea, [contenteditable]:not([contenteditable="false"])';

/** Whether a key goes to whatever takes typing: a field, a select, or an editor. */
export function takesTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches(`input, select, ${WRITES_LINES}`);
}

/** Whether a key goes to something written in lines, whose own Enter breaks one: an editor or a field of several lines. */
function writesLines(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches(WRITES_LINES);
}

/** Whether a key comes alone, with no modifier but perhaps Shift. */
export function bareKey(event: { metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean {
  return !event.metaKey && !event.ctrlKey && !event.altKey;
}

/** ⌘ or Ctrl with Enter, which sends a form of several fields. */
const MOD_ENTER_CHORD: ShortcutChord = { key: SHORTCUT_KEY.ENTER };

/** The key Send's hint names for an ask: ⌘↩ where Enter only picks, nothing where Enter sends. */
export function askSendChord(ask: InboxAsk | undefined): ShortcutChord | undefined {
  return ask !== undefined && severalFields(ask) ? MOD_ENTER_CHORD : undefined;
}

/**
 * Sends the open item's answer from wherever in its pane the developer
 * pressed Enter, through its box's own send, so the box's checks stand: an
 * answer complete goes, and one that is not takes the keyboard to what it
 * lacks (`InboxAnswerBox`).
 */
export function sendFromPane(pane: HTMLElement | null): void {
  pane?.querySelector<HTMLFormElement>("form.inbox-answer")?.requestSubmit();
}

/**
 * Enter in an open item's question, on an option or in a form's field,
 * sends the answer, and never presses the option it stands on; ⌘ or Ctrl
 * with Enter sends from anywhere in it. Where the question is a form of
 * several fields (`several`), a bare Enter sends nothing: it presses the
 * option it stands on, and goes no further than a field, which would
 * otherwise submit the box. Shift+Enter is no send, and an editor's Enter is
 * the editor's own to hand on.
 */
function onResponseKey(
  pane: React.RefObject<HTMLElement | null>,
  several: boolean,
  event: React.KeyboardEvent,
): void {
  if (event.key !== "Enter" || event.shiftKey || event.altKey || event.nativeEvent.isComposing) {
    return;
  }
  if (writesLines(event.target)) return;
  if (several && !modEnterSends(event)) {
    // Note that an input's Enter would submit the box, which is the send this holds back; an option's is left to press it.
    if (event.target instanceof HTMLInputElement) event.preventDefault();
    return;
  }
  // Note that the key is held back here, as it bubbles, which keeps a focused option's button from pressing it.
  event.preventDefault();
  sendFromPane(pane.current);
}

/**
 * Takes the keyboard to what the answer lacks: the option a reader's Tab
 * lands on, the field's first control, or the box's words.
 */
export function focusMissing(pane: HTMLElement | null, missing: InboxMissing): void {
  if (pane === null) return;
  if (missing.kind === INBOX_MISSING.OPTION) {
    const rows = optionRows(pane);
    (rows.find((row) => row.tabIndex === 0) ?? rows[0])?.focus();
    return;
  }
  if (missing.kind === INBOX_MISSING.WORDS) {
    // Note that the note's field is the one outside the question's own, whose text fields stand over it in the box.
    [...pane.querySelectorAll<HTMLElement>('.inbox-answer [contenteditable="true"]')]
      .find((editor) => editor.closest(".inbox-draft-ask") === null)
      ?.focus();
    return;
  }
  const field = [...pane.querySelectorAll<HTMLElement>("[data-inbox-field]")].find(
    (each) => each.dataset.inboxFieldLabel === missing.label,
  );
  field
    ?.querySelector<HTMLElement>(
      'input, [contenteditable="true"], button:not([tabindex="-1"]):not(:disabled)',
    )
    ?.focus();
}

/** The keys 1 to 9, each the option of its number. */
export const OPTION_NUMBER = /^[1-9]$/u;

/** What the presses closing an open ask say. */
const ASK_PRESS = {
  DONE: "Mark done",
  NOT_DONE: "Couldn't do it",
} as const;

/** What an open ask's presses send, and what they are drawn with. */
interface AskDoors {
  readonly draft: InboxDraft;
  readonly disabled: boolean;
  readonly text: FormTextDoors;
  readonly onDraft: (draft: InboxDraft) => void;
}

/** A press closing an open ask, which attaches its answer to the reply while pressed, and takes it off pressed again. */
function AskPress({
  label,
  variant = BUTTON_VARIANT.OUTLINE,
  pressed,
  disabled,
  onPress,
}: {
  label: string;
  variant?: typeof BUTTON_VARIANT.OUTLINE | typeof BUTTON_VARIANT.QUIET;
  pressed: boolean;
  disabled: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Button
      variant={variant}
      size={BUTTON_SIZE.COMPACT}
      pressed={pressed}
      disabled={disabled}
      onClick={onPress}
    >
      {label}
    </Button>
  );
}

/** An ask's controls, whose words select and copy, and a Reply quotes as the words around them. */
function AskWords({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="inbox-ask-words" {...{ [REPLY_SCOPE]: "" }}>
      <ReadableControls>{children}</ReadableControls>
    </div>
  );
}

/**
 * An open ask's controls, each attaching its answer to the reply rather
 * than sending it, and each press taking it off again: a `decide`'s options
 * numbered for the keys, or its two small buttons where it is a yes or no
 * in other words; a `do`'s steps as
 * checkboxes, then Mark done, which ticks every one, and Couldn't do it;
 * an `answer`'s fields, whose values attach to the reply as they are
 * filled, with no press, a form filled in part sending what was filled;
 * nothing for an `answer` of words alone, whose reply's words are the answer.
 */
export function AskControls(props: {
  ask: InboxAsk;
  /** The item's title, which stands as the one step of a to-do that names none; none where nothing names that step. */
  title: string | undefined;
  doors: AskDoors;
}): React.JSX.Element {
  return (
    <AskWords>
      <OpenControls {...props} />
    </AskWords>
  );
}

/** An open ask's controls, as `AskControls` holds them. */
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
        <div className="inbox-ask-presses" data-inbox-options="">
          {ask.options.map((option) => {
            const picked = draft.choices.includes(option.label);
            return (
              <AskPress
                key={option.label}
                label={option.label}
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
                // Steps have no key of their own, and are never reordered.
                <li key={at} data-inbox-step="">
                  <Checkbox
                    checked={ticked.has(at)}
                    disabled={disabled}
                    onChange={() => onDraft(withStep(ask, draft, at))}
                  >
                    {step}
                  </Checkbox>
                </li>
              ))}
            </Stack>
          )}
          <div className="inbox-ask-presses">
            <AskPress
              label={ASK_PRESS.DONE}
              pressed={decision === INBOX_REPLY.DONE}
              disabled={disabled}
              onPress={() => onDraft(withDoPress(ask, draft, INBOX_REPLY.DONE))}
            />
            <AskPress
              label={ASK_PRESS.NOT_DONE}
              variant={BUTTON_VARIANT.QUIET}
              pressed={decision === INBOX_REPLY.NOT_DONE}
              disabled={disabled}
              onPress={() => onDraft(withDoPress(ask, draft, INBOX_REPLY.NOT_DONE))}
            />
          </div>
        </>
      );
    }
    case INBOX_ASK.ANSWER:
      // An ask of words alone has no controls: the box's line is its answer.
      return ask.fields === undefined ? null : (
        <div className="inbox-ask-fields">
          <FormFields
            form={{ fields: ask.fields }}
            draft={draft}
            disabled={disabled}
            text={(props) => (
              <InboxFormText
                {...props}
                doors={doors.text}
                submitKey={severalFields(ask) ? TEXT_AREA_SUBMIT.MOD_ENTER : TEXT_AREA_SUBMIT.ENTER}
              />
            )}
            onDraft={onDraft}
          />
        </div>
      );
  }
}

/** The glyph a press given wears: a check in green going ahead, a turn back in red holding back. */
function ToneGlyph({ tone }: { tone: AnswerTone }): React.JSX.Element {
  return (
    <span className="inbox-ask-pressed" data-tone={tone}>
      {tone === ANSWER_TONE.AHEAD ? (
        <CheckIcon aria-hidden="true" />
      ) : (
        <Undo2Icon aria-hidden="true" />
      )}
    </span>
  );
}

/**
 * A press of an answered ask as it was left: its look and words as it was
 * offered, the one given pressed and wearing its glyph, none of them
 * taking a press.
 */
function AnsweredPress({
  label,
  variant = BUTTON_VARIANT.OUTLINE,
  tone,
  pressed,
}: {
  label: string;
  variant?: typeof BUTTON_VARIANT.OUTLINE | typeof BUTTON_VARIANT.QUIET;
  tone: AnswerTone;
  pressed: boolean;
}): React.JSX.Element {
  return (
    <Button
      variant={variant}
      size={BUTTON_SIZE.COMPACT}
      pressed={pressed}
      readOnly
      icon={pressed ? <ToneGlyph tone={tone} /> : undefined}
    >
      {label}
    </Button>
  );
}

/**
 * An ask's controls as they were left, in the look they had while it
 * waited and taking nothing: a `decide`'s options with `draft`'s picks
 * checked, or its two small buttons with the one pressed marked; a `do`'s
 * steps ticked as `draft` holds them, over Mark done and Couldn't do it
 * with the one `draft` pressed marked; an `answer`'s fields, each holding
 * what `draft` gives it. An `answer` of no fields has none, and draws nothing.
 */
export function HeldControls(props: {
  ask: InboxAsk;
  /** The item's title, which stands as the one step of a to-do that names none; none where nothing names that step. */
  title: string | undefined;
  draft: InboxDraft;
}): React.JSX.Element {
  return (
    <AskWords>
      <LeftControls {...props} />
    </AskWords>
  );
}

/** An ask's controls as they were left, as `HeldControls` holds them. */
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
        <div className="inbox-ask-presses">
          {ask.options.map((option, at) => (
            <AnsweredPress
              key={option.label}
              label={option.label}
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
                // Steps have no key of their own, and are never reordered.
                <li key={at} data-inbox-step="">
                  <Checkbox checked={ticked.has(at)} readOnly onChange={heldStill}>
                    {step}
                  </Checkbox>
                </li>
              ))}
            </Stack>
          )}
          <div className="inbox-ask-presses">
            <AnsweredPress
              label={ASK_PRESS.DONE}
              tone={ANSWER_TONE.AHEAD}
              pressed={draft.press === INBOX_REPLY.DONE}
            />
            <AnsweredPress
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

/** Whether an ask draws any controls once it no longer waits: every one but an `answer` of words alone. */
export function hasControls(ask: InboxAsk): boolean {
  return ask.type !== INBOX_ASK.ANSWER || ask.fields !== undefined;
}

/**
 * The open question's controls as the draft reply's card's body, over its
 * foot, with no card, border, or head of their own, since the agent's
 * message says what it asks: an Enter on an option or in a field sends the
 * card, and ⌘ or Ctrl with Enter sends it from anywhere in it, the only
 * send of a form of several fields.
 */
export function DraftQuestion({
  pane,
  ask,
  children,
}: {
  pane: React.RefObject<HTMLElement | null>;
  ask: InboxAsk;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the keys it hears come from the options and fields inside it, whose Enter sends the card.
    <div
      className="inbox-draft-ask"
      data-inbox-draft-ask=""
      onKeyDown={(event) => onResponseKey(pane, severalFields(ask), event)}
    >
      {children}
    </div>
  );
}

/** The steps a `do` ask shows: its own, or the one its title names where it names none; none where nothing names that step. */
function stepsOf(ask: Extract<InboxAsk, { type: typeof INBOX_ASK.DO }>, title: string | undefined) {
  if (ask.steps.length > 0) return ask.steps;
  return title === undefined ? [] : [title];
}

/**
 * The ask a member's reply answered, at the head of that reply under their
 * face and name, in the reply's stamp's place: the ask's controls alone
 * (`HeldControls`), standing in the reply with no card around them, as the
 * answer left them, which say how it was answered. An `answer` of no fields
 * draws no card, its reply's words being the answer and the agent's message
 * saying it was answered (`AskBox`).
 */
export function AnsweredCard({
  ask,
  title,
  answers,
}: {
  ask: InboxAsk;
  /** The item's title, which stands as the one step of a to-do that names none; none where nothing names that step. */
  title: string | undefined;
  answers: InboxAnswers;
}): React.JSX.Element | null {
  if (!hasControls(ask)) return null;
  return (
    // Note that it is no `inbox-ask` card: the controls stand in the reply itself, at its words' left edge.
    <div className="inbox-ask-answered" data-inbox-answered="">
      <HeldControls ask={ask} title={title} draft={answeredDraft(ask, answers)} />
    </div>
  );
}

/** What an ask's line says of one answered, where the answer itself is not drawn beside it. */
export const ANSWERED = "Answered";

/** What an ask's line says of one taken back. */
const WITHDRAWN = "Withdrawn";

/**
 * How a withdrawn ask's line reads, after a slashed circle: "Withdrawn"
 * where its agent said why, the why standing apart (`WithdrawnWhy`) so a
 * long one never wraps inside the line, or, where none was said, who closed
 * it without answering, where that is known.
 */
export function WithdrawnWords({
  reason,
  closer,
}: {
  reason: string | undefined;
  /** Who closed it without answering; none where that is not known. */
  closer: Actor | undefined;
}): React.JSX.Element {
  if (reason !== undefined) {
    return (
      <span className="inbox-ask-standing">
        <CircleSlashIcon aria-hidden="true" />
        {WITHDRAWN}
      </span>
    );
  }
  return (
    <span className="inbox-ask-standing">
      <CircleSlashIcon aria-hidden="true" />
      {closer === undefined ? (
        CLOSED_WORDS
      ) : (
        <ActorLine>
          <ActorRef actor={closer} nameOnly />
          {` · ${CLOSED_WORDS}`}
        </ActorLine>
      )}
    </span>
  );
}

/** Why an ask was taken back, as a muted sentence under its line; nothing where none was said. */
export function WithdrawnWhy({ reason }: { reason: string | undefined }): React.JSX.Element | null {
  if (reason === undefined) return null;
  return (
    // Note that its words may be quoted into a reply, as the agent's own words may.
    <p className="inbox-ask-why" data-inbox-withdrawn-why="" {...{ [REPLY_SCOPE]: "" }}>
      {reason}
    </p>
  );
}

/** The small pill an ask waiting on someone else ends its message with: "Waiting on" them, after a dot in the muted ink. */
export function WaitingMarker({ on }: { on: string }): React.JSX.Element {
  return (
    <span data-inbox-marker="">
      <Badge dot>Waiting on {on}</Badge>
    </span>
  );
}
