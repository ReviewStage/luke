import { LID_STATE, MICROPHONE_TRANSPORT, type MicrophoneRoute } from "../shared/contracts";

/**
 * How every capture is processed, wherever it is opened from.
 *
 * Echo cancellation is deliberately off. Push-to-talk is half-duplex by
 * construction — a press interrupts the reply before the track enables, and
 * `speak` refuses a busy turn — so Luke is never audible while the microphone
 * is, and there is no echo to cancel. What the constraint would buy instead
 * is Chromium's system echo canceller, which on macOS runs the capture
 * through the OS's own voice processing — and the OS then ducks and thins
 * every other app's audio for as long as the device is open. That processing,
 * not the media duck (which only moves a volume and puts it back), is what
 * made music sound degraded whenever a conversation was up, so the capture
 * stays on the plain path. Gain and noise handling are Chromium's own
 * in-process passes and touch nothing but this stream.
 */
export const MICROPHONE_PROCESSING = {
  autoGainControl: true,
  echoCancellation: false,
  noiseSuppression: true,
} as const;

/** The parts of an enumerated media device the choice reads. */
export interface EnumeratedMicrophone {
  kind: string;
  label: string;
  deviceId: string;
}

/**
 * The built-in microphone's name, when it is the better device to open.
 *
 * Capturing from a Bluetooth headset's own microphone pulls the whole headset
 * onto its narrow call codec, so everything it plays — Luke's answer, the
 * music the duck is about to restore — turns phone-grade for as long as the
 * device is open. The Mac's own microphone costs none of that, so it is
 * preferred exactly when the system default would be a Bluetooth headset and
 * the lid over the Mac's microphone is not shut: a closed lid muffles it, and
 * a muffled question is worse than a degraded song. A desktop keeps no lid
 * and answers `unknown`, which counts as open — an iMac's microphone has
 * nothing to be shut under.
 */
export function preferredBuiltInLabel(route: MicrophoneRoute | undefined): string | undefined {
  if (!route?.builtInName) return undefined;
  if (route.defaultTransport !== MICROPHONE_TRANSPORT.BLUETOOTH) return undefined;
  if (route.lid === LID_STATE.SHUT) return undefined;
  return route.builtInName;
}

/**
 * The constraints a press opens the device with: the processing above, plus
 * the built-in device when the route says it is the better one and the
 * browser's list actually offers it. CoreAudio's name for the device is the
 * browser's label for it, which is what lets a fact read natively choose
 * among devices the web API names only by string.
 */
export function microphoneConstraints(
  route: MicrophoneRoute | undefined,
  devices: readonly EnumeratedMicrophone[],
): MediaTrackConstraints {
  const label = preferredBuiltInLabel(route);
  if (!label) return { ...MICROPHONE_PROCESSING };
  const device = devices.find(
    (candidate) =>
      candidate.kind === "audioinput" &&
      candidate.deviceId !== "" &&
      candidate.label.includes(label),
  );
  if (!device) return { ...MICROPHONE_PROCESSING };
  return { ...MICROPHONE_PROCESSING, deviceId: { exact: device.deviceId } };
}

/**
 * One added clause for the Microphone row's small text, said only while the
 * routing decision is actually in play — a Bluetooth headset standing as the
 * system input with the preference on. Everywhere else the row stays exactly
 * as it always read: a page should not narrate the obvious. Worded from the
 * same facts the choice runs on, so the clause and the behavior can never
 * disagree.
 */
export function listeningThroughDetail(
  route: MicrophoneRoute | undefined,
  preferBuiltIn: boolean,
): string | undefined {
  if (!preferBuiltIn) return undefined;
  if (route?.defaultTransport !== MICROPHONE_TRANSPORT.BLUETOOTH) return undefined;
  if (!route.builtInName) return undefined;
  if (route.lid === LID_STATE.SHUT) {
    return "With the lid shut, Luke listens through the Bluetooth headset.";
  }
  return "With a Bluetooth headset connected, Luke listens through the Mac's own microphone.";
}

/** The three browser and bridge acts the opener composes, injectable. */
export interface MicrophoneOpener {
  route(): Promise<MicrophoneRoute | undefined>;
  enumerate(): Promise<readonly EnumeratedMicrophone[]>;
  open(audio: MediaTrackConstraints): Promise<MediaStream>;
}

/**
 * Opens the capture device for a press, preferring the Mac's own microphone
 * where the route says a Bluetooth headset would otherwise pay for it. The
 * route is an optimization and never a gate: unreadable, unmatched, or
 * vanished between the read and the open, the browser's default answers the
 * press exactly as it would with no route at all.
 */
export async function openPreferredMicrophone(opener: MicrophoneOpener): Promise<MediaStream> {
  let audio: MediaTrackConstraints = { ...MICROPHONE_PROCESSING };
  try {
    const route = await opener.route();
    if (preferredBuiltInLabel(route)) {
      audio = microphoneConstraints(route, await opener.enumerate());
    }
  } catch {
    audio = { ...MICROPHONE_PROCESSING };
  }
  if (audio.deviceId === undefined) return opener.open(audio);
  try {
    return await opener.open(audio);
  } catch {
    return opener.open({ ...MICROPHONE_PROCESSING });
  }
}
