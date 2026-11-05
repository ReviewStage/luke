import { LIVE_READ } from "@repo/features/live-wire";
import {
  type FrameBox,
  PAGE_PICK_ACT,
  PAGE_PICK_TYPE,
  type PagePickAsk,
  pagePickAnswerSchema,
} from "@repo/features/page-pick";
import {
  PAGE_FIT,
  PAGE_FIT_PENDING,
  type PageFit,
  pageFitAfter,
  pageSizeSchema,
} from "@repo/features/page-size";
import type { PagePlace } from "@repo/features/page-wire";
import { PAGE_EMBED_HEIGHT, PageEmbed, type PageEmbedHeight, usePressAway } from "@repo/ui";
import { replyOf } from "@repo/ui/reply-quote";
import { Option, Schema } from "effect";
import { type ReactNode, type RefObject, useEffect, useReducer, useRef, useState } from "react";
import { appPlatform } from "../app-platform.js";
import { useHostRead } from "../use-host-read.js";
import { PAGE_SANDBOX, useFrameLinks } from "./page-pane.js";
import { PAGE_ROOM, usePageTheme } from "./page-theme.js";
import { pressPlace, ReplyPress, useReplyDoor } from "./reply-to-selection.js";

/**
 * shown-page.tsx -- a page an agent showed, drawn where it is told of: under the transcript row of the call that showed it, and under an Inbox thread's line naming it.
 *
 * The page is drawn live, at the version named, in the frame its tab draws
 * it in (`page-pane.tsx`): from the same address, under the same sandbox,
 * its links out opened outside it as the tab opens them. The frame stands as
 * tall as the page reports it is, or at a screenful where the page only ever
 * fills its frame (`@repo/features/page-size`), heard from that frame alone
 * and only in that message's shape, and loads only as it nears the screen.
 * The row drawn above it opens it in its own tab. A line naming a page draws its newest version, from the
 * pages its plan or its agent on no task holds (`LIVE_READ.PAGES`), as a
 * page's chip hangs its card (`chip-cards.tsx`), and nothing while that read
 * is out or where the reader cannot reach the page.
 *
 * Words selected in the page offer Reply over them, as words selected in
 * the transcript around it do (`reply-to-selection.tsx`), and a press lays
 * them into the message box as a quote, wherever a box stands to take them
 * (`useReplyDoor`). No selection in the frame reaches this window, so the
 * frame says the words and where they stand (`@repo/features/page-pick`),
 * heard from that frame alone; Reply goes as they go, as a press lands
 * anywhere else in the window, or as another frame says words of its own,
 * each telling its frame to let its words go. Note that the words are the
 * page's own word, since its scripts share the frame with ours: the worst a
 * page that lies does is offer a quote of itself, which the box shows before
 * anything is sent.
 */

const readSize = Schema.decodeUnknownOption(pageSizeSchema);

/** Reads a message a frame posted as the words selected in it, nothing for anything else a page posts. */
const readPick = Schema.decodeUnknownOption(pagePickAnswerSchema);

/** The height the frame stands at for how the page is fitted. */
function embedHeight(fit: PageFit): PageEmbedHeight {
  if (fit.kind === PAGE_FIT.CONTENT) return { kind: PAGE_EMBED_HEIGHT.CONTENT, height: fit.height };
  if (fit.kind === PAGE_FIT.FILLS) return { kind: PAGE_EMBED_HEIGHT.FILL };
  return { kind: PAGE_EMBED_HEIGHT.STAND_IN };
}

/** How the page in `frame` is fitted, from the heights it reports against the frame's own; pending until it has. */
function useFrameFit(frame: RefObject<HTMLIFrameElement | null>): PageFit {
  const [fit, setFit] = useState<PageFit>(PAGE_FIT_PENDING);
  useEffect(() => {
    const hear = (event: MessageEvent) => {
      const framed = frame.current;
      if (framed === null || framed.contentWindow === null || event.source !== framed.contentWindow)
        return;
      const size = readSize(event.data);
      if (Option.isNone(size)) return;
      const frameHeight = framed.getBoundingClientRect().height;
      setFit((last) => pageFitAfter(last, size.value.height, frameHeight));
    };
    window.addEventListener("message", hear);
    return () => window.removeEventListener("message", hear);
  }, [frame]);
  return fit;
}

/** Words selected in a frame that Reply quotes: the words, and where they stand in the frame's viewport. */
interface FrameSelected {
  readonly quote: string;
  readonly box: FrameBox;
}

