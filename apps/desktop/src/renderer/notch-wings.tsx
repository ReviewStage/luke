import { ProviderMark, WingFace, wingMarkCapacity, wingPileOffset } from "@sidecar/panel";
import { CAPSULE_SIDE_WIDTH, PANEL_WIDTH, peekWidth } from "@sidecar/surface";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { errandOriginProps } from "./luke-errand";
import {
  faceYieldsToMeter,
  speechFaceInputs,
  useFaceHover,
  useFaceMotion,
  usePrefersReducedMotion,
} from "./luke-face-mood";
import { PANEL_PRESENTATION, type PanelPresentation } from "./panel-state";
import type { ProviderTally, SessionTally } from "./session-model";
import {
  LEAVING_ATTRIBUTE,
  useRoster,
  useWingReorderMotion,
  WING_SLOT_ID_ATTRIBUTE,
  WING_SPREAD_ATTRIBUTE,
} from "./session-motion";
import { WAVEFORM_VOICE, Waveform, type WaveformVoice } from "./waveform";

/**
 * The strips beside the camera housing. They are rendered once for both window
 * modes and anchored to the notch rather than to a stage, so growing the window
 * re-lays out nothing here: the face keeps its place beside the housing on one
 * side and the marks keep theirs on the other, the meter unfolds into the
 * space the expanded panel adds, and the marks spread out of their resting
 * pile on the surface's own spring.
 */
interface NotchWingsProps {
  tally: SessionTally;
  analyser?: AnalyserNode;
  voice?: WaveformVoice;
  /** Reported upward so the turn can end when Luke actually goes quiet. */
  onVoiceActivity?: (active: boolean) => void;
  fixtureSpeaking: boolean;
  hasAudioSignal: boolean;
  /** A pressed talk key still waiting for the call it asked to open. */
  voiceOpening: boolean;
  /** Whether the calendar's quiet is holding announcements — the face sleeps on it. */
  meetingQuiet: boolean;
  /** Whether today's voice allowance is spent with no call open — the face hushes on it. */
  voiceSpent: boolean;
  /**
   * Whether the roster has been read at all yet. Until it has, the wing is
   * loading rather than empty: the face waits awake instead of sleeping on a
   * zero that only means "not looked yet".
   */
  sessionsSettled: boolean;
  presentation: PanelPresentation;
  housingWidth: number;
  /**
   * True while sign-in stands between Luke and anything to watch. The strip
   * stays deliberately bare — no face, no marks — so the gate in the panel is
   * the one thing introducing him.
   */
  accountGated: boolean;
  /**
   * The one sentence the wing states about the roster, derived where the
   * capsule button's own label is so the two can never drift. The live region
   * below is what speaks it as it changes.
   */
  statusLabel: string;
}

/**
 * How many marks fit beside the face in a wing of this width. The peek's side
 * is 124px beside the housing it was measured against, which is where its
 * limit of four comes from; the panel's side is what is left of
 * `--panel-width` after the housing, so it holds roughly twice as many.
 */
export { wingMarkCapacity, wingPileOffset } from "@sidecar/panel";

/**
 * The peek's side beside this housing: what is left of the floored peek after
 * the housing splits it. Beside the 14-inch housing and anything wider this is
 * the 124px the wing was drawn at; a narrower housing — or the bubble's none —
 * leaves the same floored shape more side to spend.
 */
export function peekSideWidth(housingWidth: number): number {
  return (peekWidth(housingWidth) - housingWidth) / 2;
}

/**
 * The sign-in label's own margins, in the stylesheet's numbers. It starts at
 * the housing's edge itself — black on black, the notch is indistinguishable
 * from padding, so an inset there buys nothing — and keeps more from the
 * strip's outer end, where the shape is already turning its corner and words
 * pressed into the curve read as clipped.
 */
const SIGN_IN_INSET = 0;
const SIGN_IN_EDGE_KEEP = 6;

/** The scale the label rests at, so its text never crosses the shape's edge. */
const SIGN_IN_RESTING_SCALE = 0.88;

/**
 * How much of its resting scale the sign-in label keeps so the words stay
 * inside the shape beside the housing. The width arrives in layout pixels —
 * measured before any transform — so the room is compared against it at the
 * scale the stylesheet is about to apply; the factor multiplies that resting
 * scale rather than replacing it, and is 1 whenever the room already
 * suffices. The label is drawn only in the compact shapes, so the capsule's
 * own side is the room it has to fit.
 */
