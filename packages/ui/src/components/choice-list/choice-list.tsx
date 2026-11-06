import { Checkbox } from "@base-ui/react/checkbox";
import { CheckboxGroup } from "@base-ui/react/checkbox-group";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import type { ReactNode } from "react";
import { cn } from "../../cn.js";
import { pulsePress } from "../../press-pulse.js";
import { ignoredByReplay, REPLAY_MASKED, ReplayWords } from "../../session-replay-marks.js";
import { STATUS_TONE, type StatusTone } from "../../status-tone.js";
import {
  ROVING_ORIENTATION,
  ROVING_STOP,
  rovingItem,
  useRovingKeys,
} from "../roving-keys/roving-keys.js";

export const CHOICE_SELECT = {
  ONE: "one",
  MANY: "many",
} as const;

export type ChoiceSelect = (typeof CHOICE_SELECT)[keyof typeof CHOICE_SELECT];

export const CHOICE_LOOK = {
  PLAIN: "plain",
  MARKED: "marked",
  PILL: "pill",
  CARD: "card",
} as const;

export type ChoiceLook = (typeof CHOICE_LOOK)[keyof typeof CHOICE_LOOK];

export const CHOICE_FLOW = {
  DOWN: "down",
  ACROSS: "across",
} as const;

export type ChoiceFlow = (typeof CHOICE_FLOW)[keyof typeof CHOICE_FLOW];

export const CHOICE_NUMBERED_ROWS = 9;

const LIST = "ui-choice-list min-w-0 m-0 p-0 [border:0] list-none";

const LIST_LOOK = {
  plain: "flex gap-1",
  marked: "flex gap-1",
  pill: "flex flex-row flex-wrap gap-1.5",
  card: "flex gap-2",
} as const satisfies Record<ChoiceLook, string>;

const ROW =
  "ui-choice flex items-center gap-3 min-w-0 m-0 py-row-inset px-list-inset [border:0] rounded-control outline-offset-[calc(-1*var(--ui-focus-ring-width))] font-ui text-body text-left cursor-press transition-[--ui-choice-fill,background-color] duration-(--ui-duration-hover) ease-motion-exit";

const ROW_LOOK = {
  plain: "",
  marked: "",
  pill: "gap-icon-gap min-h-control py-1 px-3 rounded-[calc(var(--ui-control-height)/2)] text-caption leading-body",
  card: "p-0 flex-auto",
} as const satisfies Record<ChoiceLook, string>;

const ROW_ACROSS = "flex-[1_1_0] items-start";

const CONTROL =
  "ui-choice-control inline-grid flex-none place-items-center size-4 box-border border-[1.5px] border-solid transition-[background-color,border-color] duration-(--ui-duration-hover) ease-motion-exit";

const CONTROL_ACCENT_FILL = "border-accent-fill bg-accent-fill";

const CONTROL_TONE_FILL = "border-tone-ink bg-tone-ink";

const CONTROL_MARK = {
  radio: "after:size-1.5 after:rounded-[50%] after:content-['']",
  box: "after:w-2 after:h-1 after:mt-[-2px] after:border-b-2 after:border-l-2 after:[transform:rotate(-45deg)] after:content-['']",
} as const;

const CONTROL_INK = {
  radio: { accent: "after:bg-on-accent", toned: "after:bg-ground" },
  box: { accent: "after:border-on-accent", toned: "after:border-ground" },
} as const;

const CARD = "ui-choice-card flex flex-col gap-2 p-3 rounded-control";

const CARD_RING = {
  rest: "[box-shadow:inset_0_0_0_1px_var(--ui-color-border)]",
  picked: "[box-shadow:inset_0_0_0_1px_var(--ui-color-border-selected)]",
} as const;

export interface ChoiceOption<Value extends string> {
  value: Value;
  label: string;
  detail?: string | undefined;
  badge?: string | undefined;
  mark?: ReactNode;
  after?: ReactNode;
  aside?: ReactNode;
  below?: ReactNode;
  disabled?: boolean | undefined;
  tone?: StatusTone | undefined;
  replayMasked?: boolean | undefined;
}

interface ChoiceListBase<Value extends string> {
  legend: string;
  options: readonly ChoiceOption<Value>[];
  value: readonly Value[];
}

