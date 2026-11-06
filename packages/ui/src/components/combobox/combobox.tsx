import type { ComponentPropsWithRef, ReactNode, Ref, RefObject } from "react";
import { useId, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { cn } from "../../cn.js";
import { CheckIcon, ChevronRightIcon } from "../../face/glyphs.js";
import { PRESS_PULSE, pulseOnPress } from "../../press-pulse.js";
import { REPLAY_MASKED, ReplayWords } from "../../session-replay-marks.js";
import {
  COMBOBOX_EMPTY,
  COMBOBOX_HEADING,
  COMBOBOX_ITEM,
  COMBOBOX_ITEM_DETAIL,
  COMBOBOX_ITEM_END,
  COMBOBOX_ITEM_GLYPH,
  COMBOBOX_ITEM_HINT,
  COMBOBOX_ITEM_LABEL,
  COMBOBOX_ITEM_LEAD,
  COMBOBOX_LIST,
  COMBOBOX_WELL,
} from "../../shadcn/combobox.js";
import { INPUT_CONTROL, INPUT_FIELD } from "../../shadcn/input.js";
import { ANNOUNCE, useAnnounce } from "../announcer/announcer.js";
import { OneLine } from "../one-line/one-line.js";
import { SCROLL_FADE, type ScrollFade, scrollFadeMarks } from "../scroll-area/scroll-area.js";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";
import { Tooltip } from "../tooltip/hint.js";
import {
  VIRTUAL_ROWS_ANCHOR,
  type VirtualRowPlace,
  VirtualRows,
  type VirtualRowsHandle,
} from "../virtual-rows/virtual-rows.js";
import { type ComboboxField, useComboboxField } from "./use-combobox-field.js";

export const COMBOBOX_LIST_HEIGHT = {
  CAPPED: "capped",
  FILL: "fill",
} as const;

export type ComboboxListHeight = (typeof COMBOBOX_LIST_HEIGHT)[keyof typeof COMBOBOX_LIST_HEIGHT];

const OPTION_ESTIMATE_PX = 32;

export const COMBOBOX_LEAD = {
  KEY: "key",
  FACES: "faces",
} as const;

export type ComboboxLead = (typeof COMBOBOX_LEAD)[keyof typeof COMBOBOX_LEAD];

const LEAD_WIDTH: Record<ComboboxLead, string> = {
  [COMBOBOX_LEAD.KEY]: "min-w-combobox-lead",
  [COMBOBOX_LEAD.FACES]: "min-w-combobox-faces",
};

export interface ComboboxOption {
  readonly id: string;
  readonly label: ReactNode;
  readonly words?: string | undefined;
  readonly lead?: ReactNode;
  readonly leadWidth?: ComboboxLead | undefined;
  readonly icon?: ReactNode;
  readonly detail?: ReactNode;
  readonly replayMasked?: boolean | undefined;
  readonly detailWords?: string | undefined;
  readonly hint?: ReactNode;
  readonly opens?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly current?: boolean | undefined;
  readonly card?: ReactNode;
}

export interface ComboboxGroup {
  readonly label?: string | undefined;
  readonly replayUnmasked?: boolean | undefined;
  readonly options: readonly ComboboxOption[];
}

export type ComboboxOptionEngineProps = Omit<
  ComponentPropsWithRef<"div">,
  "className" | "style" | "children"
>;

export function ComboboxOptionItem({
  option,
  place,
  ...engine
}: {
  option: ComboboxOption;
  place?: VirtualRowPlace | undefined;
} & ComboboxOptionEngineProps): React.JSX.Element {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the field or the engine reads the keys and names this option active.
    <div
      role="option"
      tabIndex={-1}
      aria-disabled={option.disabled === true ? "true" : undefined}
      aria-current={option.current === true ? "true" : undefined}
      {...place}
      {...engine}
      onClick={
        option.disabled === true ? undefined : pulseOnPress(engine.onClick, PRESS_PULSE.QUIET)
      }
      {...(option.replayMasked === true ? REPLAY_MASKED : undefined)}
      className={cn("ui-combobox-option", COMBOBOX_ITEM)}
      style={place?.style}
    >
      {option.lead === undefined ? null : (
        <span
          className={cn(
            "ui-combobox-option-lead",
            COMBOBOX_ITEM_LEAD,
            LEAD_WIDTH[option.leadWidth ?? COMBOBOX_LEAD.KEY],
          )}
        >
          {option.lead}
        </span>
      )}
      {option.icon === undefined ? null : (
        <span className={cn("ui-combobox-option-glyph", COMBOBOX_ITEM_GLYPH)}>{option.icon}</span>
      )}
      <span className={cn("ui-combobox-option-label", COMBOBOX_ITEM_LABEL)}>
        <OneLine words={typeof option.label === "string" ? undefined : option.words}>
          {option.label}
        </OneLine>
      </span>
      {option.detail === undefined ? null : (
        <span className={cn("ui-combobox-option-detail", COMBOBOX_ITEM_DETAIL, "ml-auto")}>
          <OneLine words={option.detailWords}>{option.detail}</OneLine>
        </span>
      )}
      {option.hint === undefined ? null : (
        <span
          className={cn(
            "ui-combobox-option-hint",
            COMBOBOX_ITEM_HINT,
            option.detail === undefined && "ml-auto",
          )}
        >
          {option.hint}
        </span>
      )}
      {option.opens === true || option.current === true ? (
        <span
          className={cn(
            "ui-combobox-option-end",
            COMBOBOX_ITEM_END,
            option.detail === undefined && option.hint === undefined && "ml-auto",
          )}
        >
          {option.opens === true ? <ChevronRightIcon /> : <CheckIcon />}
        </span>
      ) : null}
    </div>
  );
}

