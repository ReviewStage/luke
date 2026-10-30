import type { AgentInboxScope } from "@luke/features/agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import { LIVE_READ } from "@luke/features/live-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { AppHolderInbox, AppHostRead, AppInboxItems } from "@luke/host/app-state";
import * as Atom from "effect/reactivity/Atom";
import { useCallback, useEffect } from "react";
import { askAct, tellAct } from "./act.js";
import { streamFrom } from "./act-stream.js";
import { APP_SLICE, useAppSlice } from "./use-app-state.js";

/**
 * use-host-read.ts -- the one way a surface reads server data: a read the host holds for the panel, drawn from app state, with where it stands and Try again.
 *
 * The host follows each read for as long as its lifetime holds it
 * (`@luke/host`'s `live-collection.ts`) and lays its rows in the app-state
 * slice named for it (`LIVE_READ`), which outlives every page, so a surface
 * drawn again draws its rows in its first frame, before anything is pushed.
 * A read is loading until it first answers, failed where it said it could
 * not answer before it ever had, and ready from its first rows on: one that
 * holds rows never says loading again. A keyed read, a plan's or an agent's
 * own inbox, is held by the surface that reads it: the host follows it
 * while any surface holds it and a while after, so a holder chosen again
 * draws from where its read stands. Nothing else in the panel opens a
 * follow (`anti-slop/no-follow-outside-host-read`).
 */

export const HOST_READ_STATUS = {
  LOADING: "loading",
  READY: "ready",
  FAILED: "failed",
} as const;

export type HostReadStatus = (typeof HOST_READ_STATUS)[keyof typeof HOST_READ_STATUS];

/** A read as a surface draws it: its rows once it answered, where it stands, and Try again. */
export interface HostRead<Rows> {
  readonly rows: Rows | undefined;
  readonly status: HostReadStatus;
  readonly retry: () => void;
}

/** The holder whose own inbox a surface reads: a plan, or an agent, by its id. */
export type InboxHolderKey = AgentInboxScope;

/** Where a read stands, from what the host holds of it. */
function statusOf(held: AppHostRead<unknown> | undefined): HostReadStatus {
  if (held?.rows !== undefined) return HOST_READ_STATUS.READY;
  return held?.failed === true ? HOST_READ_STATUS.FAILED : HOST_READ_STATUS.LOADING;
}

/** One holder's own inbox as the host holds it, by its kind and then its id, told to its readers only as that holder's read moves. */
const holderInboxAtom = Atom.family((kind: InboxHolderKey["kind"]) =>
  Atom.family((id: string) =>
    Atom.map(APP_SLICE.HOLDER_INBOX, (held): AppHolderInbox | undefined => held?.[kind][id]),
  ),
);

/** No holder read, for a surface holding none. */
const NO_HOLDER: Atom.Atom<AppHolderInbox | undefined> = Atom.make(undefined);

/** The feed of every item the account reaches, held for the session. */
function useAccountItems(): HostRead<AppInboxItems> {
  const held = useAppSlice(APP_SLICE.INBOX_ITEMS);
  const retry = useCallback(() => tellAct(ACT_KIND.AGENTS_INBOX_ITEMS_RETRY), []);
  return { rows: held?.rows, status: statusOf(held), retry };
}

/**
 * One holder's own inbox, held by this surface while `key` names one: the
 * hold is a stream on the act port, which carries nothing and which the
 * host keeps the holder followed for; the rows arrive on app state.
 */
function useHolderInbox(key: InboxHolderKey | undefined): HostRead<readonly InboxItem[]> {
  const kind = key?.kind;
  const id = key?.id;
  const held = useAppSlice(
    kind === undefined || id === undefined ? NO_HOLDER : holderInboxAtom(kind)(id),
  );
  useEffect(() => {
    if (kind === undefined || id === undefined) return;
    return streamFrom(
      () => askAct(ACT_KIND.AGENTS_INBOX_FOLLOW, { kind, id }),
      () => undefined,
    );
  }, [kind, id]);
  const retry = useCallback(() => {
    if (kind !== undefined && id !== undefined) tellAct(ACT_KIND.AGENTS_INBOX_RETRY, { kind, id });
  }, [kind, id]);
  return { rows: held?.rows, status: statusOf(held), retry };
}

export function useHostRead(read: typeof LIVE_READ.INBOX_ITEMS): HostRead<AppInboxItems>;
export function useHostRead(
  read: typeof LIVE_READ.HOLDER_INBOX,
  key: InboxHolderKey | undefined,
): HostRead<readonly InboxItem[]>;
export function useHostRead(
  read: typeof LIVE_READ.INBOX_ITEMS | typeof LIVE_READ.HOLDER_INBOX,
  key?: InboxHolderKey,
): HostRead<AppInboxItems> | HostRead<readonly InboxItem[]> {
  // Note that each read is one hook, called in the same order on every render, since the read a surface asks for never changes.
  const items = useAccountItems();
  const holder = useHolderInbox(read === LIVE_READ.HOLDER_INBOX ? key : undefined);
  return read === LIVE_READ.INBOX_ITEMS ? items : holder;
}
