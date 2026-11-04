import { type Ref, useId, useState } from "react";
import { cssCustomProperties } from "../../css.js";
import { GLYPH } from "../../icons/glyph-registry.js";
import { Maximize2Icon, PanelRightOpenIcon } from "../../icons/icons.js";
import { BUTTON_VARIANT, IconButton } from "../button/button.js";
import { DIALOG_SIZE, Dialog, DialogCard } from "../dialog/dialog.js";
import { OneLine } from "../one-line/one-line.js";
import type { PageThumbFrame } from "../page-thumb/page-thumb.js";
import { TEXT_ELEMENT, Text } from "../text/text.js";
import { TEXT_VARIANT } from "../text/text-role.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * page-embed.tsx -- a page drawn in written words: the whole page, live, in a frame as wide as the words and as tall as the page, with no card around it, and the page opened over the window or in its tab from its corner.
 *
 * Where an agent shows a page, the page stands in the words that tell of it,
 * a transcript's or an Inbox thread's, rather than only behind a chip. It is
 * drawn on the words' own ground, as a picture is, with no border or fill of
 * ours around it, only its corners rounded, so a page that leaves its root
 * clear reads as part of the words and one that paints its own ground still
 * stands as a soft-cornered block. It is sandboxed as the caller says, and
 * may be read and pressed in as in its tab.
 *
 * Its height is the caller's to hand, as the page reports it: until it does,
 * the frame stands at a stand-in's height; once it has, at the page's whole
 * height, so the page is scrolled with the words rather than inside a box of
 * its own; and at a screenful where the page fills whatever frame holds it
 * (`@repo/features/page-size`'s `pageFitAfter`), since such a page has no
 * height of its own to stand at. Until the page has loaded the frame is
 * hidden over a quiet ground, because the blank document it loads through is
 * light only and would flash in a dark window. The frame loads only once it
 * nears the screen where the caller asks, so a long transcript loads the
 * pages it is read past, not every page it holds. What the page draws is the
 * task's, so the frame is left out of the screen recording.
 *
 * Its corner offers, under the pointer or always to a finger, the page full
 * screen, over the dimmed window at the window's size (`PageEmbedViewer`),
 * and the page in its own tab, where the caller can open one. A narrow room,
 * a phone's, draws no corner, because there it would stand over the page for
 * good and offer nothing new: its tab and full screen are one screen, and the
 * row each caller draws above the page already opens it.
 */

const LABEL = {
  FULL_SCREEN: "Full screen",
  OPEN_IN_PANEL: "Open in panel",
  CLOSE: "Close",
} as const;

/** How the frame stands: before the page says, as tall as it says, or a screenful for a page that fills its frame. */
export const PAGE_EMBED_HEIGHT = {
  STAND_IN: "stand-in",
  CONTENT: "content",
  FILL: "fill",
} as const;

export type PageEmbedHeight =
  | { readonly kind: typeof PAGE_EMBED_HEIGHT.STAND_IN }
  | { readonly kind: typeof PAGE_EMBED_HEIGHT.CONTENT; readonly height: number }
  | { readonly kind: typeof PAGE_EMBED_HEIGHT.FILL };

/** The frame's class and style for how it stands. */
function frameSize(height: PageEmbedHeight): {
  className: string;
  style: React.CSSProperties | undefined;
} {
  if (height.kind === PAGE_EMBED_HEIGHT.CONTENT) {
    return {
      className: "h-page-embed",
      style: cssCustomProperties({ "--page-embed-height": `${height.height}px` }),
    };
  }
  return {
    className:
      height.kind === PAGE_EMBED_HEIGHT.FILL ? "h-page-embed-fill" : "h-page-embed-stand-in",
    style: undefined,
  };
}

/** Whether the frame has loaded the page it names now, and the load to hand it. */
function useLoaded(src: string): { loaded: boolean; onLoaded: () => void } {
  const [loadedFrom, setLoadedFrom] = useState<string | undefined>(undefined);
  return { loaded: loadedFrom === src, onLoaded: () => setLoadedFrom(src) };
}

/** The page's own frame, hidden until it has loaded. */
function LiveFrame({
  frame,
  frameRef,
  loaded,
  onLoaded,
  className,
  style,
}: {
  frame: PageThumbFrame;
  frameRef?: Ref<HTMLIFrameElement> | undefined;
  loaded: boolean;
  onLoaded: () => void;
  className: string;
  style?: React.CSSProperties | undefined;
}): React.JSX.Element {
  return (
    <iframe
      ref={frameRef}
      className={[
        "ui-page-embed-frame block w-full border-0 transition-opacity duration-(--ui-duration-hover) ease-motion-exit",
        loaded ? "opacity-100" : "opacity-0",
        className,
      ].join(" ")}
      style={style}
      title={frame.title}
      src={frame.src}
      sandbox={frame.sandbox}
      allow=""
      referrerPolicy="no-referrer"
      loading={frame.lazy === true ? "lazy" : undefined}
      onLoad={onLoaded}
    />
  );
}

/** A page drawn in words, live, as tall as `height` says, its corner opening it full screen and in its tab. */
export function PageEmbed({
  frame,
  height,
  frameRef,
  onFullScreen,
  onOpenInPanel,
}: {
  /** The page: its address, the sandbox it runs under, its title for tooling, and whether it loads lazily. */
  frame: PageThumbFrame;
  /** How tall the frame stands, as the page reported. */
  height: PageEmbedHeight;
  /** The frame itself, which the caller hears the page's messages from. */
  frameRef?: Ref<HTMLIFrameElement> | undefined;
  /** Opens the page over the window; none offers no Full screen. */
  onFullScreen?: (() => void) | undefined;
  /** Opens the page in its own tab; none where the place drawing it opens no tabs. */
  onOpenInPanel?: (() => void) | undefined;
}): React.JSX.Element {
  const size = frameSize(height);
  const load = useLoaded(frame.src);
  const acts = onFullScreen !== undefined || onOpenInPanel !== undefined;
  return (
    <div
      className="ui-page-embed ph-no-capture group/page-embed relative overflow-hidden rounded-card bg-muted data-[loaded=true]:bg-transparent"
      data-loaded={String(load.loaded)}
    >
      <LiveFrame
        frame={frame}
        frameRef={frameRef}
        {...load}
        className={size.className}
        style={size.style}
      />
      {acts ? (
        <div className="ui-page-embed-acts absolute top-ui-8 right-ui-8 flex gap-ui-2 rounded-control bg-veil p-ui-2 opacity-0 transition-opacity duration-(--ui-duration-hover) ease-motion-exit group-hover/page-embed:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100 room-narrow:hidden">
          {onOpenInPanel === undefined ? null : (
            <Tooltip label={LABEL.OPEN_IN_PANEL}>
              <IconButton
                icon={<PanelRightOpenIcon aria-hidden="true" />}
                label={LABEL.OPEN_IN_PANEL}
                variant={BUTTON_VARIANT.MEDIA}
                onClick={onOpenInPanel}
              />
            </Tooltip>
          )}
          {onFullScreen === undefined ? null : (
            <Tooltip label={LABEL.FULL_SCREEN}>
              <IconButton
                icon={<Maximize2Icon aria-hidden="true" />}
                label={LABEL.FULL_SCREEN}
                variant={BUTTON_VARIANT.MEDIA}
                onClick={onFullScreen}
              />
            </Tooltip>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A page opened full screen: over the dimmed window at the window's size,
 * under a head naming it, with the page in its tab and Close at its end.
 * Escape or a press on the dimmed window closes it, as every dialog's does.
 */
export function PageEmbedViewer({
  frame,
  frameRef,
  onOpenInPanel,
  onClose,
}: {
  /** The page, drawn eagerly, since it is opened to be seen. */
  frame: PageThumbFrame;
  /** The frame itself, which the caller hears the page's messages from. */
  frameRef?: Ref<HTMLIFrameElement> | undefined;
  /** Opens the page in its own tab; none where the place drawing it opens no tabs. */
  onOpenInPanel?: (() => void) | undefined;
  onClose: () => void;
}): React.JSX.Element {
  const titleId = useId();
  const load = useLoaded(frame.src);
  return (
    <Dialog open size={DIALOG_SIZE.WINDOW} labelledBy={titleId} onDismiss={onClose}>
      <DialogCard>
        <header className="ui-page-embed-viewer-head flex flex-none items-center gap-ui-4 border-b border-border py-ui-4 pr-ui-6 pl-ui-12">
          <Text
            as={TEXT_ELEMENT.H2}
            variant={TEXT_VARIANT.SECTION}
            id={titleId}
            className="mr-auto min-w-0"
          >
            <OneLine>{frame.title}</OneLine>
          </Text>
          {onOpenInPanel === undefined ? null : (
            <Tooltip label={LABEL.OPEN_IN_PANEL}>
              <IconButton
                icon={<PanelRightOpenIcon aria-hidden="true" />}
                label={LABEL.OPEN_IN_PANEL}
                onClick={onOpenInPanel}
              />
            </Tooltip>
          )}
          <Tooltip label={LABEL.CLOSE}>
            <IconButton icon={<GLYPH.CLOSE />} label={LABEL.CLOSE} onClick={onClose} />
          </Tooltip>
        </header>
        <div className="ui-page-embed-viewer-body ph-no-capture flex min-h-0 flex-auto">
          <LiveFrame
            frame={{ ...frame, lazy: false }}
            frameRef={frameRef}
            {...load}
            className="min-h-0 flex-auto"
          />
        </div>
      </DialogCard>
    </Dialog>
  );
}