export interface ChoiceListOpen<Value extends string> extends ChoiceListBase<Value> {
  settled?: false | undefined;
  select?: ChoiceSelect | undefined;
  clearable?: boolean | undefined;
  disabled?: boolean | undefined;
  describedBy?: string | undefined;
  invalid?: boolean | undefined;
  required?: boolean | undefined;
  busy?: boolean | undefined;
  readOnly?: boolean | undefined;
  look?: ChoiceLook | undefined;
  numbered?: boolean | undefined;
  flow?: ChoiceFlow | undefined;
  focusRef?: React.RefObject<HTMLButtonElement | null> | undefined;
  onChange: (value: readonly Value[]) => void;
}

export interface ChoiceListSettled<Value extends string> extends ChoiceListBase<Value> {
  settled: true;
  pickedNote: ReactNode;
}

function PickedCheck({ className }: { className: string }): React.JSX.Element {
  return (
    <svg
      className={cn("ui-choice-check size-3 align-[-1px]", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4.8 12.6 9.6 17.3 19.2 6.9" />
    </svg>
  );
}

function afterPress<Value extends string>(
  props: ChoiceListOpen<Value>,
  pressed: Value,
): readonly Value[] | undefined {
  const { value, select = CHOICE_SELECT.ONE } = props;
  const checked = value.includes(pressed);
  if (select === CHOICE_SELECT.MANY) {
    return checked ? value.filter((each) => each !== pressed) : [...value, pressed];
  }
  if (!checked) return [pressed];
  return props.clearable === true ? [] : undefined;
}

function labelFlex(option: ChoiceOption<string>, look: ChoiceLook | undefined): string {
  if (look === CHOICE_LOOK.PILL) return "flex-initial";
  if (option.badge === undefined) return "flex-[1_1_0]";
  return look === CHOICE_LOOK.CARD ? "flex-[1_1_6em]" : "flex-[1_1_10em]";
}

function ChoiceWords({
  option,
  look,
  after,
  number,
}: {
  option: ChoiceOption<string>;
  look?: ChoiceLook | undefined;
  after?: ReactNode;
  number?: number | undefined;
}): React.JSX.Element {
  const hung = after ?? option.after;
  return (
    <span className={cn("ui-choice-words flex flex-auto flex-col gap-0.5 min-w-0")}>
      <span className="ui-choice-head flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <span
          className={cn(
            "ui-choice-label min-w-0 font-label wrap-anywhere",
            labelFlex(option, look),
          )}
        >
          <ReplayWords masked={option.replayMasked}>{option.label}</ReplayWords>
          {hung}
        </span>
        {option.badge === undefined && number === undefined ? null : (
          <span className="ui-choice-end inline-flex flex-none items-center gap-2">
            {option.badge === undefined ? null : (
              <span className="ui-choice-badge text-muted-foreground text-caption leading-body whitespace-nowrap">
                {option.badge}
              </span>
            )}
            {number === undefined ? null : (
              <span
                className="ui-choice-number min-w-[1ch] text-muted-foreground text-caption leading-body tabular-nums text-center"
                aria-hidden="true"
              >
                {number}
              </span>
            )}
          </span>
        )}
      </span>
      {option.detail === undefined ? null : (
        <span className="ui-choice-detail text-caption">
          <ReplayWords masked={option.replayMasked}>{option.detail}</ReplayWords>
        </span>
      )}
    </span>
  );
}

function ChoiceControl({
  radio,
  checked,
  tone,
  inCard,
}: {
  radio: boolean;
  checked: boolean;
  tone: StatusTone | undefined;
  inCard: boolean;
}): React.JSX.Element {
  const shape = radio ? "radio" : "box";
  const toned = tone !== undefined && tone !== STATUS_TONE.NEUTRAL;
  return (
    <span
      className={cn(
        CONTROL,
        radio ? "rounded-[50%]" : "rounded-choice-box",
        inCard
          ? "mt-0 self-center [:disabled>&]:opacity-disabled"
          : "self-start mt-[calc((var(--ui-type-body-leading)-var(--ui-space-16))/2)]",
        !checked && "border-muted-foreground",
        checked && (toned ? CONTROL_TONE_FILL : CONTROL_ACCENT_FILL),
        checked && CONTROL_MARK[shape],
        checked && CONTROL_INK[shape][toned ? "toned" : "accent"],
      )}
      data-shape={shape}
      aria-hidden="true"
    />
  );
}

function RowInside({
  radio,
  option,
  checked,
  look,
  number,
}: {
  radio: boolean;
  option: ChoiceOption<string>;
  checked: boolean;
  look: ChoiceLook;
  number: number | undefined;
}): React.JSX.Element {
  return (
    <>
      {look === CHOICE_LOOK.PILL ? (
        <PickedCheck className={cn("flex-none m-0", checked ? "block" : "hidden")} />
      ) : null}
      {look === CHOICE_LOOK.MARKED || look === CHOICE_LOOK.CARD ? (
        <ChoiceControl
          radio={radio}
          checked={checked}
          tone={option.tone}
          inCard={look === CHOICE_LOOK.CARD}
        />
      ) : null}
      {option.mark === undefined ? null : (
        <span
          className="ui-choice-mark inline-flex flex-none"
          {...(option.replayMasked === true ? REPLAY_MASKED : undefined)}
        >
          {option.mark}
        </span>
      )}
      <ChoiceWords option={option} look={look} number={number} />
    </>
  );
}

function ChoiceRow({
  radio,
  option,
  checked,
  tabStop,
  disabled,
  readOnly,
  dims,
  look,
  across,
  number,
  focusRef,
  onPress,
}: {
  radio: boolean;
  option: ChoiceOption<string>;
  checked: boolean;
  tabStop: boolean;
  disabled: boolean;
  readOnly: boolean;
  dims: boolean;
  look: ChoiceLook;
  across: boolean;
  number: number | undefined;
  focusRef: React.RefObject<HTMLButtonElement | null> | undefined;
  onPress: () => void;
}): React.JSX.Element {
  const card = look === CHOICE_LOOK.CARD;
  const attributes = {
    ref: focusRef,
    render: <button type="button" />,
    nativeButton: true,
    value: option.value,
    "data-value": option.value,
    inputRef: ignoredByReplay,
    ...rovingItem(),
    tabIndex: tabStop && !readOnly ? 0 : -1,
    className: cn(
      ROW,
      ROW_LOOK[look],
      across && !card && ROW_ACROSS,
      "disabled:cursor-default aria-disabled:cursor-default",
      dims && "disabled:opacity-disabled",
    ),
    "data-tone": option.tone,
    disabled,
    readOnly,
    "aria-disabled": readOnly || undefined,
    "aria-keyshortcuts": number === undefined ? undefined : String(number),
    onClick: (event: React.MouseEvent<HTMLElement> & { preventBaseUIHandler: () => void }) => {
      event.preventBaseUIHandler();
      if (readOnly) return;
      const control = event.currentTarget.querySelector<HTMLElement>(":scope > .ui-choice-control");
      pulsePress(control ?? event.currentTarget);
      onPress();
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement> & { preventBaseUIHandler: () => void }) => {
      if (event.key === "Enter") event.preventBaseUIHandler();
    },
    onFocus: (event: React.FocusEvent<HTMLElement> & { preventBaseUIHandler: () => void }) => {
      event.preventBaseUIHandler();
    },
  } as const;
  const inside = (
    <RowInside radio={radio} option={option} checked={checked} look={look} number={number} />
  );
  const row = radio ? (
    <Radio.Root {...attributes}>{inside}</Radio.Root>
  ) : (
    <Checkbox.Root {...attributes}>{inside}</Checkbox.Root>
  );
  if (!card) return row;
  return (
    <div
      className={cn(
        CARD,
        checked ? CARD_RING.picked : CARD_RING.rest,
        option.detail !== undefined && "opacity-55",
      )}
      data-checked={checked}
      data-unavailable={option.detail === undefined ? undefined : true}
    >
      <div className="ui-choice-card-head flex items-center justify-between gap-2">
        {row}
        {option.aside === undefined ? null : (
          <span className="ui-choice-aside text-caption-inline">{option.aside}</span>
        )}
      </div>
      {option.below === undefined || option.below === null ? null : (
        <div className="ui-choice-card-body flex flex-col gap-1.5">{option.below}</div>
      )}
    </div>
  );
}

function listClass(look: ChoiceLook, flow: ChoiceFlow): string {
  const down = look !== CHOICE_LOOK.PILL && flow === CHOICE_FLOW.DOWN;
  return cn(LIST, LIST_LOOK[look], down ? "flex-col" : "flex-row");
}

function OpenChoices<Value extends string>(props: ChoiceListOpen<Value>): React.JSX.Element {
  const {
    legend,
    options,
    value,
    disabled = false,
    readOnly = false,
    describedBy,
    invalid,
    required,
    busy,
    focusRef,
    select = CHOICE_SELECT.ONE,
    look = CHOICE_LOOK.PLAIN,
    numbered = false,
    flow = CHOICE_FLOW.DOWN,
  } = props;
  const one = select === CHOICE_SELECT.ONE;
  const still = disabled || readOnly;
  const open = options.filter((option) => option.disabled !== true);
  const landing = open.find((option) => value.includes(option.value)) ?? open[0];
  const roving = useRovingKeys<HTMLElement>({
    orientation: ROVING_ORIENTATION.BOTH,
    stop: one ? ROVING_STOP.CHOSEN : ROVING_STOP.NONE,
    moveTo: (row) => {
      row.focus();
      const landed = options.find((option) => option.value === row.dataset.value);
      if (one && landed !== undefined && !value.includes(landed.value)) {
        props.onChange([landed.value]);
      }
    },
  });
  const press = (pressed: Value) => {
    const next = afterPress(props, pressed);
    if (next !== undefined) props.onChange(next);
  };
  const onKeyDown = (
    event: React.KeyboardEvent<HTMLElement> & { preventBaseUIHandler: () => void },
  ) => {
    event.preventBaseUIHandler();
    if (!still) roving.onKeyDown(event);
  };
  const rows = options.map((option, index) => (
    <ChoiceRow
      key={option.value}
      radio={one}
      option={option}
      checked={value.includes(option.value)}
      tabStop={!one}
      disabled={disabled || option.disabled === true}
      readOnly={readOnly}
      dims={!readOnly && look !== CHOICE_LOOK.CARD}
      look={look}
      across={flow === CHOICE_FLOW.ACROSS}
      number={numbered && index < CHOICE_NUMBERED_ROWS ? index + 1 : undefined}
      focusRef={option === landing ? focusRef : undefined}
      onPress={() => press(option.value)}
    />
  ));
  const group = {
    "aria-label": legend,
    "aria-describedby": describedBy,
    "aria-invalid": invalid,
    "aria-required": required,
    "aria-busy": busy,
    className: listClass(look, flow),
    "data-flow": flow,
    "data-look": look,
    "data-read-only": readOnly || undefined,
  };
  if (!one) {
    return (
      <CheckboxGroup
        {...group}
        {...roving}
        render={<fieldset />}
        value={[...value]}
        onKeyDown={onKeyDown}
      >
        {rows}
      </CheckboxGroup>
    );
  }
  return (
    <RadioGroup
      {...group}
      value={value[0] ?? null}
      readOnly={readOnly || undefined}
      {...roving}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        event.preventBaseUIHandler();
        roving.onFocus(event);
      }}
    >
      {rows}
    </RadioGroup>
  );
}

