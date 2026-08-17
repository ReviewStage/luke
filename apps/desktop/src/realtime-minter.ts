import type { RealtimeConnection, RealtimeDiagnostics } from "@sidecar/core";

/**
 * What the main process asks of whichever credential source voice runs on —
 * the developer's own OpenAI key or the signed-in hosted service. The renderer
 * never sees the difference: either way it receives an ephemeral connection
 * aimed at OpenAI's own calls endpoint, and diagnostics that can say why not.
 */
export interface RealtimeCredentialMinter {
  mint(): Promise<RealtimeConnection | undefined>;
  setVoice(voice: string | undefined): void;
  setSpeed(speed: number | undefined): void;
  diagnostics(): RealtimeDiagnostics;
}
