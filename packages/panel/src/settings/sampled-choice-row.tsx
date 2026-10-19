/**
 * sampled-choice-row.tsx -- a settings choice whose every value is heard, chosen in a dialog where each is played as it is picked.
 *
 * A voice is told apart by ear, which a pop-up only allows one open-pick-close
 * at a time, so the row is a chip naming the chosen value that opens a dialog
 * of them all instead: grouped under their headings, each a marked row of
 * `@luke/ui`'s `ChoiceList` with its line of detail, and a pick plays the value's
 * clip at once, a press on the picked row plays it again, and the arrow keys
 * pick and play as they walk. Nothing is written while the dialog stands:
 * Done keeps the value picked, which is the one write (choosing a voice ends
 * the conversation in progress, so browsing must not), and Cancel, Escape,
 * or a press beside the card keep the value as it stood. The clip stops as
 * the dialog closes, however it closes. A play button at the dialog's foot
 * plays the picked value again, or stops whatever clip is playing.
 */

import { searchAnchorProps } from "@luke/settings/settings-anchors";
import {
  BUTTON_VARIANT,
  Button,
  CHIP_LOOK,
  CHIP_WIDTH,
  CHOICE_LOOK,
  Chip,
  ChipName,
  ChoiceList,
  DIALOG_SIZE,
  Dialog,
  IconButton,
  PlayIcon,
  SCROLL_SIZE,
  ScrollArea,
  SettingsRow,
  StopIcon,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { useSettingWrite } from "@luke/ui/use-setting-write";
import type { ActionResult } from "@luke/wire";
import { useRef, useState } from "react";
import { Tooltip } from "../tooltip.js";
import { ChangedMark } from "./marks.js";
import { type SamplePlayer, useSamplePlayer } from "./sample-player.js";

/** Each value's token, its name, the path of its clip, and where it has them, its heading and its line of detail. */
export interface SampledChoiceOption {
  value: string;
  label: string;
  sample: string;
  group?: string | undefined;
  detail?: string | undefined;
}

/** A run of options under one heading, in the order they stand. */
interface OptionGroup {
  heading: string | undefined;
  options: SampledChoiceOption[];
}

/** The options as the runs that share a heading, each run where its first member stands. */
function grouped(options: readonly SampledChoiceOption[]): OptionGroup[] {
  const groups: OptionGroup[] = [];
  for (const option of options) {
    const last = groups.at(-1);
    if (last !== undefined && last.heading === option.group) last.options.push(option);
    else groups.push({ heading: option.group, options: [option] });
  }
  return groups;
}

/**
 * The press at the dialog's foot, which plays the picked value's clip, or
 * stops whatever clip is playing. Note that it stops any clip and not only
 * the picked one's, so the button always answers the sound the reader hears.
 */
function SampleButton({
  sample,
  player,
}: {
  sample: string | undefined;
  player: SamplePlayer;
}): React.JSX.Element {
  const playing = player.playing !== undefined;
  const label = playing ? "Stop sample" : "Play sample";
  return (
    <Tooltip label={label}>
      <IconButton
        icon={playing ? <StopIcon /> : <PlayIcon />}
        label={label}
        disabled={!playing && sample === undefined}
        onClick={() => {
          if (playing) player.stop();
          else if (sample !== undefined) player.play(sample);
        }}
      />
    </Tooltip>
  );
}

/** The dialog the chip opens: every value under its heading, the picked one played as it is picked, kept only by Done. */
function SampledChoiceDialog({
  title,
  value,
  options,
  onDone,
  onCancel,
}: {
  title: string;
  value: string;
  options: readonly SampledChoiceOption[];
  onDone: (value: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [picked, setPicked] = useState(value);
  const player = useSamplePlayer();
  const pickedRow = useRef<HTMLButtonElement | null>(null);
  const hear = (token: string) => {
    const sample = options.find((option) => option.value === token)?.sample;
    if (sample !== undefined) player.play(sample);
  };
  const pick = (token: string | undefined) => {
    if (token === undefined) return;
    setPicked(token);
    hear(token);
  };
  return (
    <Dialog
      title={title}
      size={DIALOG_SIZE.CONFIRM}
      initialFocus={pickedRow}
      onDismiss={onCancel}
      actionsStart={
        <SampleButton
          sample={options.find((option) => option.value === picked)?.sample}
          player={player}
        />
      }
      actions={
        <>
          <Button variant={BUTTON_VARIANT.QUIET} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={BUTTON_VARIANT.PRIMARY} onClick={() => onDone(picked)}>
            Done
          </Button>
        </>
      }
    >
      <ScrollArea size={SCROLL_SIZE.CONTENT}>
        <div className="sampled-choice">
          {grouped(options).map((group) => {
            const holdsPick = group.options.some((option) => option.value === picked);
            return (
              <section key={group.heading ?? ""} className="sampled-choice-group">
                {group.heading === undefined ? null : (
                  <Text as={TEXT_ELEMENT.H3} variant={TEXT_VARIANT.LABEL} tone={TEXT_TONE.MUTED}>
                    {group.heading}
                  </Text>
                )}
                {/* Note that each heading's run is a radio group of its own, holding the pick only while one of its rows is it. */}
                <ChoiceList
                  legend={group.heading ?? title}
                  look={CHOICE_LOOK.MARKED}
                  options={group.options.map(({ value: token, label, detail }) => ({
                    value: token,
                    label,
                    detail,
                  }))}
                  value={holdsPick ? [picked] : []}
                  focusRef={holdsPick ? pickedRow : undefined}
                  onChange={([token]) => pick(token)}
                  onPressChecked={hear}
                />
              </section>
            );
          })}
        </div>
      </ScrollArea>
    </Dialog>
  );
}

export function SampledChoiceRow({
  label,
  detail,
  anchor,
  changed,
  value,
  options,
  onChange,
}: {
  label: string;
  detail?: string | undefined;
  /** The id a pressed search result lands on: the chip that opens the dialog. */
  anchor?: string | undefined;
  /** Whether the stored value differs from the default, which earns the mark. */
  changed: boolean;
  value: string;
  options: readonly SampledChoiceOption[];
  onChange: (value: string) => Promise<ActionResult>;
}): React.JSX.Element {
  const { busy, rejection, run } = useSettingWrite(onChange);
  const [open, setOpen] = useState(false);
  const chosen = options.find((option) => option.value === value)?.label ?? value;
  return (
    <SettingsRow
      label={label}
      adornment={changed ? <ChangedMark /> : null}
      description={detail}
      error={rejection}
    >
      {(control) => (
        <>
          <Chip
            look={CHIP_LOOK.FIELD}
            width={CHIP_WIDTH.FIELD}
            chevron
            {...(anchor === undefined ? undefined : searchAnchorProps(anchor))}
            aria-label={`${label}: ${chosen}`}
            aria-describedby={control["aria-describedby"]}
            aria-invalid={control["aria-invalid"]}
            aria-haspopup="dialog"
            disabled={busy}
            onClick={() => setOpen(true)}
          >
            <ChipName>{chosen}</ChipName>
          </Chip>
          {open ? (
            <SampledChoiceDialog
              title={label}
              value={value}
              options={options}
              onCancel={() => setOpen(false)}
              onDone={(picked) => {
                setOpen(false);
                // A value kept as it stood is no change, so it writes nothing and ends no conversation.
                if (picked !== value && options.some((option) => option.value === picked)) {
                  run(picked);
                }
              }}
            />
          ) : null}
        </>
      )}
    </SettingsRow>
  );
}
