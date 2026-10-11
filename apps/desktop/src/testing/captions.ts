// captions.ts -- the shell's live captions for a test: nothing being said unless the test says it.
import type { CaptionStripProps } from "../renderer/caption-strip";
import type { CaptionContent } from "../renderer/use-caption-presentation";

/** The strip as `App` hands it to the shell, holding `content` and drawing it while `shown`. */
export function captionStripProps(
  content: CaptionContent | undefined = undefined,
  shown = content !== undefined,
): CaptionStripProps {
  return {
    caption: { content, shown },
    volumeHint: { wanted: false, text: "Unmute your Mac to hear Luke", onDismiss: () => undefined },
  };
}
