import { signedInAccountId } from "@repo/credentials/snapshot";
import { DEVICE_STANDING } from "@repo/features/agent-wire";
import { DEVICE_PLATFORM, HOST_UPDATE } from "@repo/features/device-agent-wire";
import type { HostLine } from "@repo/features/host-live";
import { HOST_UNINSTALL_COMMAND, hostInstallCommand } from "@repo/features/host-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readFailedWords, readingWords, SIGNED_OUT_WORDS } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { SETTINGS_SEARCH_ROW } from "@repo/settings/settings-anchors";
import {
  ANNOUNCE,
  Checkbox,
  CONFIRM_LOSS,
  COPY_FIELD_PROMPT,
  COPY_FIELD_WIDTH,
  ConfirmDialog,
  CopyField,
  type DialogConfirm,
  ErrorState,
  SETTINGS_ROW_STATE,
  SETTINGS_SKELETON_CONTROL,
  SettingsLine,
  SettingsRow,
  SettingsRowMark,
  type SettingsRowSkeletonShape,
  type SettingsRowState,
  SettingsRowStateLine,
  SettingsRowsSkeleton,
  SettingsSection,
  STATUS_TONE,
  Switch,
  TEXT_TONE,
  Text,
  useAnnounce,
  useConfirmDialog,
  useSecond,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { actMutation } from "../act-mutations.js";
import { copyThroughShell } from "../copy-feedback.js";
import { DEVICE_PLATFORM_NAME } from "../device-platform.js";
import { type PresenceBook, presenceStanding, useDevicePresence } from "../device-presence.js";
import { confirmFailure, unreadShown } from "../failure-report.js";
import { hostsQuery, hostsRetryMutation } from "../live-reads.js";
import {
  isThisMac,
  type ListedMachine,
  machineName,
  THIS_MAC,
  useThisMac,
} from "../machine-name.js";
import { DeviceGlyph } from "../tasks/runs-on.js";
import { showToast, TOAST_HOLD } from "../toast.js";
import { appStateQuery, selectAccount } from "../use-app-state.js";
import { HostConnectDialog, useHostConnect } from "./host-connect-dialog.js";
import { MenuRow } from "./menu-row.js";

/**
 * hosts-section.tsx -- Settings › Hosts: the member's own machines that run their local agents, Linux servers and Macs alike, and Add a host, which shows the install command and names each host it adds as it joins.
 *
 * The page is drawn as its siblings that connect something are, the MCP
 * page above all: a titled list of what is connected, and a titled step that
 * connects one more, its command in the copy field every command on these
 * pages stands in. An account with no host yet is led to add one, so the
 * step stands first until a host does.
 *
 * A machine is any device of the member's enrolled with a secret of its own
 * (`@repo/features/host-wire`): a Linux server or a Mac that ran the install
 * command, or a Mac its desktop enrolled. The list names each as every list
 * of machines does (`machine-name.ts`), This Mac among them, leads with its
 * platform's glyph as Runs on does (`DeviceGlyph`), and says what it is by
 * its platform (`DEVICE_PLATFORM_NAME`) after Online, Offline, or Updating…
 * while its update runs, held against the window's own clock as a Mac's
 * label is, and no standing while it cannot be told yet. A host that joined
 * while the page stands reads Setting up… rather than Offline until its
 * first beat, since it has not gone anywhere. Nothing else: a host restarts
 * and sets itself up again by itself, and one below the service's floor is
 * refused and reads offline. Remove, in the row's ⋯ as an integration's
 * Disconnect is, refuses that machine at once, after asking; the host
 * removes itself from the machine as it hears so, at once or, for one that
 * reads offline, once it is online again, and for that one the question
 * also shows the command that removes it by hand, in case it never is. A
 * host removed on its machine by `vespin-host uninstall` leaves the list by
 * itself. Adding takes a Linux server and a Mac alike, through one command.
 *
 * In the desktop app, This Mac always stands first, with Run agents on this
 * Mac in Remove's place: a switch that reads whether this Mac's host
 * stands (`AppThisMacHost.enrolled`), which turning on enrolls and turning
 * off removes, after asking, since that takes the host and its agents'
 * folders off this Mac. While on it says the host's standing, and offline
 * until the service lists it. A Mac removed from anywhere else reads off,
 * since nothing enrolls it again unasked. A browser tab has no This Mac, so
 * it draws none.
 *
 * The list is the host's (`LIVE_READ.HOSTS`): followed live while the page
 * stands and a while after, so a host joining, leaving, renamed, or moving
 * through an update draws as the service carries it, with no read of the
 * page's own, and a removal draws the host gone the moment it is asked.
 *
 * Add a host shows the install command, public and the same for every
 * member, which pairs a box with a code the member approves. A host the
 * list holds that its first read for the account did not is one that just
 * joined: its row lights once as it lands, and the step says it is
 * connected, as Connect an agent says of an agent. A host so named is
 * approved, since the service lists no box before its approve. A pairing's
 * link opened in this window stands its dialog over the page
 * (`host-connect-dialog.tsx`), and once Connect makes the host the list
 * carries it. The page stands only while the Bring your own host
 * experiment is on (`settings-rows.ts`'s `PAGE_EXPERIMENT`), so while it is
 * off nothing here is drawn, read, or turned on.
 */

const SECTION_TITLE = {
  HOSTS: "Your hosts",
  ADD: "Add a host",
} as const;

const WORDS = {
  NONE: "No hosts yet.",
  ONLINE: "Online",
  OFFLINE: "Offline",
  SETTING_UP: "Setting up…",
  UPDATING: "Updating…",
  INSTALL_LABEL: "Run this on a Mac or Linux server",
  INSTALL_NEXT:
    "Then open the link it prints, and approve its code. A Mac runs your agents only while its user is logged in.",
  INSTALL_FIELD: "Install command",
  CONNECTED: "is connected.",
} as const;

/** The row that stands while the machines are read: a machine with its ⋯. */
const HOSTS_SKELETON: readonly SettingsRowSkeletonShape[] = [
  { described: true, controls: [SETTINGS_SKELETON_CONTROL.MORE] },
];

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };
/** A remove the service did not take, said in the dialog that asked. */
const REFUSED: ActionResult = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: "Could not reach the service. Try again.",
};

