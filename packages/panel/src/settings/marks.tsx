import { SavedTick, SettingsAttentionMark, SettingsChangedMark } from "@repo/ui";
import type { ShownError } from "@repo/ui/reported-failure";
import { ReplayMask } from "@repo/ui/session-replay-marks";

export function ChangedMark(): React.JSX.Element {
  return <SettingsChangedMark />;
}

export function SettingMarks({
  changed,
  saves,
}: {
  changed: boolean | undefined;
  saves: number;
}): React.JSX.Element {
  return (
    <>
      {changed === true ? <ChangedMark /> : null}
      <SavedTick saves={saves} />
    </>
  );
}

export function AttentionMark({ note }: { note: string }): React.JSX.Element {
  return <SettingsAttentionMark note={note} />;
}

export function replayMaskedError(error: ShownError | undefined): ShownError | undefined {
  const { words } = error ?? {};
  if (
    error === undefined ||
    words === undefined ||
    words === null ||
    words === false ||
    words === ""
  ) {
    return error;
  }
  return { ...error, words: <ReplayMask>{words}</ReplayMask> };
}
