import { signedInAccountId } from "@repo/credentials/snapshot";
import { DEVICE_STANDING } from "@repo/features/agent-wire";
import { DEVICE_PLATFORM, HOST_UPDATE } from "@repo/features/device-agent-wire";
import type { HostLine } from "@repo/features/host-live";
import { HOST_UNINSTALL_COMMAND, hostInstallCommand } from "@repo/features/host-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readFailedWords, readingWords, SIGNED_OUT_WORDS } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "@repo/settings/settings-anchors";
import {
  ANNOUNCE,
  BUTTON_VARIANT,
  Button,
  CODE_CARD_TITLE,
  CONFIRM_LOSS,
  CodeCard,
  ConfirmDialog,
  DIALOG_SIZE,
  Dialog,
  type DialogConfirm,
  ErrorState,
  GAP,
  PlusIcon,
  SETTINGS_ROW_STATE,
  SETTINGS_SKELETON_CONTROL,
  SettingsLine,
  SettingsRow,
  type SettingsRowSkeletonShape,
  type SettingsRowState,
  SettingsRowStateLine,
  SettingsRowsSkeleton,
  SettingsSection,
  SPINNER_SIZE,
  SpinnerRing,
  Stack,
  TEXT_TONE,
  Text,
  TrashIcon,
  useAnnounce,
  useConfirmDialog,
  useSecond,
} from "@repo/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useCallback, useEffect, useState } from "react";
import { useAct } from "../act.js";
import { copyThroughShell } from "../copy-feedback.js";
import { DEVICE_PLATFORM_NAME } from "../device-platform.js";
import { type PresenceBook, presenceStanding, useDevicePresence } from "../device-presence.js";
import { confirmFailure, unreadShown } from "../failure-report.js";
import {
  isThisMac,
  type ListedMachine,
  machineName,
  THIS_MAC,
  type ThisMac,
  useThisMac,
} from "../machine-name.js";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";
import { HOST_READ_STATUS, useHostRead } from "../use-host-read.js";
import { HostConnectDialog, useHostConnect } from "./host-connect-dialog.js";
import { MenuRow } from "./menu-row.js";

/**
 * hosts-section.tsx -- Settings › Hosts: the member's own machines that run their local agents, Linux servers and Macs alike, and Add hosts, which shows the install command and waits for the hosts it adds.
 *
 * A machine is any device of the member's enrolled with a secret of its own
 * (`@repo/features/host-wire`): a Linux server or a Mac that ran the install
 * command, or a Mac its desktop enrolled. The list names each as every list
 * of machines does (`machine-name.ts`), This Mac among them, and says what
 * it is by its platform (`DEVICE_PLATFORM_NAME`) after Online, Offline, or
 * Updating… while its update runs, held against the window's own clock as
 * a Mac's label is, and no standing while it cannot be told yet. Nothing
 * else: a host restarts and sets itself up again by itself, and one below
 * the service's floor is refused and reads offline. Remove, behind the
 * row's ⋯, refuses that machine at once, after asking with the command that
 * takes the host off the machine itself where the install command may have
 * set it up. Adding takes a Linux server and a Mac alike, through one
 * command.
 *
 * In the desktop app, This Mac always stands first, and offers no Remove,
 * since the app keeps that host as Bring your own host says; until the
 * service lists it, on a This Mac row of its own that reads offline. A
 * browser tab has no This Mac, so it draws neither, and with no host says
 * what one is above Add hosts.
 *
 * The list is the host's (`LIVE_READ.HOSTS`): followed live while the page
 * stands and a while after, so a host joining, leaving, renamed, or moving
 * through an update draws as the service carries it, with no read of the
 * page's own, and a removal draws the host gone the moment it is asked.
 *
 * Add hosts shows the install command, public and the same for every
 * member, which pairs a box with a code the member approves, and waits.
 * While it stands, the dialog names each host the list holds that it did
 * not hold as the dialog opened. A host so named is approved, since the
 * service lists no box before its approve, so the dialog never names one
 * that is not. A pairing's link opened in this window stands its dialog
 * over the page, Add hosts among it (`host-connect-dialog.tsx`), and once
 * Connect makes the host the list carries it, so an open Add hosts names it
 * and moves on by itself. The page
 * stands only while the Bring your own host
 * experiment is on (`settings-rows.ts`'s `PAGE_EXPERIMENT`), so while it is
 * off nothing here is drawn, read, or turned on.
 */

