import { LIVE_READ } from "@repo/features/live-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { SlackListedChannel } from "@repo/features/slack-bot-wire";
import { noMatchWords, readFailedWords, readingWords, TERM } from "@repo/features/words";
import type { WorkspaceSlack } from "@repo/features/workspace-integrations-live";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  CONFIRM_LOSS,
  ConfirmDialog,
  type MenuRow as MenuRowChoice,
  RepositoryPicture,
  repositoryMenuRow,
  SETTINGS_ROW_INDENT,
  SettingsRow,
  SettingsRowMark,
  useConfirmDialog,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMemo, useState } from "react";
import { useAct } from "../act.js";
import { confirmFailure, refusedShown } from "../failure-report.js";
import { useRepositoryPictures } from "../repository-pictures.js";
import { HOST_READ_STATUS, useHostRead } from "../use-host-read.js";
import { AddMenuButton } from "./add-menu-button.js";
import { MenuRow } from "./menu-row.js";
import { Picker, PickerRow } from "./picker-row.js";

/**
 * slack-bot-channels.tsx -- where an owner or admin sends the workspace's Slack starts: the channels the bot is in, each with its repository, and the repository every other start works in.
 *
 * Drawn as GitHub's rows are on the same card: the bot's row holds Add
 * channel (`AddSlackChannel`) beside its ⋯, as GitHub's holds Add
 * repository, and under it, each a row of the card inset under the bot's
 * words, the Default repository picker, then one row per channel the bot is
 * in. A channel is named as Slack's sidebar names it, its mark (a hash, or a
 * lock for a private channel) saying its kind; its row holds its repository
 * picker, the default until one is chosen, and a ⋯ whose Remove from channel
 * asks first, since the bot leaves the channel for everyone in it. Where the
 * bot is in no channel, one row says so and how to add one, a private one by
 * `/invite`. A Slack start works in the repository its message names, else
 * its channel's, else the default. The repositories are the workspace's
 * held integrations' and the channels Slack's own list the host holds, so a
 * repository chosen draws at once, and a channel joined or left draws as
 * its answer lands; a refusal is said under the row that asked.
 */

/** The menu row that picks no repository: the default in a channel's menu, none in the default's. */
const NONE_ROW = "none";

/** What the rows say. */
const WORDS = {
  DEFAULT_LABEL: "Default repository",
  NONE: "None",
  DEFAULT: "Default",
  REPOSITORY_SEARCH: "Search repositories",
  ADD: "Add channel",
  CHANNEL_SEARCH: "Search channels",
  INVITE: `For a private channel, run /invite @${PRODUCT_NAME} in it.`,
  ALL_PUBLIC: "The bot is in every public channel.",
  NO_CHANNELS: "Not in any channels yet",
  NO_CHANNELS_DETAIL: `Add a public channel here, or run /invite @${PRODUCT_NAME} in any channel.`,
  REMOVE: "Remove from channel",
} as const;

/** The repositories the workspace reaches, as the menu reads them: still reading, not read, or their rows. */
const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

/** A channel as a sentence names it, as Slack writes one. */
function channelName(channel: SlackListedChannel): string {
  return `#${channel.name}`;
}

/** A channel's mark, which says its kind so its name need not: Slack's hash for a public one, a lock for a private one. */
function ChannelMark({ channel }: { channel: SlackListedChannel }): React.JSX.Element {
  return channel.private ? <GLYPH.PRIVATE_CHANNEL /> : <GLYPH.CHANNEL />;
}

/**
 * The repositories the workspace reaches, held by the host while the row
 * stands (`LIVE_READ.REPOSITORY_LISTS`); a picker opened over a read that
 * never answered asks for it again.
 */
function useRepositoryRows(workspaceId: string) {
  const pictures = useRepositoryPictures();
  const { rows: listed, status, retry } = useHostRead(LIVE_READ.REPOSITORY_LISTS, workspaceId);
  const rows: readonly MenuRowChoice[] = useMemo(
    () => listed?.repositories.map((one) => repositoryMenuRow(one.fullName, pictures)) ?? [],
    [listed, pictures],
  );
  const failed = status === HOST_READ_STATUS.FAILED;
  const note = failed
    ? readFailedWords(TERM.REPOSITORY.many)
    : listed === undefined
      ? readingWords(TERM.REPOSITORY.many)
      : undefined;
  return { read: failed ? retry : () => undefined, note, pictures, rows };
}

