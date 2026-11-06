import {
  type DateSpan,
  type DateWall,
  type DateWallMoment,
  dateLabel,
  dateOfWall,
  dateOfWords,
  dateToday,
  dateWall,
  readerZone,
} from "@repo/features/date-mention";
import { encodeMention, MENTION_KIND, type MentionPlace } from "@repo/features/mention-link";
import {
  ALIGN,
  BUTTON_VARIANT,
  Button,
  Calendar,
  CHIP_LOOK,
  CHIP_WIDTH,
  Chip,
  ChipName,
  DIALOG_TONE,
  DialogActions,
  type FieldControl,
  FormField,
  GAP,
  Inline,
  JUSTIFY,
  type MenuRow,
  POPOVER_WIDTH,
  PopoverPanel,
  RectFloat,
  SEARCHABLE_MENU_LAYER,
  SETTINGS_ROW_DENSITY,
  SearchableMenu,
  SettingsRow,
  Stack,
  TEXT_FIELD_TYPE,
  TextField,
  useMinute,
} from "@repo/ui";
import { inputProblem } from "@repo/ui/reported-failure";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { type ReactNode, type RefObject, useEffect, useId, useMemo, useRef, useState } from "react";
import type { MentionNode } from "../description-editor/contract.js";
import { SwitchRow } from "../settings/switch-row.js";

const TIME_ZONES = Intl.supportedValuesOf("timeZone");

const DATE_PICKER_PAGE = {
  DATE: "date",
  ZONE: "zone",
} as const;

type DatePickerPage = (typeof DATE_PICKER_PAGE)[keyof typeof DATE_PICKER_PAGE];

export const DATE_PICKER_CLOSE = {
  KEY: "key",
  LEAVE: "leave",
  CLEAR: "clear",
  CONFIRM: "confirm",
} as const;

type DatePickerClose = (typeof DATE_PICKER_CLOSE)[keyof typeof DATE_PICKER_CLOSE];

export interface DatePicked {
  readonly date: DateSpan | undefined;
  readonly zone: string;
  readonly zonePicked: boolean;
  readonly changed: boolean;
  readonly how: DatePickerClose;
}

type DatePickerAnchor =
  | Element
  | { readonly left: number; readonly top: number; readonly bottom: number };

export interface DatePickerMoment {
  readonly title: string;
  readonly verb: string;
}

export interface DatePickerOpening {
  readonly at: DatePickerAnchor;
  readonly date: DateSpan | undefined;
  readonly moment?: DatePickerMoment | undefined;
  readonly onClose: (picked: DatePicked) => void;
}

export interface DatePicker {
  readonly popover: ReactNode;
  readonly open: (opening: DatePickerOpening) => void;
}

const DEFAULT_TIME = { START: "09:00", END: "10:00" } as const;

const LAST_HOUR = 23;

const WORDS = {
  TITLE: "Date",
  START_DATE: "Start",
  END_DATE: "End",
  DATE: "Date",
  UNREAD: "Write a date, such as Oct 24.",
  END: "End date",
  TIME: "Include time",
  ZONE: "Time zone",
  ZONE_SEARCH: "Search time zones",
  ZONE_NO_MATCH: "No time zones match",
  START_TIME: "Start time",
  END_TIME: "End time",
  MOMENT_TIME: "Time",
  CLEAR: "Clear",
  CLOSE: "Close",
} as const;

const DATE_END = {
  START: "start",
  END: "end",
} as const;

type DateEnd = (typeof DATE_END)[keyof typeof DATE_END];

interface Typing {
  readonly end: DateEnd;
  readonly words: string;
  readonly invalid: boolean;
}

interface Draft {
  readonly wall: DateWall;
  readonly pickingEnd: boolean;
  readonly typing: Typing | undefined;
  readonly changed: boolean;
}

const LAST_DAY = "9999-12-31";

