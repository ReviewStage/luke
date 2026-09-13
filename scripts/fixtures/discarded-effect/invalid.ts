import { Effect, Layer, Stream } from "effect";

declare const deleteConversation: (sessionKey: string) => Effect.Effect<void>;
declare const frames: Stream.Stream<string>;
declare const services: Layer.Layer<never>;

export async function clearConversation(sessionKey: string): Promise<void> {
  void deleteConversation(sessionKey);
  // An Effect is not thenable: this answers the description and runs nothing.
  await deleteConversation(sessionKey);
  Effect.logInfo("cleared");
  Stream.runDrain(frames);
  Stream.map(frames, (frame) => frame.trim());
  Layer.orDie(services);
}