/** A host as the list of machines names it (`machineName`). */
function machineOf(host: HostLine): ListedMachine {
  return { deviceId: host.id, name: host.name, machineId: host.machineId, model: host.model };
}

/**
 * What a host's line leads with, and its tint: updating plain while the host
 * says it is, whatever its beat, because it restarts on purpose to update and
 * is quiet meanwhile; online after the finished session's dot; setting up
 * plain for a host that just joined and has not beaten yet; offline tinted;
 * and none while its standing cannot be told.
 */
function standingOf(
  host: HostLine,
  book: PresenceBook,
  joined: boolean,
): { readonly words: string; readonly state: SettingsRowState } | undefined {
  if (host.update === HOST_UPDATE.UPDATING) {
    return { words: WORDS.UPDATING, state: SETTINGS_ROW_STATE.PLAIN };
  }
  const beat = presenceStanding(book, host.id);
  if (beat === undefined && joined)
    return { words: WORDS.SETTING_UP, state: SETTINGS_ROW_STATE.PLAIN };
  // Note that a host the read does not name, though it is the account's own, is gone.
  const standing = beat ?? DEVICE_STANDING.OFFLINE;
  if (standing === DEVICE_STANDING.OFFLINE) {
    return { words: WORDS.OFFLINE, state: SETTINGS_ROW_STATE.ATTENTION };
  }
  if (standing !== DEVICE_STANDING.ONLINE) return undefined;
  return { words: WORDS.ONLINE, state: SETTINGS_ROW_STATE.CONNECTED };
}

/**
 * A host's line under its name, its standing first, as Integrations leads with
 * Connected, and then what it is. Note that an online line draws its words
 * inside the dot's line, because words after it sit off the dot's baseline,
 * and a tinted one tints its standing alone.
 */