/**
 * Add channel and its menu, on the bot's row: the public channels the bot
 * is not in, one picked putting the bot in it, and where none is left, how
 * a private one is joined. A refusal is handed to the row to say.
 */
export function AddSlackChannel({
  workspaceId,
  channels,
  onRefused,
}: {
  workspaceId: string;
  channels: readonly SlackListedChannel[];
  onRefused: (refusal: string | undefined) => void;
}): React.JSX.Element {
  const { act } = useAct();
  const addable = channels.filter((channel) => !channel.private && !channel.member);
  const pick = (channelId: string) => {
    onRefused(undefined);
    act(ACT_KIND.WORKSPACE_SLACK_BOT_CHANNEL, { workspaceId, channelId, member: true }).catch(
      (refused: Error) => onRefused(refused.message),
    );
  };
  return (
    <AddMenuButton
      label={WORDS.ADD}
      placeholder={WORDS.CHANNEL_SEARCH}
      noMatch={noMatchWords(TERM.CHANNEL)}
      rows={addable.map((channel) => ({
        id: channel.id,
        label: channel.name,
        icon: <ChannelMark channel={channel} />,
      }))}
      note={addable.length === 0 ? `${WORDS.ALL_PUBLIC} ${WORDS.INVITE}` : undefined}
      onPick={pick}
    />
  );
}

/** The workspace's default repository for Slack starts, inset under the bot's row, named or cleared from its picker. */
function DefaultRepositoryRow({
  workspaceId,
  chosen,
}: {
  workspaceId: string;
  chosen: string | undefined;
}): React.JSX.Element {
  const { act } = useAct();
  const repositories = useRepositoryRows(workspaceId);
  const [refusal, setRefusal] = useState<string>();
  const [saves, setSaves] = useState(0);
  const pick = (id: string) => {
    setRefusal(undefined);
    const repository = id === NONE_ROW ? null : id;
    act(ACT_KIND.WORKSPACE_SLACK_BOT_REPOSITORY, { workspaceId, repository }).then(
      () => setSaves((count) => count + 1),
      (refused: Error) => setRefusal(refused.message),
    );
  };
  return (
    <PickerRow
      indent={SETTINGS_ROW_INDENT.MARK}
      label={WORDS.DEFAULT_LABEL}
      labelReplayUnmasked
      value={chosen ?? NONE_ROW}
      valueLabel={chosen ?? WORDS.NONE}
      valueReplayMasked={chosen !== undefined}
      valueIcon={
        chosen === undefined ? undefined : (
          <ReplayMask>
            <RepositoryPicture repository={chosen} pictures={repositories.pictures} />
          </ReplayMask>
        )
      }
      rows={[{ id: NONE_ROW, label: WORDS.NONE }, ...repositories.rows]}
      placeholder={WORDS.REPOSITORY_SEARCH}
      noMatch={noMatchWords(TERM.REPOSITORY)}
      note={repositories.note}
      onOpen={repositories.read}
      onPick={pick}
      saves={saves}
      error={refusedShown(refusal, FAILURE_SURFACE.WORKSPACE_SLACK_BOT_REPOSITORY)}
    />
  );
}

/**
 * One channel the bot is in, inset under the bot's row: its mark and name,
 * its repository picker, the default until one is named (`repository`),
 * and a ⋯ whose Remove from channel asks first.
 */
