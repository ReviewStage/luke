/**
 * pcm-tee-worklet.ts -- the AudioWorklet that tees Luke's remote track into PCM16 chunks for the avatar feed.
 *
 * Built as its own bundle (`PCM_TEE.SCRIPT`) and loaded by `./start-avatar-feed.ts`
 * into a context opened at `PCM_SAMPLE_RATE`, so the browser has already
 * resampled the 48 kHz remote track by the time a quantum arrives here and
 * the node's mono input has already mixed it down. Each whole chunk is
 * posted, its buffer transferred, and the gate runs on the window's thread.
 */

import { PCM_TEE } from "@luke/voice/avatar-pcm";
import { createPcmChunker } from "@luke/voice/avatar-pcm-chunker";

// The worklet scope's globals, which the DOM library does not declare.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

class PcmTeeProcessor extends AudioWorkletProcessor {
  private readonly chunk = createPcmChunker();

  /** Answers true so the node keeps processing through an input that falls silent. */
  process(inputs: Float32Array[][]): boolean {
    const mono = inputs[0]?.[0];
    if (!mono) return true;
    for (const chunk of this.chunk(mono)) this.port.postMessage(chunk, [chunk.buffer]);
    return true;
  }
}

registerProcessor(PCM_TEE.PROCESSOR, PcmTeeProcessor);
