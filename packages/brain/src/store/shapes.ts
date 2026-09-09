/**
 * The stored shapes and their readings, Node-free: how one envelope becomes
 * the next as a delta the tables can apply, and how a transcript event is
 * kept and read back. A store over another database — the hosted tier's
 * Postgres — writes and reads the same rows through these, so the two stores
 * cannot drift in what a checkpoint or a transcript payload means.
 */
export {
  type BrainItemsDelta,
  type BrainJournalDelta,
  type BrainRequestsDelta,
  type BrainStateDelta,
  type BrainStateSave,
  brainStateSave,
  EnvelopeTracker,
  SAVE_KIND,
  type SaveKind,
} from "./envelope.js";
export {
  contextInputFromWire,
  transcriptEventFromPayload,
  transcriptPayload,
} from "./transcript-payload.js";
