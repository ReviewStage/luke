/**
 * avatar-tee-worklet.ts -- the audio worklet that turns Luke's voice into the avatar's PCM16 chunks.
 *
 * Built as its own bundle (`renderer/avatar-tee-worklet.js`) and loaded by
 * `avatar-tee.ts` with `audioWorklet.addModule`, from the voice window's own
 * files: a worklet module answers to `script-src`, which `voice.html` keeps at
 * `'self'`, so it cannot be handed over as a `blob:`. It runs on the audio
 * thread, in a scope with none of the window's globals, so the few it does
 * reach are declared here rather than taken from the DOM library.
 */

import { AVATAR_TEE_PROCESSOR, createPcmChunker } from "./pcm-chunker";

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

declare function registerProcessor(
  name: string,
  processor: new () => AudioWorkletProcessor & {
    process(inputs: Float32Array[][]): boolean;
  },
): void;

/**
 * The node is made with one input channel, explicitly, so the graph has
 * already mixed Luke's track down to mono by the time a quantum reaches
 * `process`. An input with no channel is a quantum with nothing connected,
 * which adds nothing to a chunk. Each completed chunk's buffer is transferred,
 * not copied, to the window. The processor keeps itself alive by answering
 * `true`, since the node has no output for the graph to keep it by.
 */
class AvatarTeeProcessor extends AudioWorkletProcessor {
  private readonly chunker = createPcmChunker();

  process(inputs: Float32Array[][]): boolean {
    const samples = inputs[0]?.[0];
    if (samples === undefined) return true;
    for (const chunk of this.chunker.push(samples)) {
      this.port.postMessage(chunk.buffer, [chunk.buffer]);
    }
    return true;
  }
}

registerProcessor(AVATAR_TEE_PROCESSOR, AvatarTeeProcessor);