function dayAfter(day: string): string | undefined {
  if (day >= LAST_DAY) return undefined;
  const next = new Date(`${day}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function endAfter(start: DateWallMoment): DateWallMoment | undefined {
  if (start.time === undefined) {
    const day = dayAfter(start.day);
    return day === undefined ? undefined : { day };
  }
  const [hour = "0", minute = "00"] = start.time.split(":");
  const next = Number(hour) + 1;
  if (next <= LAST_HOUR)
    return { day: start.day, time: `${String(next).padStart(2, "0")}:${minute}` };
  const day = dayAfter(start.day);
  return day === undefined ? undefined : { day, time: `00:${minute}` };
}

function changedTo(wall: DateWall, pickingEnd: boolean): Draft {
  return { wall, pickingEnd, typing: undefined, changed: true };
}

function orderOf(moment: DateWallMoment): string {
  return `${moment.day}T${moment.time ?? ""}`;
}

function dayPicked(draft: Draft, day: string): Draft {
  const { start, end } = draft.wall;
  if (end === undefined) return changedTo({ start: { ...start, day } }, false);
  if (draft.pickingEnd) {
    if (day < start.day) {
      return changedTo({ start: { ...start, day }, end: { ...end, day: start.day } }, false);
    }
    const picked = { ...end, day };
    if (orderOf(picked) === orderOf(start)) return changedTo({ start }, false);
    const wall =
      orderOf(picked) < orderOf(start) ? { start: picked, end: start } : { start, end: picked };
    return changedTo(wall, false);
  }
  const moved = { ...start, day };
  const kept = { ...end, day: day > end.day ? day : end.day };
  const after = orderOf(moved) < orderOf(kept) ? kept : endAfter(moved);
  return changedTo({ start: moved, end: after }, after !== undefined);
}

function ordered(wall: DateWall): DateWall {
  const { start, end } = wall;
  if (end === undefined || orderOf(start) < orderOf(end)) return wall;
  if (orderOf(end) < orderOf(start)) return { start: end, end: start };
  return { start, end: endAfter(start) };
}

function typedInto(draft: Draft, which: DateEnd, moment: DateWallMoment): Draft {
  const { start, end } = draft.wall;
  const timed = start.time !== undefined || moment.time !== undefined;
  const timeOf = (was: DateWallMoment, fallback: string) =>
    timed ? (was.time ?? fallback) : undefined;
  const typed = (was: DateWallMoment, fallback: string) => ({
    day: moment.day,
    time: moment.time ?? timeOf(was, fallback),
  });
  const kept = (was: DateWallMoment, fallback: string) => ({
    day: was.day,
    time: timeOf(was, fallback),
  });
  const wall =
    which === DATE_END.START
      ? { start: typed(start, DEFAULT_TIME.START), end: end && kept(end, DEFAULT_TIME.END) }
      : { start: kept(start, DEFAULT_TIME.START), end: end && typed(end, DEFAULT_TIME.END) };
  return changedTo(ordered(wall), false);
}

function wordsRead(
  draft: Draft,
  now: number,
  zone: string,
  single: boolean,
): { readonly draft: Draft; readonly day: string } | undefined {
  const { typing } = draft;
  if (typing === undefined) return { draft, day: draft.wall.start.day };
  const named = dateOfWords(typing.words, now, zone);
  const wall = named === undefined ? undefined : dateWall(named, zone);
  if (wall === undefined) return undefined;
  if (wall.end !== undefined && !single)
    return { draft: changedTo(wall, false), day: wall.start.day };
  return { draft: typedInto(draft, typing.end, wall.start), day: wall.start.day };
}

function endSwitched(draft: Draft, on: boolean): Draft {
  const { start } = draft.wall;
  if (!on) return changedTo({ start }, false);
  const end = endAfter(start);
  return end === undefined ? draft : changedTo({ start, end }, true);
}

function timeSwitched(draft: Draft, on: boolean): Draft {
  const { start, end } = draft.wall;
  const timed = (moment: DateWallMoment, time: string) => ({
    day: moment.day,
    time: on ? time : undefined,
  });
  return changedTo(
    {
      start: timed(start, DEFAULT_TIME.START),
      end: end === undefined ? undefined : timed(end, DEFAULT_TIME.END),
    },
    draft.pickingEnd,
  );
}

function zoneLabel(zone: string): string {
  return zone.replaceAll("_", " ");
}

function zonePlace(zone: string): string {
  return zoneLabel(zone.slice(zone.lastIndexOf("/") + 1));
}

function zoneOffset(zone: string, now: number): string | undefined {
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
    .formatToParts(now)
    .find((part) => part.type === "timeZoneName")?.value;
}

function zoneRows(zone: string, now: number): MenuRow[] {
  const zones = TIME_ZONES.includes(zone) ? TIME_ZONES : [zone, ...TIME_ZONES];
  return zones.map((each) => {
    const offset = zoneOffset(each, now);
    return {
      id: each,
      label: zoneLabel(each),
      ...(offset === undefined ? undefined : { detail: offset, terms: [offset] }),
    };
  });
}

export function dateMentionNode(
  date: DateSpan,
  place: MentionPlace,
  zone: string = readerZone(),
): MentionNode {
  return {
    name: dateLabel(date, zone),
    target: encodeMention({ kind: MENTION_KIND.DATE, ...date }, place),
  };
}

function dayWords(moment: DateWallMoment): string {
  return dateLabel({ start: moment.day });
}

function TimeField({
  label,
  time,
  onChange,
}: {
  label: string;
  time: string | undefined;
  onChange: (time: string) => void;
}): React.JSX.Element {
  return (
    <TextField
      type={TEXT_FIELD_TYPE.TIME}
      label={label}
      value={time ?? ""}
      onChange={(next) => {
        if (next !== "") onChange(next);
      }}
    />
  );
}

function openingWall(
  date: DateSpan | undefined,
  zone: string,
  today: string,
  single: boolean,
): DateWall {
  const wall = (date === undefined ? undefined : dateWall(date, zone)) ?? { start: { day: today } };
  if (!single) return wall;
  return { start: { day: wall.start.day, time: wall.start.time ?? DEFAULT_TIME.START } };
}

function DatePickerPanel({
  open,
  date,
  moment,
  onClose,
  onExited,
}: {
  open: boolean;
  date: DateSpan | undefined;
  moment: DatePickerMoment | undefined;
  onClose: (picked: DatePicked) => void;
  onExited: () => void;
}): React.JSX.Element | null {
  const single = moment !== undefined;
  const now = useMinute();
  const chosenZone = useRef(readerZone());
  const [zone, setZone] = useState(chosenZone.current);
  const [page, setPage] = useState<DatePickerPage>(DATE_PICKER_PAGE.DATE);
  const turning = useRef(false);
  const [from, setFrom] = useState<DatePickerPage | undefined>(undefined);
  const zoneMenu = useRef<HTMLElement | null>(null);
  const zoneField = useRef<HTMLButtonElement>(null);
  const zoneMenuId = useId();
  const today = dateToday(now, zone) ?? new Date(now).toISOString().slice(0, 10);
  const field = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const [draft, setDraft] = useState<Draft>(() => ({
    wall: openingWall(date, zone, today, single),
    pickingEnd: false,
    typing: undefined,
    changed: false,
  }));
  const latest = useRef(draft);
  const [month, setMonth] = useState(() => draft.wall.start.day.slice(0, 7));
  const { start, end } = draft.wall;
  const timed = start.time !== undefined;

  const update = (next: Draft) => {
    latest.current = next;
    setDraft(next);
  };
  const finish = (how: DatePickerClose) => {
    if (done.current) return;
    done.current = true;
    const at = chosenZone.current;
    const closing = wordsRead(latest.current, Date.now(), at, single)?.draft ?? latest.current;
    onClose({
      date: dateOfWall(closing.wall, at),
      zone: at,
      zonePicked: at !== readerZone(),
      changed: closing.changed,
      how,
    });
  };
  const leave = () => {
    if (!turning.current) finish(DATE_PICKER_CLOSE.LEAVE);
  };
  const turnTo = (next: DatePickerPage) => {
    turning.current = true;
    setFrom(page);
    setPage(next);
  };
  const zonePicked = (picked: string) => {
    if (picked !== chosenZone.current) {
      chosenZone.current = picked;
      setZone(picked);
      update(changedTo(latest.current.wall, latest.current.pickingEnd));
    }
    turnTo(DATE_PICKER_PAGE.DATE);
  };
  useEffect(() => {
    turning.current = false;
  }, [page]);
  useEffect(() => {
    if (!open && page === DATE_PICKER_PAGE.ZONE) onExited();
  }, [open, page, onExited]);
  const zones = useMemo(
    () => (page === DATE_PICKER_PAGE.ZONE ? zoneRows(zone, now) : []),
    [page, zone, now],
  );
  const read = (): boolean => {
    const typing = latest.current.typing;
    if (typing === undefined) return true;
    const next = wordsRead(latest.current, Date.now(), chosenZone.current, single);
    if (next === undefined) {
      update({ ...latest.current, typing: { ...typing, invalid: true } });
      return false;
    }
    update(next.draft);
    setMonth(next.day.slice(0, 7));
    return true;
  };
  const dateField = (which: DateEnd, moment: DateWallMoment, control: FieldControl) => {
    const typing = draft.typing?.end === which ? draft.typing : undefined;
    return (
      <TextField
        ref={which === DATE_END.START ? field : undefined}
        field={control}
        value={typing?.words ?? dayWords(moment)}
        spellCheck={false}
        onChange={(words) =>
          update({ ...latest.current, typing: { end: which, words, invalid: false } })
        }
        onBlur={() => {
          read();
        }}
        onEnter={() => {
          if (read()) finish(single ? DATE_PICKER_CLOSE.CONFIRM : DATE_PICKER_CLOSE.KEY);
        }}
      />
    );
  };
  const endField = (which: DateEnd, moment: DateWallMoment) => (
    <FormField
      label={single ? WORDS.DATE : which === DATE_END.START ? WORDS.START_DATE : WORDS.END_DATE}
      error={
        draft.typing?.end === which && draft.typing.invalid ? inputProblem(WORDS.UNREAD) : undefined
      }
    >
      {(control) =>
        timed ? (
          <Inline gap={GAP.CONTROL} wrap={false}>
            {dateField(which, moment, control)}
            {timeField(which, moment)}
          </Inline>
        ) : (
          dateField(which, moment, control)
        )
      }
    </FormField>
  );
  const timeField = (which: DateEnd, moment: DateWallMoment) => (
    <TimeField
      label={
        single ? WORDS.MOMENT_TIME : which === DATE_END.START ? WORDS.START_TIME : WORDS.END_TIME
      }
      time={moment.time}
      onChange={(time) => {
        const wall =
          which === DATE_END.START
            ? { start: { ...start, time }, end }
            : { start, end: end && { ...end, time } };
        update(changedTo(wall, draft.pickingEnd));
      }}
    />
  );

  if (page === DATE_PICKER_PAGE.ZONE) {
    if (!open) return null;
    return (
      <SearchableMenu
        replayUnmasked
        id={zoneMenuId}
        ref={(element) => {
          zoneMenu.current = element;
        }}
        label={WORDS.ZONE}
        placeholder={WORDS.ZONE_SEARCH}
        rows={zones}
        value={zone}
        noMatch={WORDS.ZONE_NO_MATCH}
        layer={SEARCHABLE_MENU_LAYER.EMBEDDED}
        onPick={zonePicked}
        onClose={() => turnTo(DATE_PICKER_PAGE.DATE)}
        onLeave={(left) => {
          if (!(left instanceof Node && zoneMenu.current?.contains(left))) leave();
        }}
      />
    );
  }

  return (
    <PopoverPanel
      open={open}
      title={moment?.title ?? WORDS.TITLE}
      replayUnmasked
      closeLabel={WORDS.CLOSE}
      initialFocus={from === DATE_PICKER_PAGE.ZONE ? zoneField : field}
      onDismiss={() => finish(DATE_PICKER_CLOSE.KEY)}
      onLeave={leave}
      onExited={onExited}
    >
      <ReplayUnmask>
        <Stack gap={GAP.TIGHT}>
          {timed ? (
            <>
              {endField(DATE_END.START, start)}
              {end === undefined ? null : endField(DATE_END.END, end)}
            </>
          ) : (
            <Inline gap={GAP.CONTROL} align={ALIGN.START} wrap={false}>
              {endField(DATE_END.START, start)}
              {end === undefined ? null : endField(DATE_END.END, end)}
            </Inline>
          )}
        </Stack>
        <Calendar
          month={month}
          today={today}
          start={start.day}
          end={end?.day}
          onPick={(day) => {
            update(dayPicked(latest.current, day));
            setMonth(day.slice(0, 7));
          }}
          onShowMonth={setMonth}
        />
        <Stack gap={GAP.TIGHT}>
          {single ? null : (
            <>
              <SwitchRow
                density={SETTINGS_ROW_DENSITY.COMPACT}
                label={WORDS.END}
                labelReplayUnmasked
                checked={end !== undefined}
                onChange={(on) => update(endSwitched(latest.current, on))}
              />
              <SwitchRow
                density={SETTINGS_ROW_DENSITY.COMPACT}
                label={WORDS.TIME}
                labelReplayUnmasked
                checked={timed}
                onChange={(on) => update(timeSwitched(latest.current, on))}
              />
            </>
          )}
          {timed ? (
            <SettingsRow density={SETTINGS_ROW_DENSITY.COMPACT} label={WORDS.ZONE}>
              {(control) => (
                <Chip
                  ref={zoneField}
                  look={CHIP_LOOK.FIELD}
                  width={CHIP_WIDTH.AUTO}
                  chevron
                  aria-label={`${WORDS.ZONE}: ${zoneLabel(zone)}`}
                  aria-describedby={control["aria-describedby"]}
                  aria-haspopup="dialog"
                  onClick={() => turnTo(DATE_PICKER_PAGE.ZONE)}
                >
                  <ChipName>{zonePlace(zone)}</ChipName>
                </Chip>
              )}
            </SettingsRow>
          ) : null}
        </Stack>
        {moment === undefined ? (
          <div className="-mx-ui-16 mt-0 -mb-ui-8 border-t border-border px-row-inset pt-tight-gap pb-0">
            <Button variant={BUTTON_VARIANT.ROW} onClick={() => finish(DATE_PICKER_CLOSE.CLEAR)}>
              {WORDS.CLEAR}
            </Button>
          </div>
        ) : (
          <Inline gap={GAP.CONTROL} justify={JUSTIFY.END}>
            <DialogActions
              onCancel={() => finish(DATE_PICKER_CLOSE.KEY)}
              act={{
                verb: moment.verb,
                tone: DIALOG_TONE.PRIMARY,
                running: moment.verb,
                onPress: () => {
                  if (read()) finish(DATE_PICKER_CLOSE.CONFIRM);
                },
              }}
            />
          </Inline>
        )}
      </ReplayUnmask>
    </PopoverPanel>
  );
}

function boxOf(
  at: DatePickerAnchor,
):
  | { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
  | undefined {
  if (!(at instanceof Element)) return { ...at, right: at.left };
  return at.isConnected ? at.getBoundingClientRect() : undefined;
}

export function useDatePicker(room: RefObject<HTMLElement | null>): DatePicker {
  const [opened, setOpened] = useState<
    | { readonly opening: DatePickerOpening; readonly key: number; readonly standing: boolean }
    | undefined
  >(undefined);
  const counted = useRef(0);
  const open = (opening: DatePickerOpening) => {
    if (room.current === null) return;
    counted.current += 1;
    setOpened({ opening, key: counted.current, standing: true });
  };
  const popover =
    opened === undefined ? null : (
      <RectFloat open anchor={() => boxOf(opened.opening.at)} width={POPOVER_WIDTH.NARROW}>
        <DatePickerPanel
          key={opened.key}
          open={opened.standing}
          date={opened.opening.date}
          moment={opened.opening.moment}
          onClose={(picked) => {
            setOpened((was) => (was?.key === opened.key ? { ...was, standing: false } : was));
            opened.opening.onClose(picked);
          }}
          onExited={() =>
            setOpened((was) => (was?.key === opened.key && !was.standing ? undefined : was))
          }
        />
      </RectFloat>
    );
  return { popover, open };
}
