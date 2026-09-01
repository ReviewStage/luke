import type { InspectionEvent, Observer } from "xstate";

export interface VoiceMachineInspectorGate {
  captureMode: boolean;
  fixtureMode: boolean;
  packaged: boolean;
  requested: boolean;
}

export interface VoiceMachineInspector {
  inspect: Observer<InspectionEvent>;
  stop(): void;
}

export function voiceMachineInspectionAllowed(gate: VoiceMachineInspectorGate): boolean {
  return gate.requested && !gate.packaged && !gate.fixtureMode && !gate.captureMode;
}

export async function createVoiceMachineInspector(
  gate: VoiceMachineInspectorGate,
): Promise<VoiceMachineInspector | undefined> {
  if (!voiceMachineInspectionAllowed(gate)) return undefined;
  const { createBrowserInspector } = await import("@statelyai/inspect");
  const inspector = createBrowserInspector({
    sanitizeEvent: (event) => ({ type: event.type }),
    sanitizeContext: (context) => ({
      turnOrigin: typeof context.turnOrigin === "string" ? context.turnOrigin : undefined,
    }),
  });
  return {
    inspect: inspector.inspect,
    stop: () => inspector.stop(),
  };
}
