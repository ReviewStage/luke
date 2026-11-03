import { LIVE_READ } from "@repo/features/live-wire";
import { pageSizeSchema } from "@repo/features/page-size";
import type { PagePlace } from "@repo/features/page-wire";
import { PageEmbed } from "@repo/ui";
import { Option, Schema } from "effect";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { appPlatform } from "../app-platform.js";
import { useHostRead } from "../use-host-read.js";
import { PAGE_SANDBOX, useFrameLinks } from "./page-pane.js";

/**
 * shown-page.tsx -- a page an agent showed, drawn where it is told of: under the transcript row of the call that showed it, and under an Inbox thread's line naming it.
 *
 * The page is drawn live, at the version named, in the frame its tab draws
 * it in (`page-pane.tsx`): from the same address, under the same sandbox,
 * its links out opened outside it as the tab opens them. The frame stands as
 * tall as the page reports it is (`@repo/features/page-size`), heard from
 * that frame alone and only in that message's shape, and loads only as it
 * nears the screen. A line naming a page draws its newest version, from the
 * pages its plan or its agent on no task holds (`LIVE_READ.PAGES`), as a
 * page's chip hangs its card (`chip-cards.tsx`), and nothing while that read
 * is out or where the reader cannot reach the page.
 */

const readSize = Schema.decodeUnknownOption(pageSizeSchema);

/** The height the page in `frame` last reported; none until it has. */
function useFrameHeight(frame: RefObject<HTMLIFrameElement | null>): number | undefined {
  const [height, setHeight] = useState<number>();
  useEffect(() => {
    const hear = (event: MessageEvent) => {
      const framed = frame.current?.contentWindow;
      if (framed === null || framed === undefined || event.source !== framed) return;
      const size = readSize(event.data);
      if (Option.isSome(size)) setHeight(size.value.height);
    };
    window.addEventListener("message", hear);
    return () => window.removeEventListener("message", hear);
  }, [frame]);
  return height;
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
  const height = useFrameHeight(frame);
  return (
    <div className="my-block-gap">
      <PageEmbed
        frameRef={frame}
        height={height}
        frame={{
          title,
          src: appPlatform().pageFrameUrl({ ...place, pageId, version }),
          sandbox: PAGE_SANDBOX,
          lazy: true,
        }}
      />
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