/**
 * A size containment: the command does not wrap, so without it its width
 * widens the dialog's grid track past a phone's and puts its card off the
 * screen. It scrolls inside its card instead.
 */
const COMMAND = "contain-inline-size";

const WORDS = {
  ADD: "Add hosts",
  NONE: "No hosts yet. A host is a Mac or Linux server of yours that runs your agents instead of the cloud.",
  ONLINE: "Online",
  OFFLINE: "Offline",
  UPDATING: "Updating…",
  INSTALL_TITLE: "Run this on each host",
  INSTALL_NEXT: "Then open the link it prints, and approve its code.",
  MAC_SESSION: "A Mac host runs your agents only while its user is logged in.",
  WAITING: "Waiting for approval",
  CLOSE: "Close",
} as const;

/** The row that stands while the machines are read: a machine with its ⋯. */
const HOSTS_SKELETON: readonly SettingsRowSkeletonShape[] = [
  { described: true, controls: [SETTINGS_SKELETON_CONTROL.MORE] },
];

/** Add hosts' own line under the list, the button stretched to the rows' width. */
const ADD_LINE = "grid";

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
 * is quiet meanwhile; online after the finished session's dot; offline
 * tinted; and none while its standing cannot be told.
 */
function standingOf(
  host: HostLine,
  book: PresenceBook,
): { readonly words: string; readonly state: SettingsRowState } | undefined {
  if (host.update === HOST_UPDATE.UPDATING) {
    return { words: WORDS.UPDATING, state: SETTINGS_ROW_STATE.PLAIN };
  }
  // Note that a host the read does not name, though it is the account's own, is gone.
  const standing = presenceStanding(book, host.id) ?? DEVICE_STANDING.OFFLINE;
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
function StandingLine({ host, book }: { host: HostLine; book: PresenceBook }): React.JSX.Element {
  // Note that a service older than platforms listed only Linux servers.
  const kind = DEVICE_PLATFORM_NAME[host.platform ?? DEVICE_PLATFORM.LINUX];
  const standing = standingOf(host, book);
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

/** What Remove says goes, whatever the machine. */
const REMOVED = `It stops taking agents now, and its agents stop. Their tasks and transcripts stay in ${PRODUCT_NAME}.`;

/** The title of the uninstall command Remove shows, a Mac's and a server's alike, since the install command set up each. */
const UNINSTALL_TITLE = `Run this on the host to remove ${PRODUCT_NAME} from it`;

/** One machine's row: what it is called, whether it is online and what it is, and Remove behind its ⋯, which the This Mac the app keeps offers none of. */
function HostRow({
  host,
  label,
  book,
  onRemove,
  locked,
  kept,
}: {
  host: HostLine;
  /** What the list calls the machine (`machineName`). */
  label: string;
  book: PresenceBook;
  /** Asks the section's Remove question of this machine. */
  onRemove: () => void;
  /** Whether a removal is out, which every Remove waits out. */
  locked: boolean;
  /** Whether the machine is This Mac as the app keeps its host. */
  kept: boolean;
}): React.JSX.Element {
  return (
    <MenuRow
      thing={label}
      actions={
        kept
          ? []
          : [
              {
                label: "Remove",
                icon: <TrashIcon />,
                danger: true,
                disabled: locked,
                onSelect: onRemove,
              },
            ]
      }
      row={{ label, description: <StandingLine host={host} book={book} /> }}
    />
  );
}

/** The machine Remove was asked of, by the account it was asked under, and what the list called it then. */
interface RemoveAsked {
  readonly accountId: string | undefined;
  readonly host: HostLine;
  readonly label: string;
}

/** Remove's question over the machine it was asked of, with the command that takes the host off the machine itself. */
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
      }}
    >
      <CodeCard
        title={UNINSTALL_TITLE}
        titleIs={CODE_CARD_TITLE.WORDS}
        code={HOST_UNINSTALL_COMMAND}
        copy={copyThroughShell}
      />
    </ConfirmDialog>
  );
}

