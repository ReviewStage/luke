import type { WorkspaceMember } from "@luke/features/workspace-wire";
import { MENU_DETAIL } from "@luke/ui";
import { memberActor, type PersonActor } from "@luke/ui/actor-model";
import { UserIcon, UsersIcon } from "lucide-react";
import { ACTOR_SIZE, ActorMark, PersonCard } from "./actor-ref.js";
import type { MenuAction } from "./desktop/action-menu.js";

/**
 * member-rows.tsx -- the one people list every menu of people draws: the reader first, then everyone else by name.
 *
 * Each person is drawn as the assignee picker first drew them: their face at
 * a menu's size, their name, "You" for the reader and their email for
 * everyone else as the detail, found by their name and their email, and
 * their card hung beside the row. The `@` menu, ⌘K, the assignee picker, the
 * Tasks page's filters, and the new-owner picker each map these rows onto
 * their own engine's; a filter by person, the Inbox's Whose and the
 * sidebar's Assigned to and Created by, leads with Anyone and the reader as
 * Me (`peopleFilterActions`), so every filter says the same two words.
 */

/** What a person's row says of the reader in their email's place. */
export const YOU_WORD = "You";

/** What a filter by person calls its two fixed choices: no one in particular, and the reader. */
export const PEOPLE_FILTER_WORDS = {
  ANYONE: "Anyone",
  ME: "Me",
} as const;

/** One person as every people menu lists them. */
export interface MemberRow {
  readonly member: WorkspaceMember;
  readonly actor: PersonActor;
  readonly label: string;
  /** Their face at a menu's size. */
  readonly icon: React.JSX.Element;
  /** "You" for the reader, their email for anyone else. */
  readonly detail: string;
  /** What a search matches: their name and their email. */
  readonly terms: readonly string[];
  /** Their card, hung beside the row while the pointer rests on it. */
  readonly card: React.JSX.Element;
}

/** The members with the reader first and everyone else by name. */
function readerFirst(
  members: readonly WorkspaceMember[],
  readerId: string | undefined,
): readonly WorkspaceMember[] {
  return [...members].sort(
    (one, other) =>
      Number(other.userId === readerId) - Number(one.userId === readerId) ||
      one.name.localeCompare(other.name),
  );
}

/** The workspace's members as every people menu lists them, the reader first; none while the members are unread. */
export function memberRows(
  members: readonly WorkspaceMember[] | undefined,
  readerId: string | undefined,
): readonly MemberRow[] {
  return readerFirst(members ?? [], readerId).map((member) => {
    const actor = memberActor(member, readerId);
    return {
      member,
      actor,
      label: member.name,
      icon: <ActorMark actor={actor} size={ACTOR_SIZE.INLINE} />,
      detail: actor.you ? YOU_WORD : member.email,
      terms: [member.name, member.email],
      card: <PersonCard actor={actor} />,
    };
  });
}

/**
 * A filter by person's choices: Anyone, then the reader as Me, then each
 * other member as `memberRows` draws them, their email beside their name and
 * their card beside the row, the one chosen checked. `chosen` is the account
 * id filtered to, none for Anyone, and a choice hands `onChoose` the same,
 * with the member it names where it names one.
 */
export function peopleFilterActions({
  members,
  readerId,
  chosen,
  onChoose,
}: {
  members: readonly WorkspaceMember[] | undefined;
  readerId: string | undefined;
  chosen: string | undefined;
  onChoose: (userId: string | undefined, member?: WorkspaceMember) => void;
}): MenuAction[] {
  const rows = memberRows(members, readerId);
  const mine = rows.find((row) => row.actor.you);
  const me: MenuAction[] =
    readerId === undefined
      ? []
      : [
          {
            label: PEOPLE_FILTER_WORDS.ME,
            icon: mine?.icon ?? <UserIcon />,
            card: mine?.card,
            checked: chosen === readerId,
            onSelect: () => onChoose(readerId, mine?.member),
          },
        ];
  return [
    {
      label: PEOPLE_FILTER_WORDS.ANYONE,
      icon: <UsersIcon />,
      checked: chosen === undefined,
      onSelect: () => onChoose(undefined),
    },
    ...me,
    ...rows
      .filter((row) => !row.actor.you)
      .map((row) => ({
        label: row.label,
        icon: row.icon,
        detail: row.detail,
        detailPlace: MENU_DETAIL.BESIDE,
        card: row.card,
        checked: chosen === row.member.userId,
        onSelect: () => onChoose(row.member.userId, row.member),
      })),
  ];
}
