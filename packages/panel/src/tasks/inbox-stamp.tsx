import { Badge, CHIP_LOOK, CHIP_SIZE, Chip, STATUS_TONE, type StatusTone } from "@repo/ui";
import { CheckIcon, Undo2Icon } from "@repo/ui/icons";
import { ANSWER_TONE, type AnswerStamp, type AnswerTone } from "./inbox-model.js";

const TAKE_OFF = "Take off answer";

export const ANSWER_STATUS_TONE = {
  [ANSWER_TONE.AHEAD]: STATUS_TONE.COMPLETE,
  [ANSWER_TONE.BACK]: STATUS_TONE.NEUTRAL,
} as const satisfies Record<AnswerTone, StatusTone>;

export function InboxStamp({
  stamp,
  onRemove,
}: {
  stamp: AnswerStamp;
  onRemove?: (() => void) | undefined;
}): React.JSX.Element {
  const tone = ANSWER_STATUS_TONE[stamp.tone];
  const glyph =
    stamp.tone === ANSWER_TONE.AHEAD ? (
      <CheckIcon aria-hidden="true" />
    ) : (
      <Undo2Icon aria-hidden="true" />
    );
  return (
    <span
      className="inbox-stamp inline-flex max-w-full self-start"
      data-inbox-stamp=""
      data-answer={stamp.tone}
    >
      {onRemove === undefined ? (
        <Badge tone={tone} icon={glyph}>
          {stamp.words}
        </Badge>
      ) : (
        <Chip
          look={CHIP_LOOK.PILL}
          size={CHIP_SIZE.COMPACT}
          tone={tone}
          onRemove={onRemove}
          removeLabel={TAKE_OFF}
        >
          {glyph}
          {stamp.words}
        </Chip>
      )}
    </span>
  );
}
