import { PRODUCT_NAME } from "@repo/features/product-name";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { SlackBotChannel, WorkspaceSlackBot } from "@repo/features/slack-bot-wire";
import { noMatchWords, readFailedWords, readingWords, TERM } from "@repo/features/words";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  CONFIRM_LOSS,
  ConfirmDialog,
  GAP,
  IconButton,
  Inline,
  type MenuRow,
  SETTINGS_ROW_INDENT,
  SettingsRow,
  SettingsRowMark,
  Stack,
  Tooltip,
  useConfirmDialog,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useState } from "react";
import { useAct } from "../act.js";
import { confirmFailure, refusedShown } from "../failure-report.js";
import { repositoryMenuRow } from "../repository-row.js";
import { Picker, PickerRow } from "./picker-row.js";

/**
 * slack-bot-channels.tsx -- where an owner or admin sends the workspace's Slack starts: its default repository, the channels the bot is in, each with a repository of its own, and a public channel to add the bot to.
 *
 * Under the Slack bot's row once it is connected, and to an owner or admin
 * alone, since the channel list is theirs: a Default repository picker,
 * then one row per channel the bot is in, inset under the bot's words as
 * GitHub's accounts are under GitHub's, each with its own repository picker
 * (the workspace's default where it names none) and a Remove that asks
 * first, since the bot leaves the channel for everyone in it; and last, an
 * Add to a channel picker over the public channels the bot is not in, its
 * why saying a private one is joined by `/invite`. A Slack start works in
 * the repository its message names, else its channel's, else this default.
 * Every write answers the bot as it then stands, which the rows redraw
 * from; a refusal is said under the row that asked.
 */

/** The menu row that picks no repository: the workspace's default in a channel's menu, none in the default's. */
const NONE_ROW = "none";

/** What the rows say. */
const WORDS = {
  DEFAULT_LABEL: "Default repository",
  DEFAULT_DETAIL:
    "Agents started from Slack work here unless the message or its channel names one.",
  NONE: "None",
  WORKSPACE_DEFAULT: "Workspace default",
  REPOSITORY_SEARCH: "Search repositories",
  CHANNEL_DETAIL_PRIVATE: "Private channel",
  ADD_LABEL: "Add to a channel",
  ADD_DETAIL: `Public channels. For a private channel, run /invite @${PRODUCT_NAME} in it.`,
  ADD_VALUE: "Choose a channel",
  CHANNEL_SEARCH: "Search channels",
  NO_CHANNELS: "The bot is in every public channel.",
  REMOVE: "Remove from channel",
} as const;

/** The repositories the workspace reaches, as the menu reads them: still reading, not read, or their rows. */
type RepositoryRows =
  | { readonly kind: "reading" }
  | { readonly kind: "failed" }
  | { readonly kind: "read"; readonly rows: readonly MenuRow[] };

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

/** A channel as its row names it. */
function channelName(channel: SlackBotChannel): string {
  return `#${channel.name}`;
}

/** The repositories the workspace reaches, read as a picker opens, so one that failed is asked for again. */
function useRepositoryRows(workspaceId: string) {
  const { act } = useAct();
  const [rows, setRows] = useState<RepositoryRows>({ kind: "reading" });
  const read = () => {
    setRows({ kind: "reading" });
    act(ACT_KIND.TASKS_REPOSITORIES, { workspaceId }).then(
      (answer) =>
        setRows(
          "failure" in answer
            ? { kind: "failed" }
            : {
                kind: "read",
                rows: answer.repositories.repositories.map((one) =>
                  repositoryMenuRow(one.fullName, true),
                ),
              },
        ),
      () => setRows({ kind: "failed" }),
    );
  };
  const note =
    rows.kind === "reading"
      ? readingWords(TERM.REPOSITORY.many)
      : rows.kind === "failed"
        ? readFailedWords(TERM.REPOSITORY.many)
        : undefined;
  return { read, note, rows: rows.kind === "read" ? rows.rows : [] };
}