function ChannelRow({
  workspace,
  channel,
  repository: named,
  defaultRepository,
}: {
  workspace: Workspace;
  channel: SlackListedChannel;
  repository: string | undefined;
  defaultRepository: string | undefined;
}): React.JSX.Element {
  const { act } = useAct();
  const workspaceId = workspace.id;
  const channelId = channel.id;
  const repositories = useRepositoryRows(workspaceId);
  const [refusal, setRefusal] = useState<string>();
  const name = channelName(channel);
  const remove = useConfirmDialog(
    { subject: channel.member, surfaceOpen: true },
    () =>
      act(ACT_KIND.WORKSPACE_SLACK_BOT_CHANNEL, { workspaceId, channelId, member: false }).then(
        () => ACCEPTED,
        (refused: Error) => ({ status: ACTION_RESULT_STATUS.REJECTED, reason: refused.message }),
      ),
    confirmFailure(FAILURE_SURFACE.WORKSPACE_SLACK_BOT_CHANNEL),
  );
  const pick = (id: string) => {
    setRefusal(undefined);
    const repository = id === NONE_ROW ? null : id;
    act(ACT_KIND.WORKSPACE_SLACK_BOT_CHANNEL, { workspaceId, channelId, repository }).catch(
      (refused: Error) => setRefusal(refused.message),
    );
  };
  return (
    <>
      <MenuRow
        thing={name}
        actions={[
          [
            {
              label: WORDS.REMOVE,
              icon: <GLYPH.DISCONNECT />,
              danger: true,
              onSelect: () => remove.ask(),
            },
          ],
        ]}
        row={{
          indent: SETTINGS_ROW_INDENT.MARK,
          leading: (
            <SettingsRowMark>
              <ChannelMark channel={channel} />
            </SettingsRowMark>
          ),
          label: <ReplayMask>{channel.name}</ReplayMask>,
          error: refusedShown(refusal, FAILURE_SURFACE.WORKSPACE_SLACK_BOT_CHANNEL),
          describedControl: (control) => (
            <Picker
              label={`${name} repository`}
              describedBy={control["aria-describedby"]}
              invalid={control["aria-invalid"]}
              value={named ?? NONE_ROW}
              valueLabel={named ?? WORDS.DEFAULT}
              valueReplayMasked={named !== undefined}
              valueIcon={
                named === undefined ? undefined : (
                  <ReplayMask>
                    <RepositoryPicture repository={named} pictures={repositories.pictures} />
                  </ReplayMask>
                )
              }
              rows={[
                {
                  id: NONE_ROW,
                  label: WORDS.DEFAULT,
                  detail: defaultRepository ?? WORDS.NONE,
                },
                ...repositories.rows,
              ]}
              placeholder={WORDS.REPOSITORY_SEARCH}
              noMatch={noMatchWords(TERM.REPOSITORY)}
              note={repositories.note}
              onOpen={repositories.read}
              onPick={pick}
            />
          ),
        }}
      />
      <ConfirmDialog
        open
        confirm={remove}
        question={{
          title: `Remove the Slack bot from ${name}?`,
          body: `Members of ${name} can no longer start ${PRODUCT_NAME} agents there, and its repository is forgotten. Anyone in the channel can add the bot back with /invite.`,
          verb: "Remove Slack bot",
          running: "Removing",
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
          replayUnmasked: true,
          titleReplayMasked: true,
          bodyReplayMasked: true,
        }}
      />
    </>
  );
}

/**
 * The rows under a connected bot's row, to an owner or admin, each a row of
 * the card: the default repository, then each channel the bot is in, or
 * one row saying it is in none; where Slack's channels have not been
 * listed, the default alone.
 */
export function SlackBotChannelRows({
  workspace,
  slack,
  channels,
}: {
  workspace: Workspace;
  slack: WorkspaceSlack;
  channels: readonly SlackListedChannel[] | undefined;
}): React.JSX.Element {
  const joined = channels?.filter((channel) => channel.member);
  return (
    <>
      <DefaultRepositoryRow workspaceId={workspace.id} chosen={slack.defaultRepository} />
      {joined?.map((channel) => (
        <ChannelRow
          key={channel.id}
          workspace={workspace}
          channel={channel}
          repository={slack.channelRepositories[channel.id]}
          defaultRepository={slack.defaultRepository}
        />
      ))}
      {joined?.length === 0 ? (
        <SettingsRow
          indent={SETTINGS_ROW_INDENT.MARK}
          leading={
            <SettingsRowMark>
              <GLYPH.CHANNEL />
            </SettingsRowMark>
          }
          label={WORDS.NO_CHANNELS}
          description={WORDS.NO_CHANNELS_DETAIL}
        >
          {() => null}
        </SettingsRow>
      ) : null}
    </>
  );
}
