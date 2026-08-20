import type { OutputAudioState } from "#shared/contracts";

/**
 * The decisions behind the volume hint, kept pure so they can be tested: when
 * the output counts as silent, what the hint should say, and how long a
 * "Got it" holds.
 *
 * The hint exists for one moment — Luke speaking words nobody can hear — and
 * it is deliberately hard to meet anywhere else. It is drawn only while his
 * caption is, it defers to a dismissal, and the dismissal is scoped to the
 * silence it answered: the user who said "got it" with the Mac muted has
 * answered for that mute, not for every mute to come.
 */

/**
 * Below this the output is silence in practice, muted or not. macOS reports
 * a scalar, and a volume the keys have stepped to nothing reads as exactly 0;
 * the margin only catches a device that lands a rounding error above it.
 */
export const SILENT_OUTPUT_VOLUME = 0.01;

/**
 * How long a dismissal outlives the silence it answered. Unmuting to hear one
 * reply and muting again is one decision, not two, and must not be nagged
 * twice; a mute taken up fresh after this long is a new moment, and the next
 * unheard reply earns the hint again.
 */
export const VOLUME_HINT_REARM_MS = 15 * 60_000;

/**
 * The hint row's height, mirrored by `.volume-hint` in the stylesheet — the
 * two must agree.
 */
export const VOLUME_HINT_HEIGHT = 22;

/**
 * The band the shape grows for the hint: the row plus the caption block's own
 * 9px bottom inset, which moves below the row while the hint stands — the
 * hint is what meets the shape's bottom edge then, so the breathing room
 * belongs under it. Mirrored by `--volume-hint-size` and the zeroed caption
 * padding in the stylesheet — the three must agree. The band is a stacked
 * element of its own, never part of the caption block: it is taken off the
 * block's maximum, so the words above scroll a row sooner and the clip that
 * reveals them ends where the band begins — no pace of scroll can draw a
 * line over the hint.
 */
export const VOLUME_HINT_BAND_HEIGHT = VOLUME_HINT_HEIGHT + 9;

/** A "Got it", remembered against the stretch of silence it was given in. */
export interface VolumeHintDismissal {
  /** When the button was pressed. */
  at: number;
  /** Which stretch of silence was on screen when it was. */
  stretch: number;
}

/**
 * Whether the output would swallow Luke's voice right now. Unknown is audible
 * on purpose: the hint explains a silence the helper has actually seen, and
 * must never manufacture one on a machine it cannot read.
 */
export function outputSilent(state: OutputAudioState | undefined): boolean {
  if (!state) return false;
  return state.muted || state.volume <= SILENT_OUTPUT_VOLUME;
}

/**
 * What the hint says, matched to which switch is actually in the way — being
 * told to unmute a Mac whose volume is merely at zero is advice that fixes
 * nothing. Short enough to share one 22px row with its button on a display
 * with no housing to grow from. No state reads as muted: the words only
 * appear over a silence the helper reported, but the fixture profile draws
 * them without one.
 */
export function volumeHintText(state: OutputAudioState | undefined): string {
  return state && !state.muted ? "Turn up the volume to hear Luke" : "Unmute your Mac to hear Luke";
}

/**
 * Whether a dismissal still holds. It covers the stretch of silence it was
 * given in for as long as that stretch lasts — an acknowledged mute stays
 * acknowledged all afternoon — and any other stretch only while it is still
 * fresh, so sound coming back and going away again soon after is not treated
 * as a new thing to say.
 */
export function volumeHintDismissed(
  dismissal: VolumeHintDismissal | undefined,
  stretch: number,
  now: number,
): boolean {
  if (!dismissal) return false;
  return dismissal.stretch === stretch || now - dismissal.at < VOLUME_HINT_REARM_MS;
}