function StandingLine({
  host,
  book,
  joined,
}: {
  host: HostLine;
  book: PresenceBook;
  /** Whether the host joined while the page stands. */
  joined: boolean;
}): React.JSX.Element {
  // Note that a service older than platforms listed only Linux servers.
  const kind = DEVICE_PLATFORM_NAME[host.platform ?? DEVICE_PLATFORM.LINUX];
  const standing = standingOf(host, book, joined);
  if (standing === undefined) return <>{kind}</>;
  if (standing.state === SETTINGS_ROW_STATE.CONNECTED) {
    const line = `${standing.words} · ${kind}`;
    return <SettingsRowStateLine state={standing.state}>{line}</SettingsRowStateLine>;
  }
  return (
    <>
      <SettingsRowStateLine state={standing.state}>{standing.words}</SettingsRowStateLine>
      {` · ${kind}`}
    </>
  );
}

/** A machine's mark, by its platform, as Runs on draws it. */
function MachineMark({ platform }: { platform: HostLine["platform"] }): React.JSX.Element {
  return (
    <SettingsRowMark>
      <DeviceGlyph device={{ platform: platform ?? DEVICE_PLATFORM.LINUX }} />
    </SettingsRowMark>
  );
}

/** What This Mac's switch is called, and what it says while off. */
const THIS_MAC_WORDS = {
  SWITCH: "Run agents on this Mac",
  OFF: "Run your agents on this Mac instead of the cloud.",
  TURN_ON_FAILED: "Could not turn on this Mac. Try again.",
} as const;

/** What turning This Mac off asks first: it takes the host off this Mac, and its agents' folders where the member leaves that checked. */
const THIS_MAC_OFF = {
  title: "Turn off agents on this Mac?",
  body: `${PRODUCT_NAME} removes its host from this Mac, and any agent running here stops. Their tasks and transcripts stay in ${PRODUCT_NAME}.`,
  verb: "Turn off",
  running: "Turning off",
} as const;

/** The choice turning This Mac off offers where its host made agents' folders: delete them, or keep them in `~/.vespin/agents`. */
function deleteFoldersWords(count: number): { readonly label: string; readonly detail: string } {
  return {
    label: `Delete its agents' ${count === 1 ? "folder" : `${count} folders`} in ~/.vespin/agents`,
    detail: "Work in them that wasn't pushed goes with them.",
  };
}

/** What Remove says goes, whatever the machine: the host removes itself from the machine as it hears so (`apps/host`'s `removeItself`). */
const REMOVED = `It stops taking agents now, and ${PRODUCT_NAME} removes itself from the machine, its agents' folders included. Their tasks and transcripts stay in ${PRODUCT_NAME}.`;

/** What Remove adds for a host that reads offline, which hears it was removed only once it is online again, and the command for one that never is. */
const REMOVED_OFFLINE =
  "It's offline, so it does that the next time it's online. If it won't be, run this on it:";

/** One machine's row: its mark, what it is called, whether it is online and what it is, and its ⋯ holding Remove. */
function HostRow({
  host,
  label,
  book,
  joined,
  onRemove,
  locked,
}: {
  host: HostLine;
  /** What the list calls the machine (`machineName`). */
  label: string;
  book: PresenceBook;
  /** Whether the host joined while the page stands, which lights its row once. */
  joined: boolean;
  /** Asks the section's Remove question of this machine. */
  onRemove: () => void;
  /** Whether a removal is out, which every Remove waits out. */
  locked: boolean;
}): React.JSX.Element {
  return (
    <MenuRow
      thing={label}
      actions={[
        {
          label: "Remove",
          icon: <GLYPH.REMOVE />,
          danger: true,
          disabled: locked,
          onSelect: onRemove,
        },
      ]}
      row={{
        leading: <MachineMark platform={host.platform} />,
        label: <ReplayMask>{label}</ReplayMask>,
        description: <StandingLine host={host} book={book} joined={joined} />,
        landed: joined,
      }}
    />
  );
}

