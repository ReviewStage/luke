import { CHECK_SUMMARY } from "@luke/features/coding-agent-wire";
import { INBOX_BLOCK } from "@luke/features/inbox-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { LONE_LINK, type LoneLink, loneLinkOf } from "@luke/features/lone-link";
import { LINK_PLACE } from "@luke/features/luke-link";
import {
  decodeMention,
  isBareLink,
  MENTION_KIND,
  type Mention,
  mentionName,
} from "@luke/features/mention-link";
import { placeChipLook } from "@luke/features/place-chip-model";
import { LIST_VARIANT, List, ListRow, ProviderMark } from "@luke/ui";
import { AppWindowIcon } from "lucide-react";
import { createContext, type ReactNode, useContext } from "react";
import { RowHint, RowHintOptions } from "../tooltip.js";
import { LinesChanged } from "./agent-published.js";
import { pullRequestStateWord } from "./coding-agent-model.js";
import { InboxCodeCard, type InboxCodeDoors } from "./inbox-code-card.js";
import { MentionChipCard } from "./mention-chip.js";
import { PullRequestMark } from "./pull-request-mark.js";
import { useMentionDoors } from "./task-mentions.js";
import { useKnownNames } from "./use-known-names.js";
import { type LinkStanding, useLinkStanding } from "./use-link-standing.js";
import { useOpenLink } from "./use-open-link.js";

/**
 * lone-link-card.tsx -- a link standing alone in its paragraph of words drawn as a document, as its one-line card: a pull request's, a page's, or the lines of a file at a commit as the Code tab's card.
 *
 * What a link earns a card is the link's own (`@luke/features/lone-link`);
 * how each card is drawn is decided here. A pull request is a card of one
 * row as the agent's tab pins its own over the box (`agent-published.tsx`):
 * its mark for where it stands and its number and title, as the
 * workspace's GitHub App answers them (`use-link-standing.ts`), where it
 * stands where that matters, and its lines added and removed; until it
 * answers, or where it never does, the row says what the address says. A
 * page an agent showed is a row of its tab's glyph and its name. Either
 * hangs the card its chip hangs (`mention-chip.tsx`): a pull request's its
 * key, state, size, opener, branches, labels, and counts, and a page's
 * the page's own card, a preview of it (`page-card.tsx`), where the window
 * holds the page. Either opens what it names as its chip does. Lines
 * of a file are the card an Inbox code block draws (`inbox-code-card.tsx`),
 * read through the doors the place drawing the words hands
 * (`LoneLinkCards`); where it hands none, the link stays its chip. Any
 * link that earns no card stays the paragraph it was, its chip or its
 * link inside.
 */

/** What the cards under the words reach: the code doors their lines are read and opened through. */
export interface LoneLinkDoors {
  readonly code: InboxCodeDoors;
}

const LoneLinkDoorsContext = createContext<LoneLinkDoors | undefined>(undefined);

/** Hands the cards under it the doors they read through. */
export function LoneLinkCards({
  doors,
  children,
}: {
  doors: LoneLinkDoors;
  children: ReactNode;
}): React.JSX.Element {
  return <LoneLinkDoorsContext.Provider value={doors}>{children}</LoneLinkDoorsContext.Provider>;
}

/** What a pull request's or a page's row is named for a reader moving between lists. */
const CARD_LABEL = {
  PULL_REQUEST: "Pull request",
  PAGE: "Page",
} as const;

/** The words a link was written with, without an `@`; none where it was written as its own address. */
function writtenWords(target: string, words: string): string | undefined {
  return isBareLink(words, target) ? undefined : mentionName(words.trim());
}

/** A card of one row, as a list of one in a card. */
function OneRowCard({
  label,
  kind,
  children,
}: {
  label: string;
  kind: LoneLink["kind"];
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="lone-link-card" data-lone-link={kind}>
      <List label={label} variant={LIST_VARIANT.CARD}>
        {children}
      </List>
    </div>
  );
}

/**
 * A pull request's number as its row says it: `#42` where it is of the
 * task's own repository, and its key, `relay#42`, as GitHub answered it or
 * as the address spells it, where it is another's.
 */
function numberWords(
  pullRequest: Extract<LoneLink, { kind: typeof LONE_LINK.PULL_REQUEST }>,
  standing: LinkStanding | undefined,
  repository: string | null,
): string {
  const own =
    repository !== null && repository.toLowerCase() === pullRequest.repository.toLowerCase();
  if (own) return `#${pullRequest.number}`;
  return standing?.key ?? `${pullRequest.repository}#${pullRequest.number}`;
}

