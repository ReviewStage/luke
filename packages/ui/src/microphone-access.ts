/**
 * microphone-access.ts -- what the microphone's row and the controls that need the microphone say, from macOS's answer.
 */

import { MICROPHONE_STATUS, type MicrophoneStatus } from "@luke/settings/microphone";

/** Why a dictated clip cannot run: it runs on the account's own OpenAI key, kept under Codex in settings, and none is saved. */
export const OPENAI_KEY_MISSING_NOTE = "Add an OpenAI key in settings";

/**
 * What the row says beneath its name, once the system has answered. Only a
 * state the user has to act on or cannot act on says anything: a granted
 * microphone is already shown as granted, and the row drawn before macOS has
 * been asked carries the Allow button that is the whole answer.
 */
function microphoneStatusDetail(status: MicrophoneStatus): string | undefined {
  switch (status) {
    case MICROPHONE_STATUS.DENIED:
      return "Allow Luke in System Settings › Privacy & Security › Microphone.";
    case MICROPHONE_STATUS.RESTRICTED:
      return "This Mac does not permit microphone access.";
    case MICROPHONE_STATUS.UNKNOWN:
      return "Luke could not read the microphone permission.";
    default:
      return undefined;
  }
}
/** What the Microphone row says, and what it offers. */
interface MicrophoneAccessRow {
  /** Absent wherever the row's name and its controls already say everything. */
  detail?: string;
  /** Whether to offer the button that gives Luke the microphone. */
  offerAccess: boolean;
  /**
   * Whether to offer the way to System Settings. Only where macOS has already
   * been answered: that is the one place its answer can be changed, and the one
   * state where sending someone there is not sending them to look at nothing.
   */
  offerSystemSettings: boolean;
  /** Whether the microphone is Luke's to open, which the row marks with its check. */
  granted: boolean;
}

/**
 * Reads the row from the system's answer. The microphone's use is dictating
 * into a message box, whose clip goes through Luke's service to OpenAI and
 * comes back as words; the macOS prompt is the consent for it, so the ask is
 * offered wherever macOS has not answered, and System Settings wherever it
 * has.
 */
export function microphoneAccessRow(status: MicrophoneStatus): MicrophoneAccessRow {
  const row: MicrophoneAccessRow = {
    offerAccess: status === MICROPHONE_STATUS.NOT_DETERMINED,
    offerSystemSettings:
      status === MICROPHONE_STATUS.GRANTED || status === MICROPHONE_STATUS.DENIED,
    granted: status === MICROPHONE_STATUS.GRANTED,
  };
  const detail = microphoneStatusDetail(status);
  if (detail !== undefined) row.detail = detail;
  return row;
}
