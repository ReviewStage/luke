/**
 * sample-player.ts -- plays one option's clip at a time, for a choice whose values are heard before they are chosen.
 *
 * A row offers one clip at a time, so a new one stops the one before it
 * rather than talking over it, and a row that goes away stops its clip with
 * it. A clip that ends, fails to load, or is refused by the window (a page
 * that has not been pressed yet may play nothing) leaves the row as though it
 * had never played.
 */

import { useEffect, useRef, useState } from "react";
import { assetUrl } from "../app-platform.js";

/** What a row reads and presses: the path of the clip playing, if any, and the two presses. */
export interface SamplePlayer {
  playing: string | undefined;
  play: (path: string) => void;
  stop: () => void;
}

export function useSamplePlayer(): SamplePlayer {
  const clip = useRef<HTMLAudioElement | undefined>(undefined);
  const [playing, setPlaying] = useState<string | undefined>(undefined);
  // Note that a row unmounted mid-clip silences it, because nothing could stop it after.
  useEffect(() => () => clip.current?.pause(), []);
  const stop = () => {
    clip.current?.pause();
    clip.current = undefined;
    setPlaying(undefined);
  };
  const play = (path: string) => {
    clip.current?.pause();
    const audio = new Audio(assetUrl(path));
    clip.current = audio;
    // Only the clip still current may say it is over, so a stopped one ending late changes nothing.
    const over = () => {
      if (clip.current !== audio) return;
      clip.current = undefined;
      setPlaying(undefined);
    };
    audio.addEventListener("ended", over);
    audio.addEventListener("error", over);
    setPlaying(path);
    audio.play().catch(over);
  };
  return { playing, play, stop };
}
