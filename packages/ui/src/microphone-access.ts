import { PRODUCT_NAME } from "@repo/features/product-name";
import { MICROPHONE_STATUS, type MicrophoneStatus } from "@repo/settings/microphone";

export const OPENAI_KEY_MISSING_NOTE = "Add an OpenAI key in Settings";

function microphoneStatusDetail(status: MicrophoneStatus): string | undefined {
  switch (status) {
    case MICROPHONE_STATUS.DENIED:
      return `Allow ${PRODUCT_NAME} in System Settings › Privacy & Security › Microphone.`;
    case MICROPHONE_STATUS.RESTRICTED:
      return "This Mac does not permit microphone access.";
    case MICROPHONE_STATUS.UNKNOWN:
      return "Could not read the microphone permission.";
    default:
      return undefined;
  }
}
interface MicrophoneAccessRow {
  detail?: string;
  offerAccess: boolean;
  offerSystemSettings: boolean;
  granted: boolean;
}

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
