import { HOST_LIVE } from "@repo/features/tasks-view";
import { ANNOUNCE, Tooltip, useAnnounce } from "@repo/ui";
import { RefreshCwIcon, WifiOffIcon } from "@repo/ui/icons";
import { useDisclosure } from "@repo/ui/use-disclosure";
import * as Atom from "effect/reactivity/Atom";
import { useRef } from "react";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";

/**
 * offline-mark.tsx -- the pill that says what the window shows may be behind: this Mac offline, the service not answering, or live updates catching up; in the sidebar's foot or, while the sidebar is folded or the sign-in stands, in the title bar.
 *
 * Every surface still fails on its own while the network is gone, each as
 * its read could not be done; the pill says once why, where the window keeps
 * its own state, beside a release on its way in (`sidebar-foot.tsx`). It
 * reads the document's `network` slice, which main keeps from the
 * platform's answer and from whether the service answered its last call,
 * and the host's live state beside the task list (`HOST_LIVE`), which its
 * follow keeps, and draws nothing while both are well, once the pill has
 * faded out. It is a status rather than a press, so
 * it is announced as one, and a sidebar too narrow for its word draws its
 * glyph alone and still names it.
 */

/** What the pill stands for, the Mac's own network first, since nothing else can be read without it. */
const LIVE_MARK = {
  MAC_OFFLINE: "mac-offline",
  SERVICE_OFFLINE: "service-offline",
  CATCHING_UP: "catching-up",
} as const;

type LiveMark = (typeof LIVE_MARK)[keyof typeof LIVE_MARK];

/** The pill's word, the hint that says why, and its glyph, for each thing it stands for. */
const LIVE_MARK_LOOK = {
  [LIVE_MARK.MAC_OFFLINE]: { word: "Offline", hint: "You're offline.", Icon: WifiOffIcon },
  [LIVE_MARK.SERVICE_OFFLINE]: {
    word: "Offline",
    hint: "The service isn't answering.",
    Icon: WifiOffIcon,
  },
  [LIVE_MARK.CATCHING_UP]: {
    word: "Catching up",
    hint: "Live updates fell behind. What you see may be out of date.",
    Icon: RefreshCwIcon,
  },
} as const satisfies Record<LiveMark, { word: string; hint: string; Icon: unknown }>;

/** What the pill stands for now, or none, which redraws its readers only as it turns. */
const liveMarkAtom: Atom.Atom<LiveMark | undefined> = Atom.make((get) => {
  const network = get(APP_SLICE.NETWORK);
  if (network?.online === false) return LIVE_MARK.MAC_OFFLINE;
  const live = get(APP_SLICE.TASKS)?.live;
  if (network?.reachable === false || live === HOST_LIVE.OFFLINE) return LIVE_MARK.SERVICE_OFFLINE;
  if (live === HOST_LIVE.CATCHING_UP) return LIVE_MARK.CATCHING_UP;
  return undefined;
});

/** The pill, or nothing while the Mac is online and live updates are current. */
export function OfflineMark(): React.JSX.Element | null {
  const mark = useAppSlice(liveMarkAtom);
  useAnnounce(ANNOUNCE.POLITE, mark === undefined ? "" : LIVE_MARK_LOOK[mark].word);
  // Note that the last mark is held drawn through its fade, as anything leaving is.
  const shown = useDisclosure(mark !== undefined);
  const last = useRef(mark);
  if (mark !== undefined) last.current = mark;
  const drawn = mark ?? last.current;
  if (!shown.mounted || drawn === undefined) return null;
  const { word, hint, Icon } = LIVE_MARK_LOOK[drawn];
  return (
    <Tooltip label={hint}>
      <span
        ref={shown.ref}
        data-leaving={shown.leaving ? "true" : undefined}
        inert={shown.leaving}
        className="offline-mark inline-flex h-offline-mark flex-none animate-offline-arrive data-[leaving=true]:animate-leave items-center gap-tight-gap self-center whitespace-nowrap rounded-ui-full bg-attention-tint px-row-inset text-caption-inline font-ui-semibold text-attention [&_svg]:size-offline-glyph"
        role="img"
        aria-label={word}
      >
        <Icon aria-hidden="true" />
        <span className="offline-mark-word">{word}</span>
      </span>
    </Tooltip>
  );
}
