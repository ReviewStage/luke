import type { RealtimeConnection, RealtimeDiagnostics } from "@sidecar/core";
import type { Effect } from "effect";
import type { Http } from "./services/http";

/**
 * What the main process asks of whichever credential source voice runs on —
 * the developer's own OpenAI key or the signed-in hosted service. The renderer
 * never sees the difference: either way it receives an ephemeral connection
 * aimed at OpenAI's own calls endpoint, and diagnostics that can say why not.
 */
export interface RealtimeCredentialMinter {
  mint(): Effect.Effect<RealtimeConnection | undefined, never, Http>;
  setVoice(voice: string | undefined): void;
  setSpeed(speed: number | undefined): void;
  diagnostics(): RealtimeDiagnostics;
}
