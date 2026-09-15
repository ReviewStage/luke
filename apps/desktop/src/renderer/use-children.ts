import type { ChildTranscriptSnapshot } from "@sidecar/session";
import { Option } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import type { ChildrenSnapshot } from "#shared/messages/children";
import { appStateAtom } from "./use-app-state";

/** The children before the document has arrived: nothing read yet, which an empty list under `settled: false` says. */
const UNREAD_CHILDREN: ChildrenSnapshot = { settled: false, children: [] };

/**
 * The two slices the Children view draws, each derived from the one document
 * this window holds rather than subscribed to on their own: the account's
 * children as the host's read lists them, and the one child's transcript the
 * host holds open for this Mac, absent while none is. Nothing draws them yet;
 * the view that will reads these and asks for a transcript through the two
 * `conversation.*ChildTranscript` acts.
 */
export const childrenAtom: Atom.Atom<ChildrenSnapshot> = Atom.map(
  appStateAtom,
  (result) => Option.getOrUndefined(AsyncResult.value(result))?.children ?? UNREAD_CHILDREN,
);

export const childTranscriptAtom: Atom.Atom<ChildTranscriptSnapshot | undefined> = Atom.map(
  appStateAtom,
  (result) => Option.getOrUndefined(AsyncResult.value(result))?.childTranscript,
);
