import { HOST_LIVE } from "@luke/features/tasks-view";
import { ANNOUNCE, Tooltip, useAnnounce } from "@luke/ui";
import { RefreshCwIcon, WifiOffIcon } from "@luke/ui/icons";
import * as Atom from "effect/reactivity/Atom";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";

/**
 * offline-mark.tsx -- the pill that says what the window shows may be behind: this Mac offline, the service not answering, or live updates catching up; in the sidebar's foot or, while the sidebar is folded or the sign-in stands, in the title bar.
 *
 * Every surface still fails on its own while the network is gone, each as
 * its read could not be done; the pill says once why, where the window keeps
 * its own state, beside a release on its way in (`sidebar-foot.tsx`). It
 * reads the document's `network` slice, which main keeps from the
 * platform's answer, and the host's live state beside the task list
 * (`HOST_LIVE`), which its follow keeps, and draws nothing while both are
 * well. It is a status rather than a press, so it is announced as one, and
 * a sidebar too narrow for its word draws its glyph alone and still names it.
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
    hint: "Luke's service isn't answering.",
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
  if (get(APP_SLICE.NETWORK)?.online === false) return LIVE_MARK.MAC_OFFLINE;
  const live = get(APP_SLICE.TASKS)?.live;
  if (live === HOST_LIVE.OFFLINE) return LIVE_MARK.SERVICE_OFFLINE;
  if (live === HOST_LIVE.CATCHING_UP) return LIVE_MARK.CATCHING_UP;
  return undefined;
});

/** Whether the pill stands, offline or catching up: what the room the title bar makes for it answers. */
export function useOffline(): boolean {
  return useAppSlice(liveMarkAtom) !== undefined;
}

/** The pill, or nothing while the Mac is online and live updates are current. */
export function OfflineMark(): React.JSX.Element | null {
  const mark = useAppSlice(liveMarkAtom);
  useAnnounce(ANNOUNCE.POLITE, mark === undefined ? "" : LIVE_MARK_LOOK[mark].word);
  if (mark === undefined) return null;
  const { word, hint, Icon } = LIVE_MARK_LOOK[mark];
  return (
    <Tooltip label={hint}>
      <span
        className="offline-mark inline-flex h-offline-mark flex-none animate-offline-arrive items-center gap-tight-gap self-center whitespace-nowrap rounded-luke-full bg-attention-tint px-row-inset text-caption-inline font-luke-semibold text-attention [&_svg]:size-offline-glyph"
        role="img"
        aria-label={word}
      >
        <Icon aria-hidden="true" />
        <span className="offline-mark-word">{word}</span>
      </span>
    </Tooltip>
  );
}