/** The workspace's default repository for Slack starts, named or cleared from its picker. */
function DefaultRepositoryRow({
  workspaceId,
  slackBot,
  onChanged,
}: {
  workspaceId: string;
  slackBot: WorkspaceSlackBot;
  onChanged: (slackBot: WorkspaceSlackBot) => void;
}): React.JSX.Element {
  const { act } = useAct();
  const repositories = useRepositoryRows(workspaceId);
  const [refusal, setRefusal] = useState<string>();
  const [saves, setSaves] = useState(0);
  const chosen = slackBot.defaultRepository;
  const pick = (id: string) => {
    setRefusal(undefined);
    const repository = id === NONE_ROW ? null : id;
    act(ACT_KIND.WORKSPACE_SLACK_BOT_REPOSITORY, { workspaceId, repository }).then(
      (now) => {
        onChanged(now);
        setSaves((count) => count + 1);
      },
      (refused: Error) => setRefusal(refused.message),
    );
  };
  return (
    <PickerRow
      label={WORDS.DEFAULT_LABEL}
      detail={WORDS.DEFAULT_DETAIL}
      value={chosen ?? NONE_ROW}
      valueLabel={chosen ?? WORDS.NONE}
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
 * One channel the bot is in, inset under the bot's row: its name, whether
 * it is private, its repository picker, and Remove, which asks first.
 */
function ChannelRow({
  workspace,
  channel,
  slackBot,
  onChanged,
}: {
  workspace: Workspace;
  channel: SlackBotChannel;
  slackBot: WorkspaceSlackBot;
  onChanged: (slackBot: WorkspaceSlackBot) => void;
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
        (now) => {
          onChanged(now);
          return ACCEPTED;
        },
        (refused: Error) => ({ status: ACTION_RESULT_STATUS.REJECTED, reason: refused.message }),
      ),
    confirmFailure(FAILURE_SURFACE.WORKSPACE_SLACK_BOT_CHANNEL),
  );
  const pick = (id: string) => {
    setRefusal(undefined);
    const repository = id === NONE_ROW ? null : id;
    act(ACT_KIND.WORKSPACE_SLACK_BOT_CHANNEL, { workspaceId, channelId, repository }).then(
      onChanged,
      (refused: Error) => setRefusal(refused.message),
    );
  };
  return (
    <>
      <SettingsRow
        indent={SETTINGS_ROW_INDENT.MARK}
        leading={
          <SettingsRowMark>
            <GLYPH.CHANNEL />
          </SettingsRowMark>
        }
        label={name}
        description={channel.private ? WORDS.CHANNEL_DETAIL_PRIVATE : undefined}
        error={refusedShown(refusal, FAILURE_SURFACE.WORKSPACE_SLACK_BOT_CHANNEL)}
      >
        {(control) => (
          <Inline gap={GAP.CONTROL}>
            <Picker
              label={`${name} repository`}
              describedBy={control["aria-describedby"]}
              invalid={control["aria-invalid"]}
              value={channel.repository ?? NONE_ROW}
              valueLabel={channel.repository ?? WORDS.WORKSPACE_DEFAULT}
              rows={[
                {
                  id: NONE_ROW,
                  label: WORDS.WORKSPACE_DEFAULT,
                  detail: slackBot.defaultRepository ?? WORDS.NONE,
                },
                ...repositories.rows,
              ]}
              placeholder={WORDS.REPOSITORY_SEARCH}
              noMatch={noMatchWords(TERM.REPOSITORY)}
              note={repositories.note}
              onOpen={repositories.read}
              onPick={pick}
            />
            <Tooltip label={WORDS.REMOVE}>
              <IconButton
                icon={<GLYPH.DISCONNECT />}
                label={`${WORDS.REMOVE} ${name}`}
                onClick={() => remove.ask()}
              />
            </Tooltip>
          </Inline>
        )}
      </SettingsRow>
      <ConfirmDialog
        open
        confirm={remove}
        question={{
          title: `Remove the Slack bot from ${name}?`,
          body: `Members of ${name} can no longer start ${PRODUCT_NAME} agents there, and its repository is forgotten. Anyone in the channel can add the bot back with /invite.`,
          verb: "Remove",
          running: "Removing",
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
        }}
      />
    </>
  );
}

/** The public channels the bot is not in, one picked putting the bot in it. */
function AddChannelRow({
  workspaceId,
  channels,
  onChanged,
}: {
  workspaceId: string;
  channels: readonly SlackBotChannel[];
  onChanged: (slackBot: WorkspaceSlackBot) => void;
}): React.JSX.Element {
  const { act } = useAct();
  const [refusal, setRefusal] = useState<string>();
  const [saves, setSaves] = useState(0);
  const addable = channels.filter((channel) => !channel.private && !channel.member);
  const pick = (channelId: string) => {
    setRefusal(undefined);
    act(ACT_KIND.WORKSPACE_SLACK_BOT_CHANNEL, { workspaceId, channelId, member: true }).then(
      (now) => {
        onChanged(now);
        setSaves((count) => count + 1);
      },
      (refused: Error) => setRefusal(refused.message),
    );
  };
  return (
    <PickerRow
      label={WORDS.ADD_LABEL}
      detail={WORDS.ADD_DETAIL}
      value={undefined}
      valueLabel={WORDS.ADD_VALUE}
      rows={addable.map((channel) => ({
        id: channel.id,
        label: channelName(channel),
        icon: <GLYPH.CHANNEL />,
      }))}
      placeholder={WORDS.CHANNEL_SEARCH}
      noMatch={noMatchWords(TERM.CHANNEL)}
      note={addable.length === 0 ? WORDS.NO_CHANNELS : undefined}
      onPick={pick}
      saves={saves}
      error={refusedShown(refusal, FAILURE_SURFACE.WORKSPACE_SLACK_BOT_CHANNEL)}
    />
  );
}

/** The rows above, under a connected bot's row, to an owner or admin; none where Slack's channels could not be read but the default. */
export function SlackBotChannelRows({
  workspace,
  slackBot,
  onChanged,
}: {
  workspace: Workspace;
  slackBot: WorkspaceSlackBot;
  onChanged: (slackBot: WorkspaceSlackBot) => void;
}): React.JSX.Element {
  const channels = slackBot.channels;
  return (
    <Stack gap={GAP.NONE}>
      <DefaultRepositoryRow workspaceId={workspace.id} slackBot={slackBot} onChanged={onChanged} />
      {channels
        ?.filter((channel) => channel.member)
        .map((channel) => (
          <ChannelRow
            key={channel.id}
            workspace={workspace}
            channel={channel}
            slackBot={slackBot}
            onChanged={onChanged}
          />
        ))}
      {channels === undefined ? null : (
        <AddChannelRow workspaceId={workspace.id} channels={channels} onChanged={onChanged} />
      )}
    </Stack>
  );
}
