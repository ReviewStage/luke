import { EVERY_WORKSPACE } from "@repo/host/app-state";
import { SETTINGS_SECTION, SETTINGS_VIEW } from "@repo/settings/settings-views";
import {
  BANNER_LOOK,
  Banner,
  BUTTON_VARIANT,
  Button,
  MARK_PROVIDER,
  ProviderMark,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useQuery } from "@tanstack/react-query";
import { repositoryListsQuery } from "../live-reads.js";
import { useOpenSettings } from "../open-settings.js";
import { type RepositoryChooser, useOwnersToAsk } from "./repository-chip.js";

/**
 * no-repositories-banner.tsx -- the card over Home's composer while the workspace reaches no repository: that it has none yet, and the press that adds one.
 *
 * A teammate who accepts an invitation before the workspace's GitHub is
 * connected lands in a workspace with nothing to pick, and the repository
 * chip alone says so only once its menu is opened. So while the listing the
 * chip holds (`LIVE_READ.REPOSITORY_LISTS`) answers with no repository, Home
 * says so on a card of its own, under the card that asks for an agent where
 * one stands, since an agent holds Start and a repository does not: a task
 * may start with none. An owner or an admin is offered the press that mends
 * it as the chip's menu offers it, Connect GitHub, Reconnect GitHub where
 * GitHub removed or suspended the App, or Choose repositories where the App
 * reaches none; a member is told whom to ask, by name, and offered adding
 * one with their own GitHub token. Every press opens Settings on the
 * workspace's GitHub repositories, where all of it is done. Nothing stands
 * while the listing is still read or could not be, which the chip says.
 */

/** What the card says, worded once. */
const NO_REPOSITORIES_COPY = {
  TITLE: "This workspace has no repositories yet",
  CONNECT: "Connect GitHub to choose which repositories its agents work in.",
  RECONNECT: "Its GitHub was removed or suspended. Reconnect it to choose repositories again.",
  CHOOSE: "GitHub is connected but reaches no repository. Choose which its agents work in.",
  ADD_WITH_TOKEN: "Add with your token",
} as const;

/** The press an owner or an admin mends the workspace's GitHub with, and what the card says beside it. */
function managerWay(installed: boolean, connected: boolean): { label: string; detail: string } {
  if (installed) return { label: "Choose repositories", detail: NO_REPOSITORIES_COPY.CHOOSE };
  return connected
    ? { label: "Reconnect GitHub", detail: NO_REPOSITORIES_COPY.RECONNECT }
    : { label: "Connect GitHub", detail: NO_REPOSITORIES_COPY.CONNECT };
}

/** A member's words: whom to ask, by name where the workspace's people are read, then the token. */
function MemberDetail({ workspaceId }: { workspaceId: string | undefined }): React.JSX.Element {
  const whom = useOwnersToAsk(workspaceId);
  // Note that a name is a person's, so it stays masked while the rest is the app's own.
  return (
    <>
      Ask <ReplayMask>{whom}</ReplayMask> to connect GitHub, or add one with your own GitHub token.
    </>
  );
}

/** The card while the workspace `chooser` lists reaches no repository; nothing otherwise. */
export function NoRepositoriesBanner({
  chooser,
}: {
  chooser: RepositoryChooser;
}): React.JSX.Element | null {
  const openSettings = useOpenSettings();
  const listed = useQuery(repositoryListsQuery(chooser.scope ?? EVERY_WORKSPACE)).data;
  if (listed === undefined || listed.repositories.length > 0) return null;
  const way = chooser.manages
    ? managerWay(listed.installed, chooser.connected === true)
    : { label: NO_REPOSITORIES_COPY.ADD_WITH_TOKEN, detail: undefined };
  const open = () =>
    openSettings({
      page: SETTINGS_VIEW.WORKSPACE,
      section: SETTINGS_SECTION.GITHUB_REPOSITORIES,
      ...(chooser.scope === undefined ? undefined : { workspaceId: chooser.scope }),
    });
  return (
    <Banner
      look={BANNER_LOOK.CARD}
      glyph={<ProviderMark provider={MARK_PROVIDER.GITHUB} />}
      actions={
        <Button
          variant={BUTTON_VARIANT.OUTLINE}
          icon={chooser.manages ? <ProviderMark provider={MARK_PROVIDER.GITHUB} /> : undefined}
          onClick={open}
        >
          {way.label}
        </Button>
      }
    >
      <Text variant={TEXT_VARIANT.SECTION}>{NO_REPOSITORIES_COPY.TITLE}</Text>
      <Text tone={TEXT_TONE.MUTED}>
        {way.detail ?? <MemberDetail workspaceId={chooser.scope} />}
      </Text>
    </Banner>
  );
}