/** A pull request's row: its mark, its number and title, where it stands, and its lines; a press opens it on GitHub. */
function PullRequestRowCard({
  pullRequest,
  mention,
  target,
  words,
  repository,
}: {
  pullRequest: Extract<LoneLink, { kind: typeof LONE_LINK.PULL_REQUEST }>;
  mention: Mention;
  target: string;
  words: string;
  repository: string | null;
}): React.JSX.Element {
  const doors = useMentionDoors();
  const openLink = useOpenLink();
  const standing = useLinkStanding(mention, {
    taskId: doors.taskId,
    workspace: doors.place.workspace,
  });
  const known = standing?.pullRequest;
  const number = numberWords(pullRequest, standing, repository);
  const title = standing?.title ?? writtenWords(target, words);
  const state = known === undefined ? undefined : pullRequestStateWord(known.state);
  const named = title === undefined ? number : `${number} · ${title}`;
  return (
    <OneRowCard label={CARD_LABEL.PULL_REQUEST} kind={LONE_LINK.PULL_REQUEST}>
      <RowHintOptions
        card={
          <MentionChipCard
            mention={mention}
            target={target}
            name={writtenWords(target, words) ?? number}
            doors={doors}
            standing={standing}
          />
        }
      >
        <ListRow
          leading={
            known === undefined ? (
              <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />
            ) : (
              <PullRequestMark pullRequest={{ ...known, checks: CHECK_SUMMARY.NONE }} />
            )
          }
          title={named}
          meta={
            state === undefined && known?.lines === undefined ? undefined : (
              <span className="agent-published-meta">
                {state === undefined ? null : <span>{state}</span>}
                {known?.lines === undefined ? null : (
                  <LinesChanged
                    additions={known.lines.additions}
                    deletions={known.lines.deletions}
                  />
                )}
              </span>
            )
          }
          hint={{ Hint: RowHint, label: named }}
          onPress={(event) => {
            // Note that the press stops here, as a chip's does, because a click into a section opens its editor.
            event.stopPropagation();
            openLink(target);
          }}
        />
      </RowHintOptions>
    </OneRowCard>
  );
}

/** A page's row: its tab's glyph and its name, hanging the page's own card where the window holds the page; a press opens its tab. */
function PageRowCard({
  page,
  target,
  words,
}: {
  page: Extract<LoneLink, { kind: typeof LONE_LINK.PAGE }>;
  target: string;
  words: string;
}): React.JSX.Element {
  const doors = useMentionDoors();
  const openLink = useOpenLink();
  const known = useKnownNames();
  const place = { kind: LINK_PLACE.PAGE, planId: page.taskId, pageId: page.pageId } as const;
  const { name } = placeChipLook(place, writtenWords(target, words), known);
  const glyph = <AppWindowIcon aria-hidden="true" />;
  // Note that the page is named from the link as the bar read it, because a page's link the window reads, one ending in a slash or a fragment, may be no mention's.
  const mention = { kind: MENTION_KIND.PAGE, taskId: page.taskId, pageId: page.pageId } as const;
  return (
    <OneRowCard label={CARD_LABEL.PAGE} kind={LONE_LINK.PAGE}>
      <RowHintOptions
        card={
          <MentionChipCard
            mention={mention}
            target={target}
            name={name}
            doors={doors}
            standing={undefined}
          />
        }
      >
        <ListRow
          leading={glyph}
          title={name}
          hint={{ Hint: RowHint, label: name }}
          onPress={(event) => {
            event.stopPropagation();
            openLink(target);
          }}
        />
      </RowHintOptions>
    </OneRowCard>
  );
}

/**
 * A link standing alone in its paragraph: the card of what it names where
 * it earns one, and `fallback`, the paragraph as it was, where it earns
 * none, or where its card's doors are not handed here.
 */
export function LoneLinkCard({
  target,
  words,
  fallback,
}: {
  target: string;
  /** The words the link was written with. */
  words: string;
  fallback: ReactNode;
}): ReactNode {
  const doors = useContext(LoneLinkDoorsContext);
  const lone = loneLinkOf(target);
  switch (lone?.kind) {
    case LONE_LINK.PULL_REQUEST: {
      const repository = doors?.code.repository ?? null;
      const mention = decodeMention(target, repository);
      if (mention === undefined) return fallback;
      return (
        <PullRequestRowCard
          pullRequest={lone}
          mention={mention}
          target={target}
          words={words}
          repository={repository}
        />
      );
    }
    case LONE_LINK.PAGE:
      return <PageRowCard page={lone} target={target} words={words} />;
    case LONE_LINK.CODE: {
      if (doors === undefined) return fallback;
      const { repo, path, sha, startLine, endLine } = lone;
      const block = { type: INBOX_BLOCK.CODE, repo, path, sha, startLine, endLine };
      return (
        <div className="lone-link-card" data-lone-link={LONE_LINK.CODE}>
          <InboxCodeCard block={block} code={doors.code} />
        </div>
      );
    }
    case undefined:
      return fallback;
  }
}