export function signInLabelFit(labelWidth: number): number {
  if (labelWidth <= 0) return 1;
  const room = Math.max(0, CAPSULE_SIDE_WIDTH - SIGN_IN_INSET - SIGN_IN_EDGE_KEEP);
  return Math.min(1, room / (SIGN_IN_RESTING_SCALE * labelWidth));
}

/**
 * The wing's strip, as slots: the mark of each app holding tracked work, in
 * the order the rows read. Whatever the wing cannot hold is truncated rather
 * than counted — the marks say which apps are working, and a remainder glyph
 * would put a number back beside the housing that says nothing about which.
 */
export interface WingSlot {
  id: string;
  provider: ProviderTally;
}

export function wingSlots(
  providers: readonly ProviderTally[],
  capacity: number,
): readonly WingSlot[] {
  return providers.slice(0, capacity).map((provider) => ({ id: provider.providerId, provider }));
}

export function NotchWings({
  tally,
  analyser,
  voice,
  onVoiceActivity,
  fixtureSpeaking,
  hasAudioSignal,
  voiceOpening,
  meetingQuiet,
  voiceSpent,
  sessionsSettled,
  presentation,
  housingWidth,
  accountGated,
  statusLabel,
}: NotchWingsProps): React.JSX.Element {
  const [voiceActive, setVoiceActive] = useState(false);
  const reportVoiceActivity = useCallback(
    (active: boolean) => {
      setVoiceActive(active);
      onVoiceActivity?.(active);
    },
    [onVoiceActivity],
  );
  // The meter is the developer's from the press, not from the handshake: while
  // the call is opening it already stands where it will stand once live, so the
  // key answers on the frame it lands rather than when the network does. It
  // also holds through the turn itself rather than following the analyser,
  // which arrives an effect-tick after the turn opens and would blink the
  // meter out for that frame.
  const meterVoice = voice ?? (voiceOpening ? WAVEFORM_VOICE.DEVELOPER : undefined);
  const meterShown = hasAudioSignal || voiceOpening || meterVoice === WAVEFORM_VOICE.DEVELOPER;
  // While the developer holds the turn the meter takes the face's place, which
  // is the only place the capsule has.
  const yieldToMeter = faceYieldsToMeter({
    ...(meterVoice ? { turn: meterVoice } : undefined),
    hasAudioSignal: meterShown,
  });
  // The box the hover is read against, not the face itself: the drawing is
  // remounted for every play, and the hover has to survive the trick it fires.
  const faceElement = useRef<HTMLSpanElement>(null);
  const face = useFaceMotion(
    {
      ...speechFaceInputs({
        ...(voice ? { turn: voice } : undefined),
        hasAudioSignal,
        fixtureSpeaking,
        voiceActive,
      }),
      meetingQuiet,
      voiceSpent,
      settled: sessionsSettled,
      attention: tally.attentionIds,
      working: tally.working,
      complete: tally.complete,
      total: tally.total,
    },
    usePrefersReducedMotion(),
    useFaceHover(faceElement),
  );

  // The wing is bounded by the shape its state draws, so its capacity is too:
  // the panel's side holds more marks than the peek's, and every other state
  // keeps the peek's capacity because that is the set the next peek unfolds.
  // The marks have this wing to themselves — no face, no meter — so nothing
  // else has to be reserved for.
  const capacity =
    presentation === PANEL_PRESENTATION.PANEL
      ? wingMarkCapacity((PANEL_WIDTH - housingWidth) / 2)
      : wingMarkCapacity(peekSideWidth(housingWidth));
  // Memoized because the roster below notices a new list by identity: the
  // slots may only change when what they summarize does, not on every render
  // a spoken word or a face gesture asks for.
  const slots = useMemo(() => wingSlots(tally.providers, capacity), [tally.providers, capacity]);
  // The same treatment the session rows get, along the other axis: a mark
  // found somewhere new glides there, one whose provider left fades in the
  // slot it held — which is also what keeps a capacity that shrinks from
  // unmounting marks mid-fade — and only then does the gap close.
  const marksRef = useWingReorderMotion();
  const drawnSlots = useRoster(slots, marksRef);
  // Whether the shape has room to lay the strip out flat. The stylesheet
  // decides the same thing from the presentation; the strip carries it so the
  // reorder measurement reads the layout actually drawn rather than inferring
  // it a second way.
  const spread =
    presentation === PANEL_PRESENTATION.PEEK || presentation === PANEL_PRESENTATION.PANEL;

  // The label's text, measured in layout pixels: `offsetWidth` never sees the
  // transform about to draw it, so the fit below can divide by the scale the
  // stylesheet applies without measuring its own answer. No dependency list,
  // the way the reorder motion measures — and the guard keeps an unchanged
  // measurement from re-rendering anything.
  const signInElement = useRef<HTMLSpanElement>(null);
  const [signInWidth, setSignInWidth] = useState(0);
  useLayoutEffect(() => {
    const width = signInElement.current?.offsetWidth ?? 0;
    setSignInWidth((held) => (held === width ? held : width));
  });

  return (
    <>
      <div className="wing wing-left" data-audio={String(meterShown)}>
        {/* Ordered so the element nearest the notch is the one the capsule
            keeps: the rest unfold outward and never displace it. */}
        <div className="wing-inner">
          {meterShown && (
            /* Keyed on whose turn it is, so each voice's meter is a fresh
               mount: the arrival choreography lives in a starting style, and
               only a mount reads one. Luke's turn is what grows the capsule,
               and a meter the developer's turn already had on screen would
               otherwise relocate beside the returning face on the frame the
               turn flips — drawn on the desktop, ahead of an edge still most
               of its travel away. */
            <span className="wing-meter" data-turn={meterVoice} key={meterVoice}>
              <Waveform
                analyser={analyser}
                speaking={fixtureSpeaking}
                voice={meterVoice}
                voiceActive={voiceActive}
                connecting={voiceOpening && !analyser}
                onVoiceActivity={reportVoiceActivity}
              />
            </span>
          )}
          {/* Luke himself. He is drawn in every state but one: he steps out of
              the way of your own voice, which is the only thing that displaces
              him.

              Keyed on the play so that each one is a new drawing: a motion plays
              once now, and an element already wearing an animation does not
              replay it on being handed the same one. The wrapper is what the
              hover is measured against, so it holds still across those
              remounts — and hovering it is a moment the face reacts to. */}
          {yieldToMeter || accountGated ? null : (
            /* The wrapper is also where an errand sets off from, for the same
               reason the hover is measured against it: it holds still while a
               motion transforms layers inside the drawing, so a mark peeling
               off it starts exactly where the face is drawn. It is not
               rendered at all while the meter has this place, which is how an
               errand knows there is no face to leave from. */
            <span className="wing-face" ref={faceElement} {...errandOriginProps()}>
              <WingFace key={face.play} motion={face.motion} repeat={face.repeat} />
            </span>
          )}
        </div>
      </div>

      <div className="wing wing-right">
        <div className="wing-inner">
          {/* What Luke is watching: which apps hold the work. The capsule's
              side has room for one, so at rest it draws the app whose session
              needs a person soonest and the rest wait behind it; the peek and
              the panel lay the whole strip out flat. Drawn in every state but
              the gate, which takes this place for the label below. Decorative —
              the live region beside them already states everything they show,
              and the panel's own filter chips are what filtering is done
              with. */}
          <span
            className="wing-marks"
            ref={marksRef}
            data-drawn={String(!accountGated)}
            {...{ [WING_SPREAD_ATTRIBUTE]: String(spread) }}
          >
            {drawnSlots.map(({ item, leaving }, index) => (
              <span
                className="wing-mark"
                key={item.id}
                // How the reorder measurement finds this slot again after a
                // re-sort has moved it, and how a slot whose provider left
                // says so while it fades where the reader last saw it.
                {...{
                  [WING_SLOT_ID_ATTRIBUTE]: item.id,
                  [LEAVING_ATTRIBUTE]: String(leaving),
                }}
                data-piled={String(index === 0)}
                style={cssCustomProperties({ "--mark-rest": `${wingPileOffset(index)}px` })}
                aria-hidden="true"
              >
                <ProviderMark providerId={item.provider.providerId} />
              </span>
            ))}
          </span>
          {/* While sign-in stands between Luke and anything to watch, the
              strip says the one honest thing instead: why Luke is idle, and
              the one act that wakes him. */}
          {accountGated && (
            <span
              className="sign-in-label"
              style={cssCustomProperties({ "--sign-in-fit": signInLabelFit(signInWidth) })}
              aria-hidden="true"
              ref={signInElement}
            >
              Sign in
            </span>
          )}
          {/* The roster's own sentence, spoken rather than drawn. It rides its
              own element rather than the label's, which is rendered only while
              signed out and would take every later announcement down with it. */}
          <span className="wing-status" role="status" aria-live="polite">
            {statusLabel}
          </span>
        </div>
      </div>
    </>
  );
}