function OptionRow({
  id,
  place,
  option,
  active,
  onActive,
  onChoose,
}: {
  id: string;
  place: VirtualRowPlace;
  option: ComboboxOption;
  active: boolean;
  onActive: () => void;
  onChoose: () => void;
}): React.JSX.Element {
  const row = (
    <ComboboxOptionItem
      place={place}
      id={id}
      option={option}
      aria-selected={active}
      onMouseMove={active || option.disabled === true ? undefined : onActive}
      onClick={option.disabled === true ? undefined : onChoose}
    />
  );
  if (option.card === undefined) return row;
  return (
    <Tooltip
      label={option.words ?? (typeof option.label === "string" ? option.label : undefined)}
      card={option.card}
      cardBeside
    >
      {row}
    </Tooltip>
  );
}

export function comboboxOptionId(listId: string, index: number): string {
  return `${listId}-option-${index}`;
}

export function ComboboxListBox({
  height = COMBOBOX_LIST_HEIGHT.CAPPED,
  children,
  ...engine
}: {
  height?: ComboboxListHeight | undefined;
  children?: ReactNode;
} & ComboboxOptionEngineProps): React.JSX.Element {
  const fade = scrollFadeMarks(SCROLL_FADE.BOTH);
  return (
    <div
      role="listbox"
      tabIndex={-1}
      {...engine}
      {...fade}
      className={cn("ui-combobox-list", fade.className, COMBOBOX_LIST)}
      style={undefined}
      data-slot="combobox-list"
      data-height={height}
    >
      {children}
    </div>
  );
}

