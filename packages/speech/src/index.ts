export {
  decodeSpeechAudio,
  ELEVENLABS_SAMPLE_RATE,
  elevenlabsSpeechUrl,
  MAXIMUM_SPEECH_ERROR_LENGTH,
  parseSpeechFrame,
  type SpeechServerFrame,
  speechCloseFrame,
  speechOpeningFrame,
  speechTextFrame,
} from "./elevenlabs-socket.js";
export {
  mintElevenlabsToken,
  type TokenMintResult,
  tokenMintExplanation,
} from "./elevenlabs-token.js";
export {
  ELEVENLABS_VOICES_URL,
  listElevenlabsVoices,
  type VoiceListResult,
  voiceListExplanation,
} from "./elevenlabs-voices.js";
export {
  ELEVENLABS_OUTCOME,
  type ElevenlabsFailure,
  type ElevenlabsOutcome,
  isSpeechProvider,
  isSpeechVoiceId,
  MAXIMUM_VOICE_FIELD_LENGTH,
  SPEECH_PROVIDER,
  type SpeechProvider,
  type SpeechVoice,
} from "./speech-provider.js";