/**
 * This Mac's row in the desktop app: Run agents on this Mac, on while its
 * host stands, what its host says while on, offline until the service lists
 * it, and what it does while off. Note that the row's words are This Mac,
 * as every list of machines calls it, and the switch's own name says what
 * it sets.
 */
function ThisMacRow({
  host,
  book,
  on,
  onChange,
}: {
  /** This Mac as the service lists it; none before it does. */
  host: HostLine | undefined;
  book: PresenceBook;
  on: boolean;
  onChange: (next: boolean) => void;
}): React.JSX.Element {
  const description = !on ? (
    THIS_MAC_WORDS.OFF
  ) : host === undefined ? (
    <SettingsRowStateLine state={SETTINGS_ROW_STATE.ATTENTION}>
      {WORDS.OFFLINE}
    </SettingsRowStateLine>
  ) : (
    <StandingLine host={host} book={book} joined={false} />
  );
  return (
    <SettingsRow
      leading={<MachineMark platform={DEVICE_PLATFORM.DARWIN} />}
      label={THIS_MAC}
      description={description}
      labelsControl
    >
      {(control) => (
        <Switch
          id={control.controlId}
          checked={on}
          label={THIS_MAC_WORDS.SWITCH}
          describedBy={control["aria-describedby"]}
          onChange={(next) => onChange(next)}
        />
      )}
    </SettingsRow>
  );
}

/** The machine Remove was asked of, by the account it was asked under, what the list called it then, and whether it read offline. */
interface RemoveAsked {
  readonly accountId: string | undefined;
  readonly host: HostLine;
  readonly label: string;
  readonly offline: boolean;
}

/** Remove's question over the machine it was asked of, which removes itself from the machine once it hears so, and for one that reads offline the command that removes it by hand. */
function RemoveHostDialog({
  asked,
  confirm,
}: {
  asked: RemoveAsked | undefined;
  confirm: DialogConfirm;
}): React.JSX.Element {
  return (
    <ConfirmDialog
      open
      confirm={confirm}
      question={{
        title: `Remove ${asked?.label ?? ""}?`,
        body: REMOVED,
        verb: "Remove host",
        running: "Removing",
        loss: CONFIRM_LOSS.IRREVERSIBLE,
        replayUnmasked: true,
        titleReplayMasked: true,
      }}
    >
      {asked?.offline === true ? (
        <>
          <Text tone={TEXT_TONE.MUTED}>{REMOVED_OFFLINE}</Text>
          <CopyField
            label="Uninstall command"
            value={HOST_UNINSTALL_COMMAND}
            what="command"
            copy={copyThroughShell}
            width={COPY_FIELD_WIDTH.FULL}
            prompt={COPY_FIELD_PROMPT.SHELL}
          />
        </>
      ) : null}
    </ConfirmDialog>
  );
}

/**
 * Add a host: the install command and what comes after it, and the host
 * that just joined, once one has; a reader is told as it does.
 */
function AddHostSection({
  installScriptUrl,
  joined,
}: {
  installScriptUrl: string;
  /** What the list calls the host that joined last while the page stands; none before one has. */
  joined: string | undefined;
}): React.JSX.Element {
  useAnnounce(ANNOUNCE.POLITE, joined === undefined ? "" : `${joined} ${WORDS.CONNECTED}`);
  return (
    <SettingsSection title={SECTION_TITLE.ADD} anchor={SETTINGS_SEARCH_ROW.ADD_HOSTS}>
      <SettingsRow
        label={WORDS.INSTALL_LABEL}
        description={WORDS.INSTALL_NEXT}
        below={() => (
          <CopyField
            label={WORDS.INSTALL_FIELD}
            value={hostInstallCommand(installScriptUrl)}
            what="command"
            copy={copyThroughShell}
            width={COPY_FIELD_WIDTH.FULL}
            prompt={COPY_FIELD_PROMPT.SHELL}
          />
        )}
      />
      {joined === undefined ? null : (
        <SettingsLine>
          <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>
            <ReplayMask>{joined}</ReplayMask> {WORDS.CONNECTED}
          </SettingsRowStateLine>
        </SettingsLine>
      )}
    </SettingsSection>
  );
}

