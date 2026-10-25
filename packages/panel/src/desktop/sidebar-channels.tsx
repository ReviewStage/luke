import { CHANNEL_BOUNDS, type Channel } from "@luke/features/channel-wire";
import {
  CONFIRM_LOSS,
  ConfirmDialog,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  ErrorLine,
  FormField,
  GROUP_ACTIONS,
  GROUP_HEADING,
  GroupHeader,
  IconButton,
  NAV_CURRENT,
  NavItem,
  SidebarPlaces,
  STATUS_TONE,
  Stack,
  TEXT_TONE,
  Text,
  TextField,
  Tooltip,
  useConfirmDialog,
  useMenu,
} from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useId, useRef, useState } from "react";
import { channelEditable, channelSections, channelSlug } from "../tasks/channels-model.js";
import type { ChannelsControl } from "../tasks/use-channels.js";
import { ActionMenu } from "./action-menu.js";
import { needsYouNoun } from "./places-waiting.js";
import { useFormDialog } from "./use-form-dialog.js";

/**
 * sidebar-channels.tsx -- the sidebar's Channels and Projects sections while Channels is on: every open channel of the workspace, and the questions that make, rename, and archive one (STAG-547).
 *
 * Each section heads its rows with a "+" that makes a channel there, a
 * project's under Projects. A row is the channel's glyph and name, and at
 * its end how many open asks in it wait on the reader, in the attention's
 * tone; a press shows the channel in the Inbox's place, and its row is
 * marked while it stands there. A right-click offers Rename and Archive on
 * any channel but #general, which no member may rename or archive; any
 * member may do either to every other. Making one asks for a name, written
 * as a channel's is (`channelSlug`), and a purpose, the line an agent reads
 * to choose it; renaming asks for the name alone. Archiving asks first, in
 * the accent, since it can be undone but reaches everyone in the workspace
 * (`packages/panel/AGENTS.md`'s Confirms). Every answer waits on the
 * service, and a refusal stands in the card until what was asked changes.
 */

/** Which question is asked: a channel to make, standing or a project's, or one to rename. */
const CHANNEL_ASK = { NEW: "new", RENAME: "rename" } as const;

type ChannelAsk =
  | { readonly kind: typeof CHANNEL_ASK.NEW; readonly project: boolean }
  | { readonly kind: typeof CHANNEL_ASK.RENAME; readonly channel: Channel };

/** A refusal as the confirming card reads it. */
function answered(refused: string | undefined): ActionResult {
  return refused === undefined
    ? { status: ACTION_RESULT_STATUS.ACCEPTED }
    : { status: ACTION_RESULT_STATUS.REJECTED, reason: refused };
}