/**
 * The dialog Add hosts opens: the install command, what comes after it, and
 * the hosts that joined since it opened, each by what the list calls it and
 * what it is, or a wait until one does; a reader is told as each joins. Its
 * one answer is a quiet Close, which only closes: nothing waits on it, since
 * the dialog moves on by itself whether or not it is pressed.
 */
function AddHostsDialog({
  known,
  hosts,
  thisMac,
  installScriptUrl,
  onClose,
}: {
  /** The ids of the account's hosts as the dialog opened, which it never names as joined. */
  known: ReadonlySet<string>;
  hosts: readonly HostLine[];
  thisMac: ThisMac;
  installScriptUrl: string;
  onClose: () => void;
}): React.JSX.Element {
  const listed = hosts.map(machineOf);
  const joined = hosts
    .filter((host) => !known.has(host.id))
    .map((host) => ({ host, label: machineName(machineOf(host), listed, thisMac) }));
  useAnnounce(ANNOUNCE.POLITE, joined.map(({ label }) => label).join(" "));
  return (
    <Dialog
      open
      title={WORDS.ADD}
      size={DIALOG_SIZE.WIDE}
      onDismiss={onClose}
      actions={
        <Button variant={BUTTON_VARIANT.QUIET} onClick={onClose}>
          {WORDS.CLOSE}
        </Button>
      }
    >
      <div className={COMMAND}>
        <CodeCard
          title={WORDS.INSTALL_TITLE}
          titleIs={CODE_CARD_TITLE.WORDS}
          code={hostInstallCommand(installScriptUrl)}
          copy={copyThroughShell}
        />
      </div>
      <Stack gap={GAP.TIGHT}>
        <Text>{WORDS.INSTALL_NEXT}</Text>
        <Text tone={TEXT_TONE.MUTED}>{WORDS.MAC_SESSION}</Text>
      </Stack>
      <SettingsSection>
        {joined.length === 0 ? (
          <SettingsRow leading={<SpinnerRing size={SPINNER_SIZE.INLINE} />} label={WORDS.WAITING} />
        ) : (
          joined.map(({ host, label }) => (
            <SettingsRow
              key={host.id}
              label={label}
              description={DEVICE_PLATFORM_NAME[host.platform ?? DEVICE_PLATFORM.LINUX]}
            />
          ))
        )}
      </SettingsSection>
    </Dialog>
  );
}

