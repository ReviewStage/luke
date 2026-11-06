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
import { useQuery } from "@tanstack/react-query";
import { Option, Schema } from "effect";
import { type ReactNode, type RefObject, useEffect, useReducer, useRef, useState } from "react";
import { appPlatform } from "../app-platform.js";
import { pagesQuery } from "../live-reads.js";

import { PAGE_SANDBOX, useFrameLinks } from "./page-pane.js";
import { PAGE_ROOM, usePageTheme } from "./page-theme.js";
import { pressPlace, ReplyPress, useReplyDoor } from "./reply-to-selection.js";

const readSize = Schema.decodeUnknownOption(pageSizeSchema);

const readPick = Schema.decodeUnknownOption(pagePickAnswerSchema);

function embedHeight(fit: PageFit): PageEmbedHeight {
  if (fit.kind === PAGE_FIT.CONTENT) return { kind: PAGE_EMBED_HEIGHT.CONTENT, height: fit.height };
  if (fit.kind === PAGE_FIT.FILLS) return { kind: PAGE_EMBED_HEIGHT.FILL };
  return { kind: PAGE_EMBED_HEIGHT.STAND_IN };
}

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

interface FrameSelected {
  readonly quote: string;
  readonly box: FrameBox;
}

function unselect(frame: RefObject<HTMLIFrameElement | null>): void {
  const ask: PagePickAsk = { type: PAGE_PICK_TYPE, act: PAGE_PICK_ACT.UNSELECT };
  frame.current?.contentWindow?.postMessage(ask, "*");
}

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

  useEffect(() => {
    const element = frame.current;
    const hear = (event: MessageEvent) => {
      const framed = frame.current?.contentWindow;
      if (framed === null || framed === undefined) return;
      const said = readPick(event.data);
      if (Option.isNone(said)) return;
      const words = "selected" in said.value ? said.value.selected : undefined;
      if (event.source === framed && words !== undefined) {
        setSelected(words === null ? undefined : { quote: words.quote, box: words.box });
      } else if (event.source !== framed && (words != null || "pressed" in said.value)) {
        setSelected(undefined);
        unselect(frame);
      }
    };
    const loaded = () => setSelected(undefined);
    window.addEventListener("message", hear);
    element?.addEventListener("load", loaded);
    return () => {
      window.removeEventListener("message", hear);
      element?.removeEventListener("load", loaded);
    };
  }, [frame]);

  useEffect(() => {
    if (!shown) return undefined;
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

export function ShownNewestPage({
  place,
  pageId,
}: {
  place: PagePlace;
  pageId: string;
}): ReactNode {
  const page = useQuery(pagesQuery(place)).data?.find((each) => each.id === pageId);
  if (page === undefined) return null;
  return <ShownPage place={place} pageId={page.id} version={page.version} title={page.title} />;
}