/** One channel's row: its glyph, its name, what waits on the reader in it, and its menu. */
function ChannelRow({
  channel,
  current,
  shown,
  onOpen,
  onRename,
  onArchive,
}: {
  channel: Channel;
  current: boolean;
  shown: boolean;
  onOpen: () => void;
  onRename: () => void;
  onArchive: () => void;
}): React.JSX.Element {
  const menu = useMenu(shown);
  const editable = channelEditable(channel);
  return (
    <>
      <NavItem
        icon={<GLYPH.CHANNEL />}
        current={current ? NAV_CURRENT.PAGE : undefined}
        count={{
          value: channel.waiting,
          noun: needsYouNoun(channel.waiting),
          tone: STATUS_TONE.ATTENTION,
        }}
        contextMenu={editable ? menu.contextMenu() : undefined}
        roving
        onClick={onOpen}
      >
        {channel.name}
      </NavItem>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={`#${channel.name} actions`}
          menu={menu.drawn}
          groups={[
            [
              { label: "Rename…", onSelect: onRename },
              { label: "Archive…", onSelect: onArchive },
            ],
          ]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The sidebar's Channels and Projects sections, the channel shown marked where the Inbox's place shows one. */
export function SidebarChannels({
  workspaceId,
  channels,
  currentId,
  shown,
  onOpen,
}: {
  workspaceId: string | undefined;
  channels: ChannelsControl;
  /** The channel the Inbox's place shows, none while it shows none. */
  currentId: string | undefined;
  /** Whether the sidebar is in sight, which its menus and questions close with. */
  shown: boolean;
  onOpen: (channelId: string) => void;
}): React.JSX.Element {
  const [ask, setAsk] = useState<ChannelAsk | undefined>(undefined);
  const [askedIn, setAskedIn] = useState<string | undefined>(undefined);
  const [doomed, setDoomed] = useState<Channel | undefined>(undefined);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const field = useRef<HTMLInputElement | null>(null);
  const bodyId = useId();
  const listed = channels.channels ?? [];
  /** Whether a question still stands: asked in the workspace listed, its channel still open there. */
  const standing = (channel: Channel | undefined) =>
    askedIn === workspaceId &&
    (channel === undefined || listed.some((each) => each.id === channel.id));
  const confirm = useConfirmDialog(
    {
      subject:
        ask !== undefined && standing(ask.kind === CHANNEL_ASK.RENAME ? ask.channel : undefined),
      surfaceOpen: shown,
    },
    () => {
      if (ask === undefined) return Promise.resolve(answered(undefined));
      const written = channelSlug(name);
      return (
        ask.kind === CHANNEL_ASK.NEW
          ? channels.onCreate(written, purpose.replace(/[\r\n]+/gu, " ").trim(), ask.project)
          : channels.onRename(ask.channel.id, written)
      ).then(answered);
    },
  );
  const archive = useConfirmDialog(
    { subject: doomed !== undefined && standing(doomed), surfaceOpen: shown },
    () =>
      doomed === undefined
        ? Promise.resolve(answered(undefined))
        : channels.onArchive(doomed.id).then(answered),
  );
  const renaming = ask?.kind === CHANNEL_ASK.RENAME;
  const valid = channelSlug(name) !== "" && (renaming || purpose.trim() !== "");
  const form = useFormDialog(confirm, valid);
  // Note that a refused answer stands in the card until what was asked changes, which asks again.
  const typed = (set: (words: string) => void) => (words: string) => {
    set(words);
    if (confirm.rejection !== undefined) confirm.ask();
  };
  const askNew = (project: boolean) => {
    setAskedIn(workspaceId);
    setAsk({ kind: CHANNEL_ASK.NEW, project });
    setName("");
    setPurpose("");
    confirm.ask();
  };
  const askRename = (channel: Channel) => {
    setAskedIn(workspaceId);
    setAsk({ kind: CHANNEL_ASK.RENAME, channel });
    setName(channel.name);
    confirm.ask();
  };
  const askArchive = (channel: Channel) => {
    setAskedIn(workspaceId);
    setDoomed(channel);
    archive.ask();
  };
  const { standing: standingChannels, projects } = channelSections(listed);
  const section = (label: string, rows: readonly Channel[], project: boolean, add: string) => (
    <nav className="sidebar-group" aria-label={label}>
      <GroupHeader
        heading={GROUP_HEADING.NONE}
        label={label}
        actionsShown={GROUP_ACTIONS.AT_REST}
        actions={
          <Tooltip label={add}>
            <IconButton
              icon={<GLYPH.ADD />}
              label={add}
              disabled={channels.channels === undefined}
              onClick={() => askNew(project)}
            />
          </Tooltip>
        }
      />
      <SidebarPlaces>
        {rows.map((channel) => (
          <ChannelRow
            key={channel.id}
            channel={channel}
            current={channel.id === currentId}
            shown={shown}
            onOpen={() => onOpen(channel.id)}
            onRename={() => askRename(channel)}
            onArchive={() => askArchive(channel)}
          />
        ))}
      </SidebarPlaces>
    </nav>
  );
  const making = ask?.kind === CHANNEL_ASK.NEW ? ask : undefined;
  return (
    <>
      {section("Channels", standingChannels, false, "New channel")}
      {section("Projects", projects, true, "New project channel")}
      <Dialog
        open={form.open}
        title={
          renaming
            ? "Rename channel"
            : making?.project === true
              ? "New project channel"
              : "New channel"
        }
        describedBy={bodyId}
        busy={form.settling}
        refused={form.refusal !== undefined}
        initialFocus={field}
        onDismiss={form.dismiss}
        actions={
          <DialogActions
            onCancel={form.dismiss}
            act={{
              verb: renaming ? "Rename" : "Create channel",
              tone: DIALOG_TONE.PRIMARY,
              running: renaming ? "Renaming" : "Creating channel",
              ...form.act,
            }}
          />
        }
      >
        <Text id={bodyId} tone={TEXT_TONE.MUTED}>
          {renaming
            ? "Agents post to it under its new name from now on."
            : "Everyone in the workspace sees it, and agents choose it by its purpose."}
        </Text>
        <Stack>
          <FormField
            label="Name"
            description="Lowercase, with dashes, as agents write it after #."
            count={{ length: name.length, limit: CHANNEL_BOUNDS.MAX_NAME_CHARS }}
          >
            {(control) => (
              <TextField
                ref={field}
                field={control}
                placeholder="release-train"
                spellCheck={false}
                maxLength={CHANNEL_BOUNDS.MAX_NAME_CHARS}
                value={name}
                disabled={form.settling}
                onEnter={form.submit}
                onChange={typed(setName)}
              />
            )}
          </FormField>
          {renaming ? null : (
            <FormField
              label="Purpose"
              description="Agents read it to choose where a thread goes."
              count={{ length: purpose.length, limit: CHANNEL_BOUNDS.MAX_PURPOSE_CHARS }}
            >
              {(control) => (
                <TextField
                  field={control}
                  placeholder="What belongs in the channel, in a line"
                  maxLength={CHANNEL_BOUNDS.MAX_PURPOSE_CHARS}
                  value={purpose}
                  disabled={form.settling}
                  onEnter={form.submit}
                  onChange={typed(setPurpose)}
                />
              )}
            </FormField>
          )}
        </Stack>
        <ErrorLine>{form.refusal}</ErrorLine>
      </Dialog>
      <ConfirmDialog
        open
        confirm={archive}
        question={{
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
          title: "Archive channel?",
          body: `#${doomed?.name ?? ""} leaves the sidebar for everyone, and agents can no longer post to it. Its threads stay where they are.`,
          verb: "Archive channel",
          running: "Archiving",
        }}
      />
    </>
  );
}
