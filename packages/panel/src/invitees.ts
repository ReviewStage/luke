import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { INVITATION_ROLE, inviteesOf } from "@repo/features/workspace-invitation-wire";
import { ACT_KIND } from "@repo/host/acts";
import { EMAIL_CHIP_STATE, type EmailChip, type EmailChipState } from "@repo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { actMutation } from "./act-mutations.js";
import { appStateQuery, selectAccount } from "./use-app-state.js";

const NOT_AN_ADDRESS = "Not an email address";
const YOURS = "That's you";

interface Invitee {
  readonly email: string;
  readonly words: string;
  readonly typed: string;
  readonly state: EmailChipState;
  readonly reason?: string | undefined;
}

export interface InviteesCommitted {
  readonly pending: readonly string[];
}

export interface Invitees {
  readonly chips: readonly EmailChip[];
  readonly typed: string;
  readonly onTyped: (typed: string) => void;
  readonly pending: readonly string[];
  readonly add: (typed: string) => void;
  readonly remove: (id: string) => void;
  readonly clear: () => void;
  readonly keep: (emails: readonly string[]) => void;
  readonly commit: () => InviteesCommitted;
  readonly send: (workspaceId: string, emails: readonly string[]) => Promise<readonly string[]>;
}

export function useSignedIn(): { readonly email: string; readonly name: string } | undefined {
  const account = useQuery({ ...appStateQuery, select: selectAccount }).data;
  if (account?.status !== ACCOUNT_STATUS.SIGNED_IN) return undefined;
  return { email: account.email, name: account.name ?? account.email };
}

function keyOf(email: string): string {
  return email.toLowerCase();
}

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
    add: (words) => setInvitees((now) => joined(now, words, yours)),
    remove: (id) => setInvitees((now) => now.filter((one) => keyOf(one.email) !== id)),
    clear: () => {
      setInvitees([]);
      setTyped("");
    },
    keep: (emails) =>
      setInvitees((now) =>
        now.filter((one) => one.state !== EMAIL_CHIP_STATE.DRAFT || emails.includes(one.email)),
      ),
    commit: () => {
      const next = joined(invitees, typed, yours);
      setInvitees(next);
      setTyped("");
      return { pending: pendingOf(next) };
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
