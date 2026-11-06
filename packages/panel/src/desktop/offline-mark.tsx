import { HOST_LIVE } from "@repo/features/tasks-view";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { ANNOUNCE, BANNER_LOOK, Banner, STATUS_TONE, Tooltip, useAnnounce } from "@repo/ui";
import { RefreshCwIcon, WifiOffIcon } from "@repo/ui/icons";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { useDisclosure } from "@repo/ui/use-disclosure";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { appStateQuery } from "../use-app-state.js";

const LIVE_MARK = {
  MAC_OFFLINE: "mac-offline",
  SERVICE_OFFLINE: "service-offline",
  CATCHING_UP: "catching-up",
} as const;

type LiveMark = (typeof LIVE_MARK)[keyof typeof LIVE_MARK];

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

const selectLiveMark = (state: AppStateSnapshot): LiveMark | undefined => {
  const { network } = state;
  if (!network.online) return LIVE_MARK.MAC_OFFLINE;
  const live = state.tasks.live;
  if (!network.reachable || live === HOST_LIVE.OFFLINE) return LIVE_MARK.SERVICE_OFFLINE;
  if (live === HOST_LIVE.CATCHING_UP) return LIVE_MARK.CATCHING_UP;
  return undefined;
};

export function OfflineMark(): React.JSX.Element | null {
  const mark = useQuery({ ...appStateQuery, select: selectLiveMark }).data;
  useAnnounce(ANNOUNCE.POLITE, mark === undefined ? "" : LIVE_MARK_LOOK[mark].word);
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
        <span className="offline-mark-word">
          <ReplayUnmask>{word}</ReplayUnmask>
        </span>
      </span>
    </Tooltip>
  );
}

export function OfflineStrip(): React.JSX.Element | null {
  const mark = useQuery({ ...appStateQuery, select: selectLiveMark }).data;
  if (mark === undefined) return null;
  const { hint, Icon } = LIVE_MARK_LOOK[mark];
  return (
    <Banner
      look={BANNER_LOOK.STRIP}
      tone={STATUS_TONE.ATTENTION}
      glyph={<Icon aria-hidden="true" />}
    >
      {hint}
    </Banner>
  );
}
