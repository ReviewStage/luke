import { ProviderMark, WingFace, wingMarkCapacity, wingPileOffset } from "@sidecar/panel";
import { CAPSULE_SIDE_WIDTH, PANEL_WIDTH, peekWidth } from "@sidecar/surface";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  SILENT_VOICE_LEVELS,
  type VoiceLevels,
  type VoiceSpeakers,
} from "#shared/messages/voice-view";
import { errandOriginProps } from "./luke-errand";
import {
  type FaceContext,
  speechFaceInputs,
  thinkingDotsShown,
  useFaceHover,
  useFaceMotion,
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
import { ThinkingDots } from "./thinking-dots";
import { usePrefersReducedMotion } from "./use-reduced-motion";
import { NO_VOICE_ACTIVITY, type VoiceActivity } from "./use-voice-view";
import { WAVEFORM_VOICE, Waveform, type WaveformVoice } from "./waveform";

/**
 * A stream measured in the wing itself, for whichever speaker's meter it
 * belongs to. Only the introduction takeover, which holds a session of its
 * own, hands one in; the panel has no stream and is handed the relayed
 * levels and edges instead.
 */
interface MeasuredVoice {
  voice: WaveformVoice;
  analyser: AnalyserNode;
}

/**
 * The strips beside the camera housing. They are rendered once for both window
 * modes and anchored to the notch rather than to a stage, so growing the window
 * re-lays out nothing here: the face keeps its place beside the housing on one
 * side and the marks keep theirs on the other, Luke's meter unfolds beside his
 * face into the space the expanded panel adds, the developer's takes the
 * marks' place on the other side while the microphone is heard, and the marks
 * spread out of their resting pile on the surface's own spring.
 */
interface NotchWingsProps {
  tally: SessionTally;
  measured?: MeasuredVoice | undefined;
  /** How loud each speaker is, in the unit interval, as last relayed. */
  levels?: VoiceLevels;
  /**
   * Who is being heard, as the voice window reports it: the session is full
   * duplex, so both may stand at once and each wing answers its own.
   */
  speakers: VoiceSpeakers;
  /**
   * Whether each speaker is audibly talking right now, on the debounced edge
   * the voice window measures beside the stream, relayed so the bars settle
   * where that edge landed rather than on a frame of their own.
   */
  voiceActive?: VoiceActivity;
  fixtureSpeaking: boolean;
  voiceOpening: boolean;
  /**
   * Whether a run of Luke's is still going, read from the same records the
   * Conversation tab draws its wait from, so the strip and the thread cannot
   * disagree about whether Luke is thinking.
   */
  thinking: boolean;
  /** Whether announcements are held, by the announce switch off or a meeting — the face sleeps on it. */
  announcementsHeld: boolean;
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
   * stays deliberately bare — no face, no marks, no meter — so the gate in
   * the panel is the one thing introducing him.
   */
  accountGated: boolean;
}

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

/**
 * What each wing draws. Luke's side holds his face and, while he is heard,
 * his meter beside it; the developer's side holds the marks or, while the
 * microphone is heard, the developer's meter in their place. The two sides
 * answer their own speaker, so both meters stand when both are talking, and
 * nothing here yields to the other side.
 */
export interface WingPlacement {
  /** Luke's meter, beside his face on the left wing. */
  lukeMeter: boolean;
  /** The developer's meter, in the marks' place on the right wing. */
  developerMeter: boolean;
  face: boolean;
  marks: boolean;
}

export function wingPlacement(input: {
  speakers: VoiceSpeakers;
  voiceOpening: boolean;
  accountGated: boolean;
}): WingPlacement {
  // The gate takes the whole strip for its label: nothing else is drawn
  // beside the housing while sign-in stands, or the label and a meter would
  // share the one seat the capsule's side has.
  const gated = input.accountGated;
  // The developer's meter stands from the press, not from the handshake:
  // while the call is opening it already stands where it will stand once
  // live, so the key answers on the frame it lands rather than when the
  // network does. Both meters hold on the speaker's standing rather than the
  // level, which arrives a relay later and would blink a meter out for that
  // frame.
  const developerMeter = !gated && (input.speakers.listening || input.voiceOpening);
  return {
    lukeMeter: !gated && input.speakers.lukeSpeaking,
    developerMeter,
    face: !gated,
    // The marks share their side with the developer's meter, which has it
    // while the microphone is heard.
    marks: !gated && !developerMeter,
  };
}

export function NotchWings({
  tally,
  measured,
  levels = SILENT_VOICE_LEVELS,
  speakers,
  voiceActive: relayedVoiceActive,
  fixtureSpeaking,
  voiceOpening,
  thinking,
  announcementsHeld,
  sessionsSettled,
  presentation,
  housingWidth,
  accountGated,
}: NotchWingsProps): React.JSX.Element {
  // A measured stream reports its own edges, for the one meter it feeds; a
  // relayed level arrives with both speakers' edges.
  const [measuredVoiceActive, setMeasuredVoiceActive] = useState(false);
  const voiceActive: VoiceActivity = relayedVoiceActive ?? {
    ...NO_VOICE_ACTIVITY,
    ...(measured ? { [measured.voice]: measuredVoiceActive } : undefined),
  };
  const placement = wingPlacement({ speakers, voiceOpening, accountGated });
  const meterFor = (voice: WaveformVoice) => (
    <span className="wing-meter" data-turn={voice}>
      <Waveform
        {...(measured?.voice === voice ? { analyser: measured.analyser } : undefined)}
        level={levels[voice]}
        speaking={fixtureSpeaking}
        voice={voice}
        voiceActive={voiceActive[voice]}
        onVoiceActivity={setMeasuredVoiceActive}
      />
    </span>
  );
  // The box the hover is read against, not the face itself: the drawing is
  // remounted for every play, and the hover has to survive the trick it fires.
  const faceElement = useRef<HTMLSpanElement>(null);
  const faceContext: FaceContext = {
    ...speechFaceInputs(speakers),
    thinking,
    announcementsHeld,
    settled: sessionsSettled,
    attention: tally.attentionIds,
    working: tally.working,
    complete: tally.complete,
    total: tally.total,
  };
  const face = useFaceMotion(faceContext, usePrefersReducedMotion(), useFaceHover(faceElement));

  // The wing is bounded by the shape its state draws, so its capacity is too:
  // the panel's side holds more marks than the peek's, and every other state
  // keeps the peek's capacity because that is the set the next peek unfolds.
  // The marks share this wing with nothing while they are drawn — the
  // developer's meter has it to itself instead — so nothing else has to be
  // reserved for.
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
      <div className="wing wing-left">
        {/* Ordered so the element nearest the notch is the one the capsule
            keeps: the rest unfold outward and never displace it. */}
        <div className="wing-inner">
          {/* Luke's own meter, beside his face while he is heard. A fresh
              mount for every reply: the arrival choreography lives in a
              starting style, and only a mount reads one. His voice is what
              grows the capsule, and the meter trails the edge growing under
              it rather than being drawn on the desktop ahead of it. */}
          {placement.lukeMeter && meterFor(WAVEFORM_VOICE.LUKE)}
          {/* The wait's dots, trailing outward from the face they ripple off:
              the same three the Conversation bubble draws beside the same
              repeating hop. Drawn only while the thinking rest is what holds
              the face, so speech taking the face back takes them with it, and
              the gate displacing the face leaves none orphaned. The peek and
              the panel unfold their slot the way they unfold the meter's; the
              capsule grows its own room for it, the way it grows for Luke's
              reply meter. */}
          {thinkingDotsShown(faceContext, placement.face) && (
            <span className="wing-thinking">
              <ThinkingDots />
            </span>
          )}
          {/* Luke himself. He is drawn in every state but the gate: your own
              voice is answered on the other wing, so it never displaces him,
              and he listens to it as a face.

              Keyed on the play so that each one is a new drawing: a motion plays
              once now, and an element already wearing an animation does not
              replay it on being handed the same one. The wrapper is what the
              hover is measured against, so it holds still across those
              remounts — and hovering it is a moment the face reacts to. */}
          {placement.face ? (
            /* The wrapper is also where an errand sets off from, for the same
               reason the hover is measured against it: it holds still while a
               motion transforms layers inside the drawing, so a mark peeling
               off it starts exactly where the face is drawn. It is not
               rendered at all while the gate has this place, which is how an
               errand knows there is no face to leave from. */
            <span className="wing-face" ref={faceElement} {...errandOriginProps()}>
              <WingFace key={face.play} motion={face.motion} repeat={face.repeat} />
            </span>
          ) : null}
        </div>
      </div>

      <div className="wing wing-right">
        <div className="wing-inner">
          {/* Your own meter, in the marks' place while the microphone is
              heard: the one thing worth showing then is that you are being
              heard, and bars moving to your own voice say it better than the
              marks do. It takes exactly the room the resting mark had beside
              the housing, so the capsule grows nothing for it, and the marks
              return the moment the microphone closes. */}
          {placement.developerMeter && meterFor(WAVEFORM_VOICE.DEVELOPER)}
          {/* What Luke is watching: which apps hold the work. The capsule's
              side has room for one, so at rest it draws the app whose session
              needs a person soonest and the rest wait behind it; the peek and
              the panel lay the whole strip out flat. Drawn in every state but
              two: the gate, which takes this place for the label below, and
              the microphone's, which hands it to the meter above. Decorative:
              the panel's own rows and filter chips are where the roster is
              read and filtered. */}
          <span
            className="wing-marks"
            ref={marksRef}
            data-drawn={String(placement.marks)}
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
              the one action that wakes him. */}
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
        </div>
      </div>
    </>
  );
}
