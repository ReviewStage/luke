import { SCROLL_FADE, SCROLL_GUTTER, ScrollArea, TIME_LOOK, Time } from "@repo/ui";
import type { Actor } from "@repo/ui/actor-model";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import type { ReactNode } from "react";
import { ActorRef } from "../actor-ref.js";

const DOCUMENT_BODY_CLASS = "description-document-body";

export function documentScrollerOf(element: Element): HTMLElement | undefined {
  const body = element.closest(`.${DOCUMENT_BODY_CLASS}`);
  return body?.parentElement ?? undefined;
}

export function DocumentScroll({
  ref,
  children,
}: {
  ref?: React.Ref<HTMLDivElement> | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <ScrollArea ref={ref} fade={SCROLL_FADE.BOTH} gutter={SCROLL_GUTTER.STABLE}>
      <div
        className={`${DOCUMENT_BODY_CLASS} py-list-inset px-ui-2 select-text [--accent:var(--voice-app)]`}
      >
        {children}
      </div>
    </ScrollArea>
  );
}

export function DocumentByline({
  creator,
  maker,
  createdAt,
  now,
  edited,
  saved,
  end,
}: {
  creator: Actor | undefined;
  maker?: { readonly actor: Actor; readonly fromTask?: string | undefined } | undefined;
  createdAt: number;
  now: number;
  edited?: ReactNode;
  saved?: ReactNode;
  end?: ReactNode;
}): React.JSX.Element {
  return (
    <p className="description-byline mx-0 mt-0 mb-block-gap flex flex-wrap gap-x-field-gap gap-y-tight-gap text-caption text-muted-foreground pointer-coarse:gap-y-block-gap">
      <ReplayUnmask>
        <span className="actor-line">
          {creator === undefined && maker === undefined ? "Created" : "Created by "}
          {maker === undefined ? null : (
            <>
              <ReplayMask>
                <ActorRef actor={maker.actor} />
              </ReplayMask>
              {creator === undefined ? null : " for "}
            </>
          )}
          {creator === undefined ? null : (
            <ReplayMask>
              <ActorRef actor={creator} sentence />
            </ReplayMask>
          )}
          {" · "}
          <Time at={createdAt} now={now} look={TIME_LOOK.AGO} />
        </span>
        {maker?.fromTask === undefined ? null : (
          <>
            {" "}
            <span className="actor-line description-byline-from">
              From <ReplayMask>{maker.fromTask}</ReplayMask>
            </span>
          </>
        )}
        {edited === undefined ? null : (
          <>
            {" "}
            <span className="actor-line description-byline-edited">{edited}</span>
          </>
        )}
        {saved}
      </ReplayUnmask>
      {end}
    </p>
  );
}
