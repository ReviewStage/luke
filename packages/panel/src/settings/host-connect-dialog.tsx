import { useAtom, useAtomSet } from "@effect/atom-react";
import {
  HOST_PAIRING_CALL_FAILURE,
  type HostPairingFailed,
} from "@repo/features/host-pairing-view";
import { type HostPairingAnswer, shownHostUserCode } from "@repo/features/host-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { clockText, momentText } from "@repo/features/time-format";
import { readFailedWords, readingWords } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import {
  ANNOUNCE,
  BUTTON_VARIANT,
  Button,
  Dialog,
  DialogActions,
  ErrorLine,
  ErrorState,
  GAP,
  SettingsRow,
  SettingsRowMark,
  SettingsSection,
  SpinnerRegion,
  Stack,
  TEXT_FONT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import * as Atom from "effect/reactivity/Atom";
import { useCallback, useEffect, useState } from "react";
import { useAct } from "../act.js";
import { DEVICE_PLATFORM_NAME } from "../device-platform.js";
import { unreadShown } from "../failure-report.js";
import { DeviceGlyph } from "../tasks/runs-on.js";

/**
 * host-connect-dialog.tsx -- a box's pairing approved or denied over Settings › Hosts, by the code its link named: the box as it named itself and the address its start came from, the code to hold against its terminal, and Connect or Deny.
 *
 * A box that pairs prints a link, `<origin>/connect/<code>`, and the code
 * itself. The link opened in a window hands its code here
 * (`useOpenHostConnect`), and Settings › Hosts, which only stands while
 * Bring your own host is on, draws this dialog over itself. It reads the
 * pairing, then asks "Connect <name>?" over a row of the box as it named
 * itself, its platform's glyph, and what it is, its architecture, and the
 * address its start came from, since those are what tell a member their own
 * box from one a stranger started and sent them the link to, as a device
 * code's approval shows the device (RFC 8628); nothing is pressed for them,
 * so focus rests on the card. Connect makes the host at once and closes onto the list, which
 * reads it; Deny ends the pairing and says so. A code no pending pairing has,
 * lapsed, used, mistyped, or held after too many such codes, reads as that,
 * with what to do: run the command on the host again for a new code.
 */

/** The code a window was handed to approve, which Settings › Hosts draws its dialog for until it is put away. */
const hostConnectAtom = Atom.keepAlive(Atom.make<string | undefined>(undefined));

const WORDS = {
  TITLE: "Connect a host",
  MATCH: "Connect it only if you ran the command on it, and this code matches the one it shows.",
  CONNECT: "Connect",
  CONNECTING: "Connecting",
  DENY: "Deny",
  DENYING: "Denying",
  DENIED:
    "It isn't connected to your account, and its command stops waiting. To connect it, run the command on it again.",
  AGAIN: "Run the command on the host again for a new code.",
  NOT_FOUND_TITLE: "This code can't be used",
  NOT_FOUND: "It may have expired, been used already, or been typed wrong.",
  HELD_TITLE: "Too many codes tried",
  HELD: "Your account tried too many codes that match no host.",
  HELD_SOON: "Try again in a few minutes.",
  UNREAD: readFailedWords("the code"),
  UNANSWERED: "Could not reach the service. Try again.",
} as const;

/** Where the dialog stands: reading the pairing, unable to, asking, or done in one of the ways it ends. */
const STANDING = {
  READING: "reading",
  UNREAD: "unread",
  ASKING: "asking",
  CONNECTED: "connected",
  DENIED: "denied",
  REFUSED: "refused",
} as const;

/** Which of the two answers was pressed. */
const ANSWER = {
  CONNECT: "connect",
  DENY: "deny",
} as const;

type Answer = (typeof ANSWER)[keyof typeof ANSWER];

/** Where an answer stands while the question still does: on its way, or failed on its way to the service. */
const SENDING = {
  ...ANSWER,
  UNANSWERED: "unanswered",
} as const;

type Sending = (typeof SENDING)[keyof typeof SENDING];

type Standing =
  | { readonly kind: typeof STANDING.READING | typeof STANDING.UNREAD }
  | {
      readonly kind: typeof STANDING.ASKING;
      readonly box: HostPairingAnswer;
      readonly sending?: Sending;
    }
  | {
      readonly kind: typeof STANDING.CONNECTED | typeof STANDING.DENIED;
      readonly box: HostPairingAnswer;
    }
  | { readonly kind: typeof STANDING.REFUSED; readonly refusal: HostPairingFailed };

/** An answer that never reached the service, as a call that failed on its way is read. */
const UNANSWERED: HostPairingFailed = { failure: HOST_PAIRING_CALL_FAILURE.UNANSWERED };

/** What the box is, as its row says under its name: its platform, its architecture, and the address its start came from. */
function boxFacts(box: HostPairingAnswer): string {
  return [DEVICE_PLATFORM_NAME[box.platform], box.arch, ...(box.ip === null ? [] : [box.ip])].join(
    " · ",
  );
}

/** When the code lapses, as a time of day, since a pairing lasts minutes. */
function expiresAt(at: number): string {
  const moment = new Date(at);
  return clockText(moment.getHours(), moment.getMinutes());
}

/** What a code that cannot be approved says: why, and what to do next. */
function refusalWords(refusal: HostPairingFailed): { title: string; body: string } {
  if (refusal.failure !== HOST_PAIRING_CALL_FAILURE.HELD) {
    return { title: WORDS.NOT_FOUND_TITLE, body: `${WORDS.NOT_FOUND} ${WORDS.AGAIN}` };
  }
  const when =
    refusal.heldUntil === undefined
      ? WORDS.HELD_SOON
      : `Try again after ${momentText(refusal.heldUntil)}.`;
  return { title: WORDS.HELD_TITLE, body: `${WORDS.HELD} ${when} ${WORDS.AGAIN}` };
}

/** Where a read or an answer that failed leaves the dialog: unable to read or answer where it never reached the service, and refused otherwise. */
function failedStanding(failed: HostPairingFailed, unanswered: Standing): Standing {
  return failed.failure === HOST_PAIRING_CALL_FAILURE.UNANSWERED
    ? unanswered
    : { kind: STANDING.REFUSED, refusal: failed };
}

/** Hands Settings › Hosts a code to approve, as a pairing's link opened in this window does. */
export function useOpenHostConnect(): (code: string) => void {
  return useAtomSet(hostConnectAtom);
}

/** The code Settings › Hosts draws its dialog for, and how it is put away; none while no link handed one. */
export function useHostConnect(): readonly [string | undefined, () => void] {
  const [code, setCode] = useAtom(hostConnectAtom);
  const close = useCallback(() => setCode(undefined), [setCode]);
  return [code, close];
}

/** The question: whose box, the code to hold against its terminal and when it expires, and Deny and Connect, Connect's check standing once the host is made. */
function AskDialog({
  code,
  box,
  sending,
  connected,
  onAnswer,
  onClose,
}: {
  code: string;
  box: HostPairingAnswer;
  sending: Sending | undefined;
  connected: boolean;
  onAnswer: (answer: Answer) => void;
  onClose: () => void;
}): React.JSX.Element {
  const inFlight = sending === SENDING.CONNECT || sending === SENDING.DENY;
  const settled = inFlight || connected;
  return (
    <Dialog
      open
      title={`Connect ${box.name}?`}
      // Note that the question names the box by the name and address it reported, so its title stays masked in a screen recording.
      replayUnmasked
      titleReplayMasked
      busy={settled}
      // Note that an answer under way, or the host just made, holds the card until it lands.
      onDismiss={settled ? () => undefined : onClose}
      actions={
        <>
          <Button
            variant={BUTTON_VARIANT.QUIET}
            disabled={settled}
            busy={sending === SENDING.DENY}
            busyLabel={WORDS.DENYING}
            onClick={() => onAnswer(ANSWER.DENY)}
          >
            <ReplayUnmask>{WORDS.DENY}</ReplayUnmask>
          </Button>
          <Button
            variant={BUTTON_VARIANT.PRIMARY}
            disabled={sending === SENDING.DENY}
            busy={sending === SENDING.CONNECT}
            busyLabel={WORDS.CONNECTING}
            done={connected}
            onDone={onClose}
            onClick={() => onAnswer(ANSWER.CONNECT)}
          >
            <ReplayUnmask>{WORDS.CONNECT}</ReplayUnmask>
          </Button>
        </>
      }
    >
      <Stack gap={GAP.CONTROL}>
        <SettingsSection>
          <SettingsRow
            leading={
              <SettingsRowMark>
                <DeviceGlyph device={box} />
              </SettingsRowMark>
            }
            label={<ReplayMask>{box.name}</ReplayMask>}
            description={<ReplayMask>{boxFacts(box)}</ReplayMask>}
          />
        </SettingsSection>
        <Text>{WORDS.MATCH}</Text>
        <Text variant={TEXT_VARIANT.SECTION} font={TEXT_FONT.MONO}>
          <ReplayMask>{shownHostUserCode(code)}</ReplayMask>
        </Text>
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {`This code expires at ${expiresAt(box.expiresAt)}.`}
        </Text>
        <ErrorLine
          level={ANNOUNCE.ALERT}
          error={
            sending === SENDING.UNANSWERED
              ? {
                  words: WORDS.UNANSWERED,
                  failure: unreadShown(FAILURE_SURFACE.HOST_PAIRING_ANSWER),
                }
              : undefined
          }
        />
      </Stack>
    </Dialog>
  );
}

/** A dialog that only says how the pairing ended, closed from its Done. */
function EndedDialog({
  title,
  titleReplayMasked = false,
  body,
  onClose,
}: {
  title: string;
  /** Whether the title names the box, kept masked in a screen recording. */
  titleReplayMasked?: boolean;
  body: string;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <Dialog
      open
      title={title}
      replayUnmasked
      titleReplayMasked={titleReplayMasked}
      onDismiss={onClose}
      actions={<DialogActions onDone={onClose} />}
    >
      <Text>{body}</Text>
    </Dialog>
  );
}

/** The card while the pairing is read, or why it could not be, with Retry. */
function ReadingDialog({
  unread,
  onRetry,
  onClose,
}: {
  unread: boolean;
  onRetry: () => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <Dialog
      open
      title={WORDS.TITLE}
      replayUnmasked
      onDismiss={onClose}
      actions={unread ? <DialogActions onDone={onClose} /> : undefined}
    >
      {unread ? (
        <ErrorState failure={unreadShown(FAILURE_SURFACE.HOST_PAIRING_READ)} onRetry={onRetry}>
          {WORDS.UNREAD}
        </ErrorState>
      ) : (
        <SpinnerRegion label={readingWords("the code")} />
      )}
    </Dialog>
  );
}

/**
 * The dialog for one code: read as it opens, then asked, answered, or why it
 * cannot be. Once Connect's check has been seen it closes onto the list,
 * which carries the host made as the service lists it.
 */
export function HostConnectDialog({
  code,
  onClose,
}: {
  code: string;
  onClose: () => void;
}): React.JSX.Element {
  const { act } = useAct();
  const [standing, setStanding] = useState<Standing>({ kind: STANDING.READING });
  const [attempt, setAttempt] = useState(0);

  // The dialog opening reads the pairing the code names, so the member sees whose box it is before anything is pressed.
  useEffect(() => {
    let live = true;
    setStanding({ kind: STANDING.READING });
    act(ACT_KIND.HOSTS_PAIRING_READ, { code })
      .catch(() => UNANSWERED)
      .then((answer) => {
        if (!live) return;
        setStanding(
          "failure" in answer
            ? failedStanding(answer, { kind: STANDING.UNREAD })
            : { kind: STANDING.ASKING, box: answer },
        );
      });
    return () => {
      live = false;
    };
  }, [act, code, attempt]);

  const answer = useCallback(
    (box: HostPairingAnswer, pressed: Answer) => {
      setStanding({ kind: STANDING.ASKING, box, sending: pressed });
      const sent =
        pressed === ANSWER.CONNECT
          ? act(ACT_KIND.HOSTS_PAIRING_APPROVE, { code })
          : act(ACT_KIND.HOSTS_PAIRING_DENY, { code });
      sent
        .catch(() => UNANSWERED)
        .then((answered) => {
          const unanswered = { kind: STANDING.ASKING, box, sending: SENDING.UNANSWERED } as const;
          const ended = pressed === ANSWER.CONNECT ? STANDING.CONNECTED : STANDING.DENIED;
          setStanding(
            "failure" in answered ? failedStanding(answered, unanswered) : { kind: ended, box },
          );
        });
    },
    [act, code],
  );

  switch (standing.kind) {
    case STANDING.ASKING:
    case STANDING.CONNECTED:
      return (
        <AskDialog
          code={code}
          box={standing.box}
          sending={standing.kind === STANDING.ASKING ? standing.sending : undefined}
          connected={standing.kind === STANDING.CONNECTED}
          onAnswer={(pressed) => answer(standing.box, pressed)}
          onClose={onClose}
        />
      );
    case STANDING.DENIED:
      return (
        <EndedDialog
          title={`Denied ${standing.box.name}`}
          titleReplayMasked
          body={WORDS.DENIED}
          onClose={onClose}
        />
      );
    case STANDING.REFUSED:
      return <EndedDialog {...refusalWords(standing.refusal)} onClose={onClose} />;
    default:
      return (
        <ReadingDialog
          unread={standing.kind === STANDING.UNREAD}
          onRetry={() => setAttempt((count) => count + 1)}
          onClose={onClose}
        />
      );
  }
}