/** The Hosts page: the member's machines as the host holds them, or why they cannot be drawn, and Add a host, first while there is none. */
export function HostsSection({ signedIn }: { signedIn: boolean }): React.JSX.Element | null {
  const { mutateAsync: sendHostsRemove } = useMutation(actMutation(ACT_KIND.HOSTS_REMOVE));
  // Note that the clock only redraws the rows as a beat ages, since each standing is read off the book's own monotonic clock.
  useSecond();
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const read = useQuery(hostsQuery(signedIn ? accountId : undefined));
  const retry = useMutation(hostsRetryMutation());
  const hosts = read.data?.hosts;
  const installScriptUrl = read.data?.installScriptUrl;
  // Note that each host's beat is the window's shared presence, read often enough that a host that keeps beating never reads offline.
  const book = useDevicePresence(signedIn);
  // The ids of the hosts the first read for the account listed, so one that joins while the page stands is told apart as just connected.
  const [known, setKnown] = useState<
    { readonly accountId: string | undefined; readonly ids: ReadonlySet<string> } | undefined
  >(undefined);
  if (hosts !== undefined && (known === undefined || known.accountId !== accountId)) {
    setKnown({ accountId, ids: new Set(hosts.map((host) => host.id)) });
  }
  const joinedNow = (host: HostLine) =>
    known !== undefined && known.accountId === accountId && !known.ids.has(host.id);
  const thisMac = useThisMac();
  const [connecting, closeConnect] = useHostConnect();
  // A pairing's question does not outlive the page it was asked over.
  useEffect(() => closeConnect, [closeConnect]);

  // Note that Remove asks over the section rather than its row, because the host draws a removal gone on the list the moment it is asked, so the row is gone before a refusal comes back to be said.
  const [asked, setAsked] = useState<RemoveAsked | undefined>(undefined);
  const removing = useConfirmDialog(
    { subject: asked !== undefined && asked.accountId === accountId, surfaceOpen: true },
    () =>
      asked === undefined
        ? Promise.resolve(REFUSED)
        : sendHostsRemove({ id: asked.host.id })
            .catch(() => undefined)
            .then((answer) => (answer === undefined || "failure" in answer ? REFUSED : ACCEPTED)),
    confirmFailure(FAILURE_SURFACE.HOST_REMOVE),
  );
  const askRemove = (host: HostLine, label: string) => {
    const offline = standingOf(host, book, joinedNow(host))?.words === WORDS.OFFLINE;
    setAsked({ accountId, host, label, offline });
    removing.ask();
  };

  // Note that This Mac reads as turned on while its enroll is out, and as its host stands once it answers.
  const turningOn = useMutation(actMutation(ACT_KIND.HOSTS_THIS_MAC_SET));
  const { mutateAsync: turnThisMacOff } = useMutation(actMutation(ACT_KIND.HOSTS_THIS_MAC_SET));
  const thisMacOn = turningOn.isPending || thisMac?.enrolled === true;
  const turnThisMacOn = () => {
    turningOn
      .mutateAsync({ on: true })
      .catch(() => undefined)
      .then((answer) => {
        if (answer !== undefined && !("failure" in answer)) return;
        showToast({
          words: THIS_MAC_WORDS.TURN_ON_FAILED,
          replayUnmasked: true,
          tone: STATUS_TONE.DANGER,
          hold: TOAST_HOLD.FAILED,
          failure: { surface: FAILURE_SURFACE.THIS_MAC_SET, cause: answer },
        });
      });
  };
  // Note that turning This Mac off asks first, since it takes the host off this Mac, and its agents' folders unless the member keeps them.
  const [deleteFolders, setDeleteFolders] = useState(true);
  const agentFolders = thisMac?.agentFolders ?? 0;
  const turningOff = useConfirmDialog(
    { subject: thisMac?.enrolled === true, surfaceOpen: true },
    () =>
      turnThisMacOff({
        on: false,
        deleteFolders: deleteFolders || agentFolders === 0,
      })
        .catch(() => undefined)
        .then((answer) => (answer === undefined || "failure" in answer ? REFUSED : ACCEPTED)),
    confirmFailure(FAILURE_SURFACE.THIS_MAC_SET),
  );
  const switchThisMac = (next: boolean) => {
    if (next) return turnThisMacOn();
    setDeleteFolders(true);
    turningOff.ask();
  };

  const listed = hosts?.map(machineOf) ?? [];
  // Note that This Mac's host stands on its switch's row only while it is on; one the service still lists while it is off, as an uninstall that could not reach the service leaves it, stands as any host does, by its own name, with its Remove.
  const naming = thisMac?.enrolled === true ? thisMac : undefined;
  // Note that the record's device names This Mac's host where it has one, since an old host of the same machine may still be listed beside it.
  const listedMac =
    naming === undefined
      ? undefined
      : hosts?.find((host) =>
          naming.deviceId === undefined
            ? isThisMac(machineOf(host), naming)
            : host.id === naming.deviceId,
        );
  const loaded = signedIn && hosts !== undefined && installScriptUrl !== undefined;
  const others = hosts?.filter((host) => host !== listedMac) ?? [];
  const lastJoined = others.findLast(joinedNow);
  const empty = others.length === 0 && thisMac === undefined;
  const list = (
    <SettingsSection
      title={SECTION_TITLE.HOSTS}
      anchor={signedIn ? undefined : SETTINGS_SEARCH_ROW.ADD_HOSTS}
    >
      {!signedIn ? (
        <SettingsLine>{SIGNED_OUT_WORDS}</SettingsLine>
      ) : loaded && empty ? (
        <SettingsLine>{WORDS.NONE}</SettingsLine>
      ) : loaded ? (
        <>
          {thisMac === undefined ? null : (
            <ThisMacRow host={listedMac} book={book} on={thisMacOn} onChange={switchThisMac} />
          )}
          {others.map((host) => {
            const label = machineName(machineOf(host), listed, naming);
            return (
              <HostRow
                key={host.id}
                host={host}
                label={label}
                book={book}
                joined={joinedNow(host)}
                onRemove={() => askRemove(host, label)}
                locked={removing.busy}
              />
            );
          })}
        </>
      ) : read.isError ? (
        <SettingsLine>
          <ErrorState
            failure={unreadShown(FAILURE_SURFACE.HOSTS_READ)}
            onRetry={() => retry.mutate()}
          >
            {readFailedWords("your hosts")}
          </ErrorState>
        </SettingsLine>
      ) : (
        <SettingsRowsSkeleton label={readingWords("your hosts")} rows={HOSTS_SKELETON} />
      )}
    </SettingsSection>
  );
  // Note that signed out the add step is not drawn, so the list holds its search anchor instead.
  const add = loaded ? (
    <AddHostSection
      installScriptUrl={installScriptUrl}
      joined={
        lastJoined === undefined ? undefined : machineName(machineOf(lastJoined), listed, naming)
      }
    />
  ) : null;
  return (
    <>
      {/* Note that an account with no host yet is led to add one, rather than to an empty list. */}
      {loaded && empty ? (
        <>
          {add}
          {list}
        </>
      ) : (
        <>
          {list}
          {add}
        </>
      )}
      <RemoveHostDialog asked={asked} confirm={removing} />
      <ConfirmDialog
        open
        confirm={turningOff}
        question={{ ...THIS_MAC_OFF, loss: CONFIRM_LOSS.IRREVERSIBLE, replayUnmasked: true }}
      >
        {agentFolders === 0 ? null : (
          <Checkbox
            checked={deleteFolders}
            onChange={setDeleteFolders}
            label={deleteFoldersWords(agentFolders).label}
            detail={deleteFoldersWords(agentFolders).detail}
          />
        )}
      </ConfirmDialog>
      {connecting === undefined || !signedIn ? null : (
        <HostConnectDialog key={connecting} code={connecting} onClose={closeConnect} />
      )}
    </>
  );
}
