import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readFailedWords, TERM, VERB } from "@repo/features/words";
import type { WorkspaceMember } from "@repo/features/workspace-wire";
import { ErrorState, MENU_DETAIL, Spinner } from "@repo/ui";
import { memberActor, type PersonActor } from "@repo/ui/actor-model";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { UserIcon, UsersIcon } from "lucide-react";
import { ACTOR_SIZE, ActorMark, PersonCard } from "./actor-ref.js";
import type { MenuAction } from "./desktop/action-menu.js";
import { unreadShown } from "./failure-report.js";
import type { Directory } from "./member-directory.js";

export const YOU_WORD = "You";

export const PEOPLE_FILTER_WORDS = {
  ANYONE: "Anyone",
  ME: "Me",
} as const;

export function memberReadNotice(
  reader: Pick<Directory, "reading" | "refused" | "retry">,
): MenuAction[] {
  if (reader.refused) {
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
  if (!reader.reading) return [];
  return [{ label: `Reading ${TERM.MEMBER.many}…`, disabled: true, onSelect: () => undefined }];
}

export function memberReadNote(
  reader: Pick<Directory, "reading" | "refused" | "retry">,
): React.ReactNode {
  if (reader.refused) {
    return (
      <ErrorState failure={unreadShown(FAILURE_SURFACE.MEMBERS_READ)} onRetry={reader.retry}>
        {readFailedWords(TERM.MEMBER.many)}
      </ErrorState>
    );
  }
  return reader.reading ? <Spinner delay label="Reading members" /> : undefined;
}

export interface MemberRow {
  readonly member: WorkspaceMember;
  readonly actor: PersonActor;
  readonly label: string;
  readonly icon: React.JSX.Element;
  readonly detail: string;
  readonly terms: readonly string[];
  readonly card: React.JSX.Element;
}

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

export const PEOPLE_FILTER = {
  ANYONE: "anyone",
  ME: "me",
  PERSON: "person",
} as const;

export type PeopleFilter =
  | { readonly kind: typeof PEOPLE_FILTER.ANYONE }
  | { readonly kind: typeof PEOPLE_FILTER.ME }
  | { readonly kind: typeof PEOPLE_FILTER.PERSON; readonly userId: string; readonly name: string };

export function peopleFilterActions({
  members,
  readerId,
  chosen,
  onChoose,
  meWithoutId = false,
  meFirst = false,
}: {
  members: readonly WorkspaceMember[] | undefined;
  readerId: string | undefined;
  chosen: PeopleFilter | { readonly kind: typeof PEOPLE_FILTER.PERSON; readonly userId: string };
  onChoose: (filter: PeopleFilter) => void;
  meWithoutId?: boolean;
  meFirst?: boolean;
}): MenuAction[] {
  const rows = memberRows(members, readerId);
  const mine = rows.find((row) => row.actor.you);
  const me: MenuAction[] =
    readerId === undefined && !meWithoutId
      ? []
      : [
          {
            label: PEOPLE_FILTER_WORDS.ME,
            icon: mine?.icon ?? <UserIcon />,
            card: mine?.card,
            checked: chosen.kind === PEOPLE_FILTER.ME,
            onSelect: () => onChoose({ kind: PEOPLE_FILTER.ME }),
          },
        ];
  const anyone: MenuAction = {
    label: PEOPLE_FILTER_WORDS.ANYONE,
    icon: <UsersIcon />,
    checked: chosen.kind === PEOPLE_FILTER.ANYONE,
    onSelect: () => onChoose({ kind: PEOPLE_FILTER.ANYONE }),
  };
  return [
    ...(meFirst ? [...me, anyone] : [anyone, ...me]),
    ...rows
      .filter((row) => !row.actor.you)
      .map((row) => ({
        key: row.member.userId,
        label: row.label,
        icon: <ReplayMask>{row.icon}</ReplayMask>,
        detail: row.detail,
        detailPlace: MENU_DETAIL.BESIDE,
        card: row.card,
        replayMasked: true,
        checked: chosen.kind === PEOPLE_FILTER.PERSON && chosen.userId === row.member.userId,
        onSelect: () =>
          onChoose({ kind: PEOPLE_FILTER.PERSON, userId: row.member.userId, name: row.label }),
      })),
  ];
}
