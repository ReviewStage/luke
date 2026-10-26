import { readFailedWords, TERM, VERB } from "@luke/features/words";
import type { WorkspaceMember } from "@luke/features/workspace-wire";
import { MENU_DETAIL } from "@luke/ui";
import { memberActor, type PersonActor } from "@luke/ui/actor-model";
import { ACTOR_SIZE, ActorMark, PersonCard } from "./actor-ref.js";
import type { MenuAction } from "./desktop/action-menu.js";
import type { Directory } from "./member-directory.js";

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

/**
 * The row standing last in a people menu while the members are read or could
 * not be: a disabled row for the wait, and for the failure a row that says
 * they could not be read, whose press, Retry, reads them again and leaves the
 * menu standing; none while the members stand read.
 */
export function memberReadNotice(
  reader: Pick<Directory, "membersReading" | "membersRefused" | "retry">,
): MenuAction[] {
  if (reader.membersRefused) {
    return [
      {
        label: readFailedWords(TERM.MEMBER.many),
        detail: VERB.RETRY,
        detailPlace: MENU_DETAIL.BESIDE,
        stays: true,
        onSelect: reader.retry,
      },
    ];
  }
  if (!reader.membersReading) return [];
  return [{ label: `Reading ${TERM.MEMBER.many}…`, disabled: true, onSelect: () => undefined }];
}

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
