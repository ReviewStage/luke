import { LINK_PLACE } from "@repo/features/link-grammar";
import {
  PAGE_SHOWER,
  type PageLine,
  type PagePlace,
  type PageShower,
} from "@repo/features/page-wire";
import { HoverCard, HoverCardHead, HoverCardSkeleton, PageThumb, Time, useMinute } from "@repo/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor, APP_ACTOR } from "@repo/ui/actor-model";
import { TAB_WORDS } from "@repo/ui/tab-strip-model";
import { AppWindowIcon } from "lucide-react";
import { useRef } from "react";
import { PROVENANCE_VERB, ProvenanceRow } from "../actor-ref.js";
import { appPlatform } from "../app-platform.js";
import { PAGE_SANDBOX } from "./page-pane.js";
import { PAGE_ROOM, usePageTheme } from "./page-theme.js";
import { useKnownNames } from "./use-known-names.js";
import { useOpenPlace } from "./use-open-link.js";

interface CardPage {
  readonly place: PagePlace;
  readonly page: PageLine;
}

function PagePreview({ place, page }: CardPage): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null);
  usePageTheme(frame, PAGE_ROOM.OWN);
  return (
    <PageThumb
      frameRef={frame}
      frame={{
        title: `${page.title} preview`,
        src: appPlatform().pageFrameUrl({ ...place, pageId: page.id, version: page.version }),
        sandbox: PAGE_SANDBOX,
      }}
    />
  );
}

function showerActor(
  shownBy: PageShower | undefined,
  place: PagePlace,
  agents: ReadonlyMap<string, string>,
): Actor | undefined {
  if (shownBy === undefined) return undefined;
  if (shownBy.kind === PAGE_SHOWER.APP) return APP_ACTOR;
  return {
    kind: ACTOR_KIND.AGENT,
    agentId: shownBy.agentId,
    taskId: "taskId" in place ? place.taskId : undefined,
    name: agents.get(shownBy.agentId) ?? TAB_WORDS.AGENT,
    provider: undefined,
    state: ACTOR_STATE.REST,
  };
}

function useShowerDoor(shower: Actor | undefined): (() => void) | undefined {
  const openPlace = useOpenPlace();
  if (openPlace === undefined || shower?.kind !== ACTOR_KIND.AGENT) return undefined;
  const { agentId, taskId } = shower;
  if (agentId === undefined) return undefined;
  return () =>
    openPlace({
      kind: LINK_PLACE.AGENT,
      ...(taskId === undefined ? undefined : { planId: taskId }),
      agentId,
    });
}

export function PageCard({ place, page }: CardPage): React.JSX.Element {
  const now = useMinute();
  const shower = showerActor(page.shownBy, place, useKnownNames().agents);
  const openShower = useShowerDoor(shower);
  return (
    <HoverCard data-page-card="">
      <HoverCardHead
        glyph={<AppWindowIcon aria-hidden="true" />}
        name={page.title}
        sub={page.version > 1 ? `Version ${page.version}` : undefined}
        corner={<Time at={page.at} now={now} hint={false} />}
      />
      {shower === undefined ? null : (
        <ProvenanceRow verb={PROVENANCE_VERB.SHOWN} actor={shower} now={now} onOpen={openShower} />
      )}
      <PagePreview key={`${page.id}/${page.version}`} place={place} page={page} />
    </HoverCard>
  );
}

const UNNAMED_PAGE = "Page";

function shownName(name: string | undefined): string {
  return name === undefined || name === "" ? UNNAMED_PAGE : name;
}

export function PageNameCard({ name }: { name: string | undefined }): React.JSX.Element {
  return (
    <HoverCard data-page-card="">
      <HoverCardHead glyph={<AppWindowIcon aria-hidden="true" />} name={shownName(name)} />
    </HoverCard>
  );
}

export function PageNameSkeleton({ name }: { name: string | undefined }): React.JSX.Element {
  return (
    <HoverCardSkeleton
      glyph={<AppWindowIcon aria-hidden="true" />}
      name={shownName(name)}
      sub
      data-page-card=""
    />
  );
}
