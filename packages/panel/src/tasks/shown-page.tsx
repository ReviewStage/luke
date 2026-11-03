import { useAtomValue } from "@effect/atom-react";
import { pageSizeSchema } from "@repo/features/page-size";
import type { PageLine, PagePlace } from "@repo/features/page-wire";
import { PageEmbed } from "@repo/ui";
import { Option, Schema } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { appPlatform } from "../app-platform.js";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";
import { agentPagesAtom, taskPagesAtom } from "./chip-cards.js";
import { PAGE_SANDBOX, useFrameLinks } from "./page-pane.js";

/**
 * shown-page.tsx -- a page an agent showed, drawn where it is told of: under the transcript row of the call that showed it, and under an Inbox thread's line naming it.
 *
 * The page is drawn live, at the version named, in the frame its tab draws
 * it in (`page-pane.tsx`): from the same address, under the same sandbox,
 * its links out opened outside it as the tab opens them. The frame stands as
 * tall as the page reports it is (`@repo/features/page-size`), heard from
 * that frame alone and only in that message's shape, and loads only as it
 * nears the screen. A line naming a page draws its newest version, read as
 * a page's chip reads it to hang its card (`chip-cards.tsx`), and nothing
 * while that read is out or where the reader cannot reach the page.
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

/** The page among those read, drawn at its newest version; nothing while they are read or where none is the page. */
function NewestOf({
  place,
  pages,
  pageId,
}: {
  place: PagePlace;
  pages: readonly PageLine[] | undefined;
  pageId: string;
}): ReactNode {
  const page = pages?.find((each) => each.id === pageId);
  if (page === undefined) return null;
  return <ShownPage place={place} pageId={page.id} version={page.version} title={page.title} />;
}

/** A page of a plan not open, or of an agent on no task, at its newest version as read. */
function ReadNewestPage({
  place,
  read,
  pageId,
}: {
  place: PagePlace;
  read: AsyncResult.AsyncResult<readonly PageLine[] | undefined>;
  pageId: string;
}): ReactNode {
  if (!AsyncResult.isSuccess(read)) return null;
  return <NewestOf place={place} pages={read.value} pageId={pageId} />;
}

function ReadTaskNewestPage({ taskId, pageId }: { taskId: string; pageId: string }): ReactNode {
  const read = useAtomValue(taskPagesAtom(taskId));
  return <ReadNewestPage place={{ taskId }} read={read} pageId={pageId} />;
}

function ReadAgentNewestPage({ agentId, pageId }: { agentId: string; pageId: string }): ReactNode {
  const read = useAtomValue(agentPagesAtom(agentId));
  return <ReadNewestPage place={{ agentId }} read={read} pageId={pageId} />;
}

/** A plan's page at its newest version: the open plan's as the window holds its pages, live as they move, and any other's as read. */
function TaskNewestPage({ taskId, pageId }: { taskId: string; pageId: string }): ReactNode {
  const tasks = useAppSlice(APP_SLICE.TASKS);
  const held = tasks?.activeTaskId === taskId ? tasks.pages : undefined;
  if (held === undefined) return <ReadTaskNewestPage taskId={taskId} pageId={pageId} />;
  return <NewestOf place={{ taskId }} pages={held} pageId={pageId} />;
}

/** A page named by a line of words, drawn live at its newest version. */
export function ShownNewestPage({
  place,
  pageId,
}: {
  place: PagePlace;
  pageId: string;
}): ReactNode {
  return "taskId" in place ? (
    <TaskNewestPage taskId={place.taskId} pageId={pageId} />
  ) : (
    <ReadAgentNewestPage agentId={place.agentId} pageId={pageId} />
  );
}
