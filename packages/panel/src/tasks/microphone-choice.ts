import { LID_STATE, MICROPHONE_TRANSPORT, type MicrophoneRoute } from "@repo/settings/microphone";

const MICROPHONE_PROCESSING = {
  autoGainControl: true,
  echoCancellation: false,
  noiseSuppression: true,
} as const;

interface EnumeratedMicrophone {
  kind: string;
  label: string;
  deviceId: string;
}

function preferredBuiltInLabel(route: MicrophoneRoute | undefined): string | undefined {
  if (!route?.builtInName) return undefined;
  if (route.defaultTransport !== MICROPHONE_TRANSPORT.BLUETOOTH) return undefined;
  if (route.lid === LID_STATE.SHUT) return undefined;
  return route.builtInName;
}

function microphoneConstraints(
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

export interface MicrophoneOpener {
  route(): Promise<MicrophoneRoute | undefined>;
  enumerate(): Promise<readonly EnumeratedMicrophone[]>;
  open(audio: MediaTrackConstraints): Promise<MediaStream>;
}

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