function SettledChoices<Value extends string>({
  legend,
  options,
  value,
  pickedNote,
}: ChoiceListSettled<Value>): React.JSX.Element {
  return (
    <ul aria-label={legend} className={listClass(CHOICE_LOOK.PLAIN, CHOICE_FLOW.DOWN)}>
      {options.map((option) => {
        const picked = value.includes(option.value);
        return (
          <li key={option.value} className={ROW} data-picked={picked}>
            {option.mark === undefined ? null : (
              <span
                className="ui-choice-mark inline-flex flex-none"
                {...(option.replayMasked === true ? REPLAY_MASKED : undefined)}
              >
                {option.mark}
              </span>
            )}
            <ChoiceWords
              option={option}
              after={
                picked ? (
                  <span className="ui-choice-picked ml-2 text-muted-foreground text-caption leading-body font-caption whitespace-nowrap">
                    <PickedCheck className="mr-0.5" />
                    {pickedNote}
                  </span>
                ) : null
              }
            />
          </li>
        );
      })}
    </ul>
  );
}

export function ChoiceList<Value extends string>(
  props: ChoiceListOpen<Value> | ChoiceListSettled<Value>,
): React.JSX.Element {
  return props.settled === true ? <SettledChoices {...props} /> : <OpenChoices {...props} />;
}
