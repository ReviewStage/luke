import { CHECK_SUMMARY } from "@repo/features/agent-wire";
import { INBOX_BLOCK } from "@repo/features/inbox-wire";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { LINK_PLACE, readLink, taskNumberOf } from "@repo/features/link-grammar";
import { LONE_LINK, type LoneLink, loneLinkOf } from "@repo/features/lone-link";
import {
  decodeMention,
  isBareLink,
  MENTION_KIND,
  type Mention,
  mentionName,
} from "@repo/features/mention-link";
import { placeChipLook } from "@repo/features/place-chip-model";
import { LIST_VARIANT, List, ListRow, ProviderMark, RowHint, RowHintOptions } from "@repo/ui";
import { AppWindowIcon } from "lucide-react";
import { createContext, type ReactNode, useContext } from "react";
import { pullRequestStateWord } from "./agent-model.js";
import { LinesChanged, PUBLISHED_META_CLASS } from "./agent-published.js";
import { InboxCodeCard, type InboxCodeDoors } from "./inbox-code-card.js";
import { githubName, MentionChipCard } from "./mention-chip.js";
import { holderTaskId } from "./mention-holder.js";
import { PullRequestMark } from "./pull-request-mark.js";
import { ShownNewestPage } from "./shown-page.js";
import { useMentionDoors } from "./task-mentions.js";
import { useKnownNames } from "./use-known-names.js";
import { useLinkStanding, useNumberedTaskId } from "./use-link-standing.js";
import { useOpenLink } from "./use-open-link.js";

export interface LoneLinkDoors {
  readonly code: InboxCodeDoors;
}

const LoneLinkDoorsContext = createContext<LoneLinkDoors | undefined>(undefined);

export function LoneLinkCards({
  doors,
  children,
}: {
  doors: LoneLinkDoors;
  children: ReactNode;
}): React.JSX.Element {
  return <LoneLinkDoorsContext.Provider value={doors}>{children}</LoneLinkDoorsContext.Provider>;
}

const CARD_LABEL = {
  PULL_REQUEST: "Pull request",
  PAGE: "Page",
} as const;

function writtenWords(target: string, words: string): string | undefined {
  return isBareLink(words, target) ? undefined : mentionName(words.trim());
}

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
    <div className="lone-link-card my-block-gap" data-lone-link={kind}>
      <List label={label} variant={LIST_VARIANT.CARD}>
        {children}
      </List>
    </div>
  );
}

function PullRequestRowCard({
  pullRequest,
  mention,
  target,
  words,
}: {
  pullRequest: Extract<LoneLink, { kind: typeof LONE_LINK.PULL_REQUEST }>;
  mention: Mention;
  target: string;
  words: string;
}): React.JSX.Element {
  const doors = useMentionDoors();
  const openLink = useOpenLink();
  const standing = useLinkStanding(mention, {
    taskId: holderTaskId(doors.holder),
    workspace: doors.place.workspace,
  });
  const known = standing?.pullRequest;
  const named =
    githubName(mention, standing) ?? writtenWords(target, words) ?? `#${pullRequest.number}`;
  const state = known === undefined ? undefined : pullRequestStateWord(known);
  return (
    <OneRowCard label={CARD_LABEL.PULL_REQUEST} kind={LONE_LINK.PULL_REQUEST}>
      <RowHintOptions
        card={
          <MentionChipCard
            mention={mention}
            target={target}
            name={named}
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
              <span className={PUBLISHED_META_CLASS}>
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
            event.stopPropagation();
            openLink(target);
          }}
          linkHref={target}
        />
      </RowHintOptions>
    </OneRowCard>
  );
}

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
  const place =
    "taskId" in page
      ? ({ kind: LINK_PLACE.PAGE, planId: page.taskId, pageId: page.pageId } as const)
      : ({ kind: LINK_PLACE.PAGE, agentId: page.agentId, pageId: page.pageId } as const);
  const { name } = placeChipLook(place, writtenWords(target, words), known);
  const glyph = <AppWindowIcon aria-hidden="true" />;
  const mention =
    "taskId" in page
      ? ({ kind: MENTION_KIND.PAGE, taskId: page.taskId, pageId: page.pageId } as const)
      : ({ kind: MENTION_KIND.PAGE, agentId: page.agentId, pageId: page.pageId } as const);
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
          linkHref={target}
        />
      </RowHintOptions>
    </OneRowCard>
  );
}

function PageCards({
  page,
  target,
  words,
  live,
}: {
  page: Extract<LoneLink, { kind: typeof LONE_LINK.PAGE }>;
  target: string;
  words: string;
  live: boolean;
}): React.JSX.Element {
  const read = readLink(target);
  const numbered = useNumberedTaskId(
    read?.workspace ?? "",
    read === undefined ? undefined : taskNumberOf(read.place),
  );
  const named = "taskId" in page && numbered !== undefined ? { ...page, taskId: numbered } : page;
  return (
    <>
      <PageRowCard page={named} target={target} words={words} />
      {live ? (
        <ShownNewestPage
          place={"taskId" in named ? { taskId: named.taskId } : { agentId: named.agentId }}
          pageId={named.pageId}
        />
      ) : null}
    </>
  );
}

export function LoneLinkCard({
  target,
  words,
  fallback,
}: {
  target: string;
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
        <PullRequestRowCard pullRequest={lone} mention={mention} target={target} words={words} />
      );
    }
    case LONE_LINK.PAGE:
      return <PageCards page={lone} target={target} words={words} live={doors !== undefined} />;
    case LONE_LINK.CODE: {
      if (doors === undefined) return fallback;
      const { repo, path, sha, startLine, endLine } = lone;
      const block = { type: INBOX_BLOCK.CODE, repo, path, sha, startLine, endLine };
      return (
        <div className="lone-link-card my-block-gap" data-lone-link={LONE_LINK.CODE}>
          <InboxCodeCard block={block} code={doors.code} />
        </div>
      );
    }
    case undefined:
      return fallback;
  }
}
