import { type ReactNode, useState } from "react";
import { cssCustomProperties } from "../../css.js";
import { CheckIcon, RemoveIcon } from "../../face/glyphs.js";
import { pulseOnPress } from "../../press-pulse.js";
import { HoverCard, HoverCardHead } from "../hover-card/hover-card.js";
import { motionKey as motionKeyAttribute } from "../list-motion/list-motion.js";
import { ClippedLine, ONE_LINE_ELEMENT, ONE_LINE_END } from "../one-line/clipped-line.js";
import { SPINNER_SIZE, Spinner } from "../spinner/spinner.js";
import { Tooltip } from "../tooltip/hint.js";

export const ATTACHMENT_CHIP_STATE = {
  READY: "ready",
  LOADING: "loading",
  UPLOADING: "uploading",
  FAILED: "failed",
} as const;

export type AttachmentChipState =
  (typeof ATTACHMENT_CHIP_STATE)[keyof typeof ATTACHMENT_CHIP_STATE];

const CHIP =
  "ui-attachment-chip group/attachment-chip relative flex h-attachment-chip max-w-attachment-chip-max rounded-ui-8 border border-border bg-surface transition-[border-color] duration-(--ui-duration-hover) ease-motion-exit [@media(hover:hover)]:has-[button.ui-attachment-chip-face:hover]:border-border-strong data-[image=true]:not-data-[picture=true]:w-attachment-chip-thumb";

const FACE =
  "ui-attachment-chip-face m-0 flex min-w-0 flex-[1_1_auto] items-center gap-ui-8 rounded-attachment-chip-face border-0 bg-transparent py-0 pr-ui-12 pl-attachment-chip-lead text-left text-muted-foreground [font-family:inherit] [font-style:inherit] [font-weight:inherit] leading-[inherit] text-caption-inline transition-[background-color] duration-(--ui-duration-hover) ease-motion-exit [&>svg]:size-icon-16 [&>svg]:flex-none group-data-[image=true]/attachment-chip:justify-center group-data-[image=true]/attachment-chip:p-0";

const FACE_PRESS = "group/attachment-face cursor-press hover:bg-fill-strong";

const REMOVE =
  "ui-attachment-chip-remove absolute -top-attachment-chip-remove-out -right-attachment-chip-remove-out m-0 flex size-attachment-chip-remove items-center justify-center rounded-ui-full border-3 border-transparent bg-background bg-clip-padding p-0 text-muted-foreground shadow-attachment-chip-disc transition-[color] duration-(--ui-duration-hover) ease-motion-exit focus-visible:outline-offset-[calc(-1*var(--ui-focus-ring-width))] hover:not-disabled:text-foreground disabled:opacity-disabled [&_svg]:size-ui-8";

const METER =
  "ui-attachment-chip-meter pointer-events-none absolute right-ui-4 bottom-ui-2 left-ui-4 h-attachment-chip-meter overflow-hidden rounded-ui-full bg-fill-strong";
const METER_FILL = "ui-attachment-chip-meter-fill block h-full rounded-ui-full bg-working";
const METER_SHARE =
  "origin-left [transform:scaleX(var(--ui-attachment-chip-share,0))] transition-transform duration-(--ui-duration-pane) ease-pane";

const LANDED =
  "ui-attachment-chip-landed pointer-events-none absolute -right-ui-6 -bottom-ui-6 flex size-ui-16 items-center justify-center rounded-ui-full bg-background text-complete shadow-attachment-chip-disc [&_svg]:size-attachment-chip-check [&_svg]:text-inherit";

function ChipFace({
  state,
  name,
  image,
  icon,
  detail,
  failure,
}: {
  state: AttachmentChipState;
  name: string;
  image: string | undefined;
  icon: ReactNode;
  detail: string | undefined;
  failure: string | undefined;
}): React.JSX.Element {
  if (state === ATTACHMENT_CHIP_STATE.LOADING) {
    return <Spinner label={`Reading ${name}`} size={SPINNER_SIZE.INLINE} />;
  }
  const drawn = state === ATTACHMENT_CHIP_STATE.READY || state === ATTACHMENT_CHIP_STATE.UPLOADING;
  if (drawn && image !== undefined) {
    return (
      <img
        className="block h-full w-auto min-w-attachment-chip-picture-min max-w-attachment-chip-picture-max rounded-attachment-chip-face object-cover transition-[filter] duration-(--ui-duration-hover) ease-motion-exit group-hover/attachment-face:brightness-112"
        src={image}
        alt={name}
      />
    );
  }
  const words = state === ATTACHMENT_CHIP_STATE.FAILED ? failure : name;
  return (
    <>
      {icon}
      {words === undefined ? null : (
        <ClippedLine
          className="ui-attachment-chip-name overflow-hidden whitespace-nowrap text-foreground"
          as={ONE_LINE_ELEMENT.SPAN}
          end={ONE_LINE_END.ELLIPSIS}
          words={words}
        >
          {words}
        </ClippedLine>
      )}
      {detail === undefined ? null : (
        <span className="ui-attachment-chip-detail flex-none">{detail}</span>
      )}
    </>
  );
}

