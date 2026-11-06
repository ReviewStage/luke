import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { INVITATION_ROLE, inviteesOf } from "@repo/features/workspace-invitation-wire";
import { ACT_KIND } from "@repo/host/acts";
import { EMAIL_CHIP_STATE, type EmailChip, type EmailChipState } from "@repo/ui";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { actMutation } from "./act-mutations.js";
import { APP_SLICE, useAppSlice } from "./use-app-state.js";

/**
 * invitees.ts -- the addresses a form invites, as setup's team step, New workspace, and Settings' Invite hold them: typed or pasted into chips, checked as the service reads them, and marked as each is sent.
 *
 * An address the service would not read as one, or the reader's own, is
 * marked as it is typed and stays out of what is sent until it is edited
 * or lifted, so a form says what is wrong before it asks. Each address is
 * known by its lower case, as the service knows it, so one typed twice
 * stands once.
 */

/** Why an address typed is not sent, said under the field. */
const NOT_AN_ADDRESS = "Not an email address";
const YOURS = "That's you";

/** One address and where it stands. */
interface Invitee {
  readonly email: string;
  readonly words: string;
  readonly typed: string;
  readonly state: EmailChipState;
  readonly reason?: string | undefined;
}

/** What a press sends, once what was typed stands as chips: the addresses to send, and how many typed are wrong. */
export interface InviteesCommitted {
  readonly pending: readonly string[];
  readonly wrong: number;
}

/** The addresses a form holds, the chips they draw, the words still being typed, and the writes that move them. */
export interface Invitees {
  readonly chips: readonly EmailChip[];
  /** The words typed and not yet a chip. */
  readonly typed: string;
  readonly onTyped: (typed: string) => void;
  /** The addresses a press would send: the chips to send, then each address in the words typed. */
  readonly pending: readonly string[];
  /** How many chips are not sent as they stand. */
  readonly wrong: number;
  readonly add: (typed: string) => void;
  readonly remove: (id: string) => void;
  /** Lets every address go, as a form opened again starts empty. */
  readonly clear: () => void;
  /** Keeps only `emails` as addresses still to send, as a run that stopped leaves the rest. */
  readonly keep: (emails: readonly string[]) => void;
  /**
   * Turns the words typed into chips, as a press reads them, and answers
   * what the press sends at once, before the chips are drawn.
   */
  readonly commit: () => InviteesCommitted;
  /**
   * Sends each of `emails` to `workspaceId` in turn as a member, marking it
   * on its way and then sent or refused, and answers the refusals, each with
   * its address; one refused does not stop the rest.
   */
  readonly send: (workspaceId: string, emails: readonly string[]) => Promise<readonly string[]>;
}

/** Who is signed in, by the address invitations go to and the name their face is drawn by; nothing while signed out. */
export function useSignedIn(): { readonly email: string; readonly name: string } | undefined {
  const account = useAppSlice(APP_SLICE.ACCOUNT);
  if (account?.status !== ACCOUNT_STATUS.SIGNED_IN) return undefined;
  return { email: account.email, name: account.name ?? account.email };
}

function keyOf(email: string): string {
  return email.toLowerCase();
}

/** The invitees `typed` adds to `now`, each address once, the reader's own (`yours`) marked as theirs. */
function joined(
  now: readonly Invitee[],
  typed: string,
  yours: string | undefined,
): readonly Invitee[] {
  const known = new Set(now.map((one) => keyOf(one.email)));
  const added = inviteesOf(typed)
    .filter((one) => !known.has(keyOf(one.email)))
    .map((one): Invitee => {
      const mine = yours !== undefined && keyOf(one.email) === keyOf(yours);
      const reason = !one.invitable ? NOT_AN_ADDRESS : mine ? YOURS : undefined;
      return {
        email: one.email,
        words: one.name ?? one.email,
        typed: one.typed,
        state: reason === undefined ? EMAIL_CHIP_STATE.DRAFT : EMAIL_CHIP_STATE.BAD,
        reason,
      };
    });
  return [...now, ...added];
}

function pendingOf(invitees: readonly Invitee[]): readonly string[] {
  return invitees.filter((one) => one.state === EMAIL_CHIP_STATE.DRAFT).map((one) => one.email);
}

function wrongOf(invitees: readonly Invitee[]): number {
  return invitees.filter((one) => one.state === EMAIL_CHIP_STATE.BAD).length;
}

/**
 * The addresses a form invites, the reader's own (`yours`) marked as theirs.
 * Note that the words still being typed are held here beside the chips,
 * because a press reads them too: an address typed and never ended by a
 * comma is still one the form sends.
 */
export function useInvitees(yours: string | undefined): Invitees {
  const { mutateAsync: sendWorkspaceInvite } = useMutation(actMutation(ACT_KIND.WORKSPACE_INVITE));
  const [invitees, setInvitees] = useState<readonly Invitee[]>([]);
  const [typed, setTyped] = useState("");
  const mark = (email: string, state: EmailChipState, reason?: string) =>
    setInvitees((now) => now.map((one) => (one.email === email ? { ...one, state, reason } : one)));
  return {
    chips: invitees.map(({ email, ...chip }) => ({ id: keyOf(email), ...chip })),
    typed,
    onTyped: setTyped,
    pending: pendingOf(joined(invitees, typed, yours)),
    wrong: wrongOf(invitees),
    add: (words) => setInvitees((now) => joined(now, words, yours)),
    remove: (id) => setInvitees((now) => now.filter((one) => keyOf(one.email) !== id)),
    clear: () => {
      setInvitees([]);
      setTyped("");
    },
    keep: (emails) => setInvitees((now) => now.filter((one) => emails.includes(one.email))),
    commit: () => {
      const next = joined(invitees, typed, yours);
      setInvitees(next);
      setTyped("");
      return { pending: pendingOf(next), wrong: wrongOf(next) };
    },
    send: async (workspaceId, emails) => {
      const refused: string[] = [];
      for (const email of emails) {
        mark(email, EMAIL_CHIP_STATE.SENDING);
        try {
          await sendWorkspaceInvite({
            workspaceId,
            email,
            role: INVITATION_ROLE.MEMBER,
          });
          mark(email, EMAIL_CHIP_STATE.SENT);
        } catch (why) {
          const words = (why as Error).message;
          mark(email, EMAIL_CHIP_STATE.REFUSED, words);
          refused.push(`${email}: ${words}`);
        }
      }
      return refused;
    },
  };
}