export function ComboboxList({
  id,
  label,
  groups,
  active,
  onActiveChange,
  onChoose,
  headed = true,
  empty,
  note,
  steer,
  fade = SCROLL_FADE.BOTH,
  ref,
}: {
  id?: string | undefined;
  label: string;
  groups: readonly ComboboxGroup[];
  active: number;
  onActiveChange: (active: number) => void;
  onChoose: (index: number, option: ComboboxOption) => void;
  headed?: boolean | undefined;
  empty?: string | undefined;
  note?: ReactNode;
  steer?: ComboboxField | undefined;
  fade?: ScrollFade | undefined;
  ref?: Ref<HTMLDivElement> | undefined;
}): React.JSX.Element {
  const minted = useId();
  const listId = id ?? minted;
  const list = useRef<HTMLDivElement>(null);
  useImperativeHandle<HTMLDivElement | null, HTMLDivElement | null>(ref, () => list.current, []);
  const runsBox = useRef<HTMLDivElement>(null);
  const runs = useRef<RefObject<VirtualRowsHandle | null>[]>([]);
  const runOf = (group: number): RefObject<VirtualRowsHandle | null> => {
    const held = runs.current[group];
    if (held !== undefined) return held;
    const made: RefObject<VirtualRowsHandle | null> = { current: null };
    runs.current[group] = made;
    return made;
  };
  const options = groups.flatMap((group) => group.options);
  useAnnounce(ANNOUNCE.POLITE, options.length === 0 ? (empty ?? "") : "");
  const at = active >= 0 && active < options.length ? active : -1;
  const choose = (index: number) => {
    const option = options[index];
    if (option !== undefined) onChoose(index, option);
  };

  const pointed = useRef(false);
  useLayoutEffect(() => {
    if (pointed.current) {
      pointed.current = false;
      return;
    }
    const box = list.current;
    const row = at < 0 ? null : document.getElementById(comboboxOptionId(listId, at));
    if (box === null || at < 0) return;
    if (row === null) {
      bringIn(at);
      return;
    }
    const clear = getComputedStyle(box);
    const top = row.offsetTop - (Number.parseFloat(clear.scrollPaddingTop) || 0);
    if (top < box.scrollTop) box.scrollTop = top;
    const bottom =
      row.offsetTop +
      row.offsetHeight +
      (Number.parseFloat(clear.scrollPaddingBottom) || 0) -
      box.clientHeight;
    if (bottom > box.scrollTop) box.scrollTop = bottom;
  });

  const marks = scrollFadeMarks(fade);
  let offset = 0;
  const placed = groups.map((group) => {
    const start = offset;
    offset += group.options.length;
    return { group, start };
  });
  const bringIn = (index: number) => {
    const run = placed.findLastIndex(({ start }) => start <= index);
    const entry = placed[run];
    const option = entry?.group.options[index - (entry?.start ?? 0)];
    if (option !== undefined) runOf(run).current?.bringIn(option.id);
  };

  return (
    <div
      ref={list}
      id={listId}
      {...marks}
      className={cn("ui-combobox-list", marks.className, COMBOBOX_LIST)}
      data-slot="combobox-list"
      role="listbox"
      aria-label={label}
      aria-activedescendant={steer?.field["aria-activedescendant"]}
      tabIndex={steer === undefined ? undefined : -1}
      onKeyDown={steer?.onKeyDown}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div ref={runsBox}>
        {placed.map(({ group, start }, run) => {
          const rows = (
            <VirtualRows
              key={start}
              scroller={list}
              shiftedBy={runsBox}
              keys={group.options.map((option) => option.id)}
              estimate={OPTION_ESTIMATE_PX}
              anchor={VIRTUAL_ROWS_ANCHOR.START}
              options
              handle={runOf(run)}
            >
              {(index, place) => {
                const option = group.options[index];
                return option === undefined ? null : (
                  <OptionRow
                    id={comboboxOptionId(listId, start + index)}
                    place={place}
                    option={option}
                    active={start + index === at}
                    onActive={() => {
                      pointed.current = true;
                      onActiveChange(start + index);
                    }}
                    onChoose={() => choose(start + index)}
                  />
                );
              }}
            </VirtualRows>
          );
          if (group.label === undefined) return rows;
          return (
            // biome-ignore lint/a11y/useSemanticElements: a listbox's section is a group of options, which a <fieldset> of form controls is not.
            <div key={start} role="group" aria-label={group.label}>
              {headed ? (
                <Text
                  as={TEXT_ELEMENT.DIV}
                  variant={TEXT_VARIANT.GROUP}
                  className={cn("ui-combobox-heading", COMBOBOX_HEADING)}
                  aria-hidden="true"
                >
                  <ReplayWords unmasked={group.replayUnmasked}>{group.label}</ReplayWords>
                </Text>
              ) : null}
              {rows}
            </div>
          );
        })}
      </div>
      {options.length === 0 && empty !== undefined ? (
        <p className={cn("ui-combobox-empty", COMBOBOX_EMPTY)}>{empty}</p>
      ) : null}
      {note === undefined || note === null ? null : (
        <div className={cn("ui-combobox-note", COMBOBOX_EMPTY, "flex-col gap-ui-4")}>{note}</div>
      )}
    </div>
  );
}

export function Combobox({
  label,
  listLabel,
  value,
  onChange,
  groups,
  open,
  active,
  onActiveChange,
  onChoose,
  onEnter,
  onEscape,
  placeholder,
  disabled,
  maxLength,
  spellCheck,
  keyShortcuts,
  ref,
}: {
  label: string;
  listLabel: string;
  value: string;
  onChange: (value: string) => void;
  groups: readonly ComboboxGroup[];
  open: boolean;
  active: number;
  onActiveChange: (active: number) => void;
  onChoose: (index: number, option: ComboboxOption) => void;
  onEnter?: (() => void) | undefined;
  onEscape?: (() => void) | undefined;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  maxLength?: number | undefined;
  spellCheck?: boolean | undefined;
  keyShortcuts?: string | undefined;
  ref?: Ref<HTMLInputElement> | undefined;
}): React.JSX.Element {
  const listId = useId();
  const options = groups.flatMap((group) => group.options);
  const shown = open && options.length > 0;
  const at = Math.min(Math.max(active, 0), options.length - 1);
  const choose = (index: number) => {
    const option = options[index];
    if (option !== undefined) onChoose(index, option);
  };

  const keys = useComboboxField({
    open: shown,
    active: at,
    count: options.length,
    controls: listId,
    activeId: comboboxOptionId(listId, at),
    onActiveChange,
    onChoose: choose,
    onEnter,
    onEscape,
  });

  return (
    <div className={cn("ui-combobox", COMBOBOX_WELL)} data-open={shown}>
      <input
        ref={ref}
        type="text"
        className={cn(INPUT_FIELD, INPUT_CONTROL, shown && "rounded-b-none")}
        {...keys.field}
        aria-label={label}
        aria-keyshortcuts={keyShortcuts}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={spellCheck}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={keys.onKeyDown}
      />
      {shown ? (
        <ComboboxList
          id={listId}
          label={listLabel}
          groups={groups}
          active={at}
          onActiveChange={onActiveChange}
          onChoose={onChoose}
          fade={SCROLL_FADE.NONE}
        />
      ) : null}
    </div>
  );
}