function fractionOf(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(100, Math.max(0, progress)) / 100;
}

function UploadMeter({
  name,
  progress,
}: {
  name: string;
  progress: number | undefined;
}): React.JSX.Element {
  const fraction = progress === undefined ? undefined : fractionOf(progress);
  return (
    <span
      className={METER}
      role="progressbar"
      aria-label={`Uploading ${name}`}
      aria-valuemin={fraction === undefined ? undefined : 0}
      aria-valuemax={fraction === undefined ? undefined : 100}
      aria-valuenow={fraction === undefined ? undefined : Math.round(fraction * 100)}
      data-indeterminate={fraction === undefined ? "true" : undefined}
    >
      <span
        className={fraction === undefined ? METER_FILL : `${METER_FILL} ${METER_SHARE}`}
        style={
          fraction === undefined
            ? undefined
            : cssCustomProperties({ "--ui-attachment-chip-share": fraction })
        }
      />
    </span>
  );
}

function useLanded(state: AttachmentChipState): boolean {
  const [was, setWas] = useState(state);
  const [landed, setLanded] = useState(false);
  if (state !== was) {
    setWas(state);
    setLanded(was === ATTACHMENT_CHIP_STATE.UPLOADING && state === ATTACHMENT_CHIP_STATE.READY);
  }
  return landed;
}

export function AttachmentChip({
  name,
  image,
  icon,
  detail,
  onOpen,
  onRemove,
  removeDisabled,
  state = ATTACHMENT_CHIP_STATE.READY,
  progress,
  failure,
  motionKey,
}: {
  name: string;
  image?: string | undefined;
  icon?: ReactNode;
  detail?: string | undefined;
  onOpen?: (() => void) | undefined;
  onRemove?: (() => void) | undefined;
  removeDisabled?: boolean | undefined;
  state?: AttachmentChipState;
  progress?: number | undefined;
  failure?: string | undefined;
  motionKey?: string | undefined;
}): React.JSX.Element {
  const ready = state === ATTACHMENT_CHIP_STATE.READY;
  const uploading = state === ATTACHMENT_CHIP_STATE.UPLOADING;
  const landed = useLanded(state);
  const face = (
    <ChipFace
      state={state}
      name={name}
      image={image}
      icon={icon}
      detail={detail}
      failure={failure}
    />
  );
  const picture = (ready || uploading) && image !== undefined;
  const thumbnail =
    picture ||
    state === ATTACHMENT_CHIP_STATE.LOADING ||
    (state === ATTACHMENT_CHIP_STATE.FAILED && failure === undefined && detail === undefined);
  const glyph =
    image === undefined ? icon : <img className="rounded-ui-6 object-cover" src={image} alt="" />;
  const card = ready ? (
    <HoverCard data-attachment-card="">
      <HoverCardHead glyph={glyph} name={name} sub={detail} />
    </HoverCard>
  ) : undefined;
  return (
    <Tooltip label={name} card={card}>
      <li
        className={CHIP}
        data-image={thumbnail ? "true" : undefined}
        data-picture={picture ? "true" : undefined}
        data-removable={onRemove === undefined ? undefined : "true"}
        {...(motionKey === undefined ? {} : motionKeyAttribute(motionKey))}
        data-state={state}
      >
        {onOpen === undefined || !ready ? (
          <span className={FACE}>{face}</span>
        ) : (
          <button
            type="button"
            className={`${FACE} ${FACE_PRESS}`}
            aria-label={`Open ${name}`}
            onClick={pulseOnPress(onOpen)}
          >
            {face}
          </button>
        )}
        {uploading ? <UploadMeter name={name} progress={progress} /> : null}
        {landed ? (
          <span className={LANDED} aria-hidden="true">
            <CheckIcon />
          </span>
        ) : null}
        {onRemove === undefined ? null : (
          <button
            type="button"
            className={REMOVE}
            aria-label={`Remove ${name}`}
            disabled={removeDisabled === true}
            onClick={pulseOnPress(onRemove)}
          >
            <RemoveIcon />
          </button>
        )}
      </li>
    </Tooltip>
  );
}
