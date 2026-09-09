import { VOICE_CAPTION_MAX_HEIGHT } from "@sidecar/surface";
import { cssCustomProperties, SURFACE_PROPERTY } from "@sidecar/surface/react-css";
import {
  type CSSProperties,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { parsePixels } from "./session-motion";
import {
  CAPTION_TONE,
  type CaptionTone,
  pointOverStrip,
  type SpokenStripContent,
  stripHoldNext,
} from "./strip-hold";
import { useMeasuredHeight } from "./use-measured-height";
import { voiceErrorToShow, voiceNoticeToShow } from "./use-voice-view";
import { VOLUME_HINT_BAND_HEIGHT } from "./volume-hint";
import type { WaveformVoice } from "./waveform";

/**
 * The caption block's visible height — the `--caption-size` the clip ends the
 * element at. The strip's hover test reads it too: the element's own box runs
 * to the reserved maximum, and only this much of it is words rather than
 * desktop.
 */
function captionBlockSize(textHeight: number, volumeHint: boolean, padding: number): number {
  const hintBand = volumeHint ? VOLUME_HINT_BAND_HEIGHT : 0;
  return Math.min(VOICE_CAPTION_MAX_HEIGHT - hintBand, textHeight + padding);
}

/**
 * Sizes the caption block to the words it currently holds. The text wraps, so
 * only a measurement can say how tall it is; the size drives the surface's
 * growth and the clip that reveals the text. The whole reply stays on screen —
 * the reserved maximum is sized past what a spoken reply wraps to, so the
 * clamp below is the window's physical bound rather than a working edge.
 * The volume hint stands in a band of its own below the block: while it is
 * drawn, the band comes off the block's maximum, so the block and the band
 * partition the reserved room instead of sharing it, and the stack never asks
 * for more height than the window holds.
 * Padding is the caption's own computed padding, not a restated number, so a
 * retune in the stylesheet grows the surface by exactly what the text is
 * inset — the one inset above the words, with whatever stands below the block
 * carrying the gap on that side.
 */
function captionSizeStyle(
  textHeight: number | undefined,
  volumeHint: boolean,
  padding: number,
): CSSProperties {
  if (!textHeight) return {};
  return cssCustomProperties({
    [SURFACE_PROPERTY.CAPTION_SIZE]: `${captionBlockSize(textHeight, volumeHint, padding)}px`,
  });
}

export interface UseCaptionPresentationOptions {
  /** Luke's own words this frame, or nothing while he is not speaking. */
  lukeCaptions: readonly string[] | undefined;
  voiceError: string | undefined;
  voiceNotice: string | undefined;
  voiceTurn: WaveformVoice | undefined;
  fixtureSpeaking: boolean;
  /** Whether the hint stands in its own band below the block. */
  volumeHint: boolean;
  /** True while the shape is still riding down out of the panel. */
  leavingPanel: boolean;
}

export interface CaptionPresentation {
  /** The caption element itself, whose box the hover test measures. */
  ref: RefObject<HTMLSpanElement | null>;
  /** The wrapped stack inside it, which is what is measured. */
  textRef: (element: HTMLElement | null) => void;
  /** Everything the strip is showing, live words or a held snapshot. */
  texts: readonly string[] | undefined;
  tone: CaptionTone;
  /** The reply above, drawn only when two are stacked. */
  settled: string | undefined;
  /** The words still arriving, in the always-mounted slot. */
  live: string | undefined;
  /** The `--caption-size` the surface grows by. */
  style: CSSProperties;
}

/**
 * Luke's words under the housing: which of them are drawn, in whose tone, how
 * tall the block they need is, and the pointer's hold that keeps a reply on
 * screen while someone is still reading it.
 */
export function useCaptionPresentation(
  options: UseCaptionPresentationOptions,
): CaptionPresentation {
  const { lukeCaptions, voiceTurn, fixtureSpeaking, volumeHint, leavingPanel } = options;
  const [textElement, textHeight] = useMeasuredHeight();
  const element = useRef<HTMLSpanElement>(null);
  const [padding, setPadding] = useState(0);
  // Before paint, not after: `--caption-size` is composed from this, and a
  // padding that landed a frame later would size the first frame of a reply
  // without it and then retarget the surface's height transition mid-travel.
  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    const style = getComputedStyle(node);
    const next = parsePixels(style.paddingTop) + parsePixels(style.paddingBottom);
    setPadding((previous) => (previous === next ? previous : next));
  });

  // A failed call is reported where its reply would have landed: on the
  // caption strip, under the field or the key press that asked. It yields to
  // live words, so it can never be drawn over a reply being spoken.
  const errorNotice = voiceErrorToShow({
    fixtureSpeaking,
    voice: voiceTurn,
    error: options.voiceError,
  });
  // A state notice borrows the strip on the failure's own terms — leaving on
  // the same clock, in its quieter tone — but yields only to Luke's own turn:
  // the developer's open microphone draws nothing on the strip, and the one
  // refusal that happens during it belongs there. The failure outranks it: a
  // fault is the more urgent thing to read.
  const noticeShown = voiceNoticeToShow({
    fixtureSpeaking,
    voice: voiceTurn,
    notice: options.voiceNotice,
  });
  // What the caption block is being handed live this frame: Luke's words, a
  // failure borrowing their strip, or a notice borrowing it more quietly.
  const stripText = errorNotice ?? noticeShown;
  const liveTexts = lukeCaptions ?? (stripText === undefined ? undefined : [stripText]);
  // Words is the resting tone, kept even when nothing is drawn, so a frame
  // with no words never snapshots a coloured tone into the strip hold.
  const liveTone: CaptionTone =
    lukeCaptions !== undefined || stripText === undefined
      ? CAPTION_TONE.WORDS
      : errorNotice !== undefined
        ? CAPTION_TONE.ERROR
        : CAPTION_TONE.NOTICE;

  /**
   * The pointer's hold on the strip. The words leave with the reply that
   * earned them, and a failure leaves on its own clock — but never out from
   * under a pointer resting on them, which is someone mid-read. The hold
   * snapshots exactly what the strip was showing and keeps it drawn until the
   * pointer moves away; it can start nothing, so nothing dismissed before the
   * hover began is ever resurrected.
   */
  const [hovered, setHovered] = useState(false);
  // Derived in the render, never advanced after paint: the frame that brings
  // a new reply's content composes the hold against that same content, so a
  // held snapshot can never paint one frame beside live words it should have
  // yielded to. The ref carries the previous frame's answer.
  const holdRef = useRef<SpokenStripContent | undefined>(undefined);
  const hold = stripHoldNext({
    hovered,
    drawn: liveTexts === undefined ? undefined : { texts: liveTexts, tone: liveTone },
    held: holdRef.current,
  });
  holdRef.current = hold;

  /**
   * The strip's hoverable box, kept current for the window's move listener:
   * the caption block's visible height — zero while no words are drawn, so an
   * invisible block holds nothing. A ref rather than state, because the
   * listener reads it at each move and re-subscribing per frame would be work
   * for nobody.
   */
  const hoverHeight = useRef(0);
  useEffect(() => {
    // Forwarded moves arrive even while the window is click-through, which is
    // what lets a pointer resting on words that take no pointer be seen here
    // at all.
    const handleMove = (event: MouseEvent) => {
      const caption = element.current;
      setHovered(
        pointOverStrip({
          x: event.clientX,
          y: event.clientY,
          caption:
            caption && hoverHeight.current > 0
              ? { box: caption.getBoundingClientRect(), visibleHeight: hoverHeight.current }
              : undefined,
        }),
      );
    };
    const handleLeave = () => setHovered(false);
    window.addEventListener("mousemove", handleMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", handleLeave);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      document.documentElement.removeEventListener("mouseleave", handleLeave);
    };
  }, []);

  /**
   * The measured caption height the shape spends, held through a collapse
   * out of the panel. The compact width lands at the flip and re-wraps the
   * words while they are still riding down at the panel's foot, and a
   * re-measure landing mid-ride would open the clip and retarget the surface
   * past room nothing has made yet. The collapse travels on the panel's
   * numbers; the compact re-measure lands when the shape has settled, and
   * grows it there the way words arriving at rest do.
   */
  const heldHeight = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (leavingPanel) return;
    heldHeight.current = textHeight;
  });
  const shownHeight = leavingPanel ? heldHeight.current : textHeight;

  // Live words win; the held snapshot only ever finishes being read. A held
  // caption is drawn exactly as it was, its tone included.
  const texts = liveTexts ?? hold?.texts;
  const tone: CaptionTone = liveTexts !== undefined ? liveTone : (hold?.tone ?? CAPTION_TONE.WORDS);
  // What the hover test may match this frame, now that both are known.
  hoverHeight.current =
    texts === undefined || textHeight === undefined
      ? 0
      : captionBlockSize(textHeight, volumeHint, padding);

  return {
    ref: element,
    textRef: textElement,
    texts,
    tone,
    // Two responses spoken back-to-back stack as two captions: the settled one
    // above, the one still arriving below, in the always-mounted slot the lone
    // caption also uses.
    settled: texts && texts.length > 1 ? texts.at(-2) : undefined,
    live: texts?.at(-1),
    style: captionSizeStyle(shownHeight, volumeHint, padding),
  };
}