/** The Hosts page's one group, untitled under the page's own title: the member's machines as the host holds them, or why they cannot be drawn, and Add hosts under them. */
export function HostsSection({ signedIn }: { signedIn: boolean }): React.JSX.Element | null {
  const { act } = useAct();
  // Note that the clock only redraws the rows as a beat ages, since each standing is read off the book's own monotonic clock.
  useSecond();
  const accountId = signedInAccountId(useAppSlice(APP_SLICE.ACCOUNT));
  const read = useHostRead(LIVE_READ.HOSTS, signedIn ? accountId : undefined);
  const hosts = read.rows?.hosts;
  const installScriptUrl = read.rows?.installScriptUrl;
  // Note that each host's beat is the window's shared presence, read often enough that a host that keeps beating never reads offline.
  const book = useDevicePresence(signedIn);
  // The ids of the account's hosts as Add hosts opened, by the account it opened for, while its dialog stands.
  const [adding, setAdding] = useState<
    { readonly accountId: string | undefined; readonly known: ReadonlySet<string> } | undefined
  >(undefined);
  // Note that Add hosts does not outlive the account it opened for, since every host of the next would read as joined.
  if (adding !== undefined && adding.accountId !== accountId) setAdding(undefined);
  const thisMac = useThisMac();
  const [connecting, closeConnect] = useHostConnect();
  // A pairing's question does not outlive the page it was asked over.
  useEffect(() => closeConnect, [closeConnect]);

  // Note that Add hosts waits for the list, since the dialog names only the hosts the list did not hold as it opened, and its command names the script the list's answer does.
  const add = useCallback(() => {
    if (hosts !== undefined) setAdding({ accountId, known: new Set(hosts.map((host) => host.id)) });
  }, [hosts, accountId]);
  const closeAdd = useCallback(() => setAdding(undefined), []);

  // Note that Remove asks over the section rather than its row, because the host draws a removal gone on the list the moment it is asked, so the row is gone before a refusal comes back to be said.
  const [asked, setAsked] = useState<RemoveAsked | undefined>(undefined);
  const removing = useConfirmDialog(
    { subject: asked !== undefined && asked.accountId === accountId, surfaceOpen: true },
    () =>
      asked === undefined
        ? Promise.resolve(REFUSED)
        : act(ACT_KIND.HOSTS_REMOVE, { id: asked.host.id })
            .catch(() => undefined)
            .then((answer) => (answer === undefined || "failure" in answer ? REFUSED : ACCEPTED)),
    confirmFailure(FAILURE_SURFACE.HOST_REMOVE),
  );
  const askRemove = (host: HostLine, label: string) => {
    setAsked({ accountId, host, label });
    removing.ask();
  };

  const listed = hosts?.map(machineOf) ?? [];
  // Note that This Mac stands first, with no Remove, only where the app keeps its host.
  const listedMac =
    thisMac === undefined ? undefined : hosts?.find((host) => isThisMac(machineOf(host), thisMac));
  const loaded = signedIn && hosts !== undefined && installScriptUrl !== undefined;
  const ordered =
    hosts === undefined || listedMac === undefined
      ? (hosts ?? [])
      : [listedMac, ...hosts.filter((host) => host !== listedMac)];
  // Note that this Mac stands even before the service lists its host, reading offline as a host does until it calls in.
  const thisMacAlone = thisMac !== undefined && listedMac === undefined;
  return (
    <>
      {/* Note that signed out the section holds the search anchor, since Add hosts is drawn only for a signed-in member. */}
      <SettingsSection anchor={signedIn ? undefined : SETTINGS_SEARCH_ROW.ADD_HOSTS}>
        {!signedIn ? (
          <SettingsLine>{SIGNED_OUT_WORDS}</SettingsLine>
        ) : loaded && ordered.length === 0 && !thisMacAlone ? (
          <SettingsLine>{WORDS.NONE}</SettingsLine>
        ) : loaded ? (
          <>
            {thisMacAlone ? (
              <SettingsRow
                label={THIS_MAC}
                description={
                  <SettingsRowStateLine state={SETTINGS_ROW_STATE.ATTENTION}>
                    {WORDS.OFFLINE}
                  </SettingsRowStateLine>
                }
              />
            ) : null}
            {ordered.map((host) => {
              const label = machineName(machineOf(host), listed, thisMac);
              return (
                <HostRow
                  key={host.id}
                  host={host}
                  label={label}
                  book={book}
                  onRemove={() => askRemove(host, label)}
                  locked={removing.busy}
                  kept={host === listedMac}
                />
              );
            })}
          </>
        ) : read.status === HOST_READ_STATUS.FAILED ? (
          <SettingsLine>
            <ErrorState failure={unreadShown(FAILURE_SURFACE.HOSTS_READ)} onRetry={read.retry}>
              {readFailedWords("your hosts")}
            </ErrorState>
          </SettingsLine>
        ) : (
          <SettingsRowsSkeleton label={readingWords("your hosts")} rows={HOSTS_SKELETON} />
        )}
      </SettingsSection>
      {signedIn ? (
        <div className={ADD_LINE} {...searchAnchorProps(SETTINGS_SEARCH_ROW.ADD_HOSTS)}>
          <Button
            variant={BUTTON_VARIANT.OUTLINE}
            icon={<PlusIcon />}
            disabled={!loaded}
            onClick={add}
          >
            {WORDS.ADD}
          </Button>
        </div>
      ) : null}
      <RemoveHostDialog asked={asked} confirm={removing} />
      {adding === undefined || !loaded ? null : (
        <AddHostsDialog
          known={adding.known}
          hosts={hosts}
          thisMac={thisMac}
          installScriptUrl={installScriptUrl}
          onClose={closeAdd}
        />
      )}
      {/* Note that a pairing's dialog comes after Add hosts, so it stands over it where both are open. */}
      {connecting === undefined || !signedIn ? null : (
        <HostConnectDialog key={connecting} code={connecting} onClose={closeConnect} />
      )}
    </>
  );
}