/** Tells the page in `frame` to let its words selected go. */
function unselect(frame: RefObject<HTMLIFrameElement | null>): void {
  const ask: PagePickAsk = { type: PAGE_PICK_TYPE, act: PAGE_PICK_ACT.UNSELECT };
  frame.current?.contentWindow?.postMessage(ask, "*");
}

/**
 * Reply over words selected in the page in `frame`, which `onReply` lays
 * into the message box; nothing while none are.
 */
function FrameReply({
  frame,
  onReply,
}: {
  frame: RefObject<HTMLIFrameElement | null>;
  onReply: (reply: string) => void;
}): ReactNode {
  const [selected, setSelected] = useState<FrameSelected | undefined>(undefined);
  const [, redraw] = useReducer((drawn: number) => drawn + 1, 0);
  const layer = useRef<HTMLDivElement>(null);
  const shown = selected !== undefined;
  const letGo = () => {
    setSelected(undefined);
    unselect(frame);
  };

  // The frame says its words as they are selected, and that none are once they go; another frame's words take Reply from this one's.
  useEffect(() => {
    const hear = (event: MessageEvent) => {
      const framed = frame.current?.contentWindow;
      if (framed === null || framed === undefined) return;
      const said = readPick(event.data);
      if (Option.isNone(said) || !("selected" in said.value)) return;
      const words = said.value.selected;
      if (event.source === framed) {
        setSelected(words === null ? undefined : { quote: words.quote, box: words.box });
      } else if (words !== null) {
        setSelected(undefined);
        unselect(frame);
      }
    };
    window.addEventListener("message", hear);
    return () => window.removeEventListener("message", hear);
  }, [frame]);

  // Once offered, Reply follows the frame as the window scrolls, and hides with its pane.
  useEffect(() => {
    if (!shown) return undefined;
    // Note that hiding a pane moves nothing, so its `hidden` attribute is watched for itself.
    const hiding = new MutationObserver(redraw);
    hiding.observe(document.body, { attributes: true, attributeFilter: ["hidden"], subtree: true });
    document.addEventListener("scroll", redraw, true);
    window.addEventListener("resize", redraw);
    return () => {
      hiding.disconnect();
      document.removeEventListener("scroll", redraw, true);
      window.removeEventListener("resize", redraw);
    };
  }, [shown]);

  // A press anywhere else in the window lets the words go, as it lets go words selected in the window itself.
  usePressAway(layer, () => undefined, { onPressAway: shown ? letGo : undefined });

  const framed = frame.current;
  if (selected === undefined || framed === null || framed.closest("[hidden]") !== null) return null;
  const at = framed.getBoundingClientRect();
  const { box } = selected;
  return (
    <ReplyPress
      place={pressPlace({
        left: at.left + box.left,
        top: at.top + box.top,
        right: at.left + box.right,
        bottom: at.top + box.bottom,
      })}
      onReply={() => {
        letGo();
        onReply(replyOf(selected.quote));
      }}
      layer={layer}
    />
  );
}

/** One version of a page, drawn live in the words that tell of it. */
export function ShownPage({
  place,
  pageId,
  version,
  title,
}: {
  place: PagePlace;
  pageId: string;
  version: number;
  title: string;
}): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null);
  useFrameLinks(frame);
  usePageTheme(frame, PAGE_ROOM.WORDS);
  const fit = useFrameFit(frame);
  const replyDoor = useReplyDoor();
  return (
    <div className="my-block-gap">
      <PageEmbed
        frameRef={frame}
        height={embedHeight(fit)}
        frame={{
          title,
          src: appPlatform().pageFrameUrl({ ...place, pageId, version }),
          sandbox: PAGE_SANDBOX,
          lazy: true,
        }}
      />
      {replyDoor === undefined ? null : <FrameReply frame={frame} onReply={replyDoor} />}
    </div>
  );
}

/** A page named by a line of words, drawn live at its newest version as its plan, or its agent on no task, holds its pages; nothing while they are read or where none is the page. */
export function ShownNewestPage({
  place,
  pageId,
}: {
  place: PagePlace;
  pageId: string;
}): ReactNode {
  const page = useHostRead(LIVE_READ.PAGES, place).rows?.find((each) => each.id === pageId);
  if (page === undefined) return null;
  return <ShownPage place={place} pageId={page.id} version={page.version} title={page.title} />;
}
