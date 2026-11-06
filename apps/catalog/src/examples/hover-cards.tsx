import { TASK_STATUS } from "@repo/features/task-wire";
import {
  AVATAR_SIZE,
  Avatar,
  BLOCKED_WORDS,
  BlockedMark,
  BUTTON_VARIANT,
  Button,
  DocumentIcon,
  FolderIcon,
  GAP,
  HOVER_CARD_ROW_LOOK,
  HoverCard,
  HoverCardFigures,
  HoverCardHead,
  HoverCardList,
  HoverCardNote,
  HoverCardRow,
  HoverCardRule,
  HoverCardScroll,
  HoverCardSkeleton,
  Inline,
  PinIcon,
  ProgressCount,
  TaskStatusMark,
  Tooltip,
  TooltipCard,
  UserIcon,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

const CATALOG_AGENTS = [
  "Billing after downgrade",
  "Rate limit search",
  "Fix Safari login",
  "Onboarding checklist",
  "Self-hosting guide",
  "Migrate auth SDK",
  "Old onboarding copy",
] as const;

const CATALOG_SUB_TASKS = [
  { name: "Write the invitation email", key: "ACME-43", status: TASK_STATUS.DONE },
  { name: "Expire invitations after a week", key: "ACME-44", status: TASK_STATUS.IN_PROGRESS },
  { name: "Let a sender send it again", key: "ACME-45", status: TASK_STATUS.TODO },
  { name: "Count accepted invitations", key: "ACME-46", status: TASK_STATUS.TODO },
  { name: "Document the invite API", key: "ACME-47", status: TASK_STATUS.BACKLOG },
] as const;

const CATALOG_TOOLS = [
  { title: "List issues", summary: "List the team's issues." },
  { title: "Read an issue", summary: "Read one issue." },
  { title: "Comment", summary: "Comment on an issue." },
] as const;

function withinBoth(x: number, y: number, one: DOMRect, other: DOMRect): boolean {
  return (
    x >= Math.min(one.left, other.left) &&
    x <= Math.max(one.right, other.right) &&
    y >= Math.min(one.top, other.top) &&
    y <= Math.max(one.bottom, other.bottom)
  );
}

function Carded({ label, card }: { label: string; card: ReactNode }): React.JSX.Element {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | undefined>(undefined);
  const hung = useRef<HTMLElement | null>(null);
  const show = (event: { currentTarget: HTMLElement }) => setAnchor(event.currentTarget);
  useEffect(() => {
    if (anchor === undefined) return;
    const holds = (node: EventTarget | null) =>
      node instanceof Node && (anchor.contains(node) || hung.current?.contains(node) === true);
    const follow = (event: PointerEvent) => {
      const at = hung.current?.getBoundingClientRect();
      if (at === undefined || holds(document.activeElement)) return;
      if (!withinBoth(event.clientX, event.clientY, anchor.getBoundingClientRect(), at))
        setAnchor(undefined);
    };
    const refocus = (event: FocusEvent) => {
      if (event.relatedTarget !== null && !holds(event.relatedTarget)) setAnchor(undefined);
    };
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAnchor(undefined);
    };
    document.addEventListener("pointermove", follow);
    document.addEventListener("focusout", refocus);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointermove", follow);
      document.removeEventListener("focusout", refocus);
      document.removeEventListener("keydown", dismiss);
    };
  }, [anchor]);
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the wrapper hears the pointer and the focus its button's own events bubble, because a shared button takes no handlers but its press. */}
      <span className="catalog-hinted" onPointerEnter={show} onFocus={show}>
        <Button
          variant={BUTTON_VARIANT.OUTLINE}
          aria-describedby={anchor === undefined ? undefined : id}
        >
          {label}
        </Button>
      </span>
      {anchor === undefined ? null : (
        <TooltipCard
          id={id}
          anchor={anchor}
          ref={(element) => {
            hung.current = element;
          }}
          onChoice={() => setAnchor(undefined)}
        >
          {card}
        </TooltipCard>
      )}
    </>
  );
}

function HoverCards(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="hover-card-heads" title="Heads">
        <Inline gap={GAP.CONTROL}>
          <Carded
            label="Task"
            card={
              <HoverCard>
                <HoverCardHead name="Teammate invitations" sub="acme/relay" corner="3h" />
                <HoverCardNote>
                  Expire an invitation after a week, and let its sender send it again.
                </HoverCardNote>
              </HoverCard>
            }
          />
          <Carded
            label="Skill"
            card={
              <HoverCard>
                <HoverCardHead glyph={<PinIcon />} name="/release" />
                <HoverCardNote>Cut a release.</HoverCardNote>
              </HoverCard>
            }
          />
          <Carded
            label="Long names"
            card={
              <HoverCard>
                <HoverCardHead
                  name="Move every scheduled automation onto the workspace's own timezone, and say which ones ran late"
                  corner="4m 12s"
                />
                <HoverCardHead
                  oneLine
                  name="A task standing in for a title, too long for its one line"
                  corner="12m"
                />
                <HoverCardNote oneLine>
                  Reading packages/service/src/maintenance/maintenance-sweep.ts and its tests
                </HoverCardNote>
                <HoverCardRow
                  look={HOVER_CARD_ROW_LOOK.DETAIL}
                  glyph={<FolderIcon />}
                  label="an-organization-with-a-long-name/a-repository-named-at-length"
                />
              </HoverCard>
            }
          />
        </Inline>
      </CatalogSection>
      <CatalogSection id="hover-card-reading" title="Reading">
        <Inline gap={GAP.CONTROL}>
          <Carded
            label="Skill, reading"
            card={<HoverCardSkeleton glyph={<PinIcon />} name="/release" />}
          />
          <Carded
            label="Skill"
            card={
              <HoverCard>
                <HoverCardHead glyph={<PinIcon />} name="/release" />
                <HoverCardNote>Cut a release.</HoverCardNote>
              </HoverCard>
            }
          />
          <Carded
            label="Agent, reading"
            card={
              <HoverCardSkeleton
                mark={<Avatar name="Prorate seat changes" size={AVATAR_SIZE.CARD} />}
                name="Prorate seat changes"
                sub
              />
            }
          />
          <Carded
            label="Agent"
            card={
              <HoverCard>
                <HoverCardHead
                  mark={<Avatar name="Prorate seat changes" size={AVATAR_SIZE.CARD} />}
                  name="Prorate seat changes"
                  sub="Opus 5.5"
                  corner="3m"
                />
                <HoverCardNote>Reading packages/billing/src/seats.ts</HoverCardNote>
              </HoverCard>
            }
          />
        </Inline>
      </CatalogSection>
      <CatalogSection id="hover-card-rows" title="Rows under a rule">
        <Inline gap={GAP.CONTROL}>
          <Carded
            label="Task, among others"
            card={
              <HoverCard>
                <HoverCardHead
                  glyph={<TaskStatusMark status={TASK_STATUS.IN_PROGRESS} />}
                  name="Invite flow"
                  sub="ACME-42 · acme/relay · 3h"
                />
                <HoverCardRule />
                <HoverCardRow
                  glyph={<TaskStatusMark status={TASK_STATUS.TODO} />}
                  label={
                    <>
                      <span className="text-muted-foreground">Part of </span>Ship invitations
                    </>
                  }
                  end="ACME-1"
                  onPress={() => undefined}
                />
                <HoverCardRow
                  glyph={<GLYPH.SUB_TASK />}
                  label="Sub-tasks"
                  end={<ProgressCount done={1} total={5} label="1 of 5 sub-tasks finished" />}
                />
                <HoverCardList label="Sub-tasks">
                  {CATALOG_SUB_TASKS.map((subTask) => (
                    <li key={subTask.key}>
                      <HoverCardRow
                        glyph={<TaskStatusMark status={subTask.status} />}
                        label={subTask.name}
                        end={subTask.key}
                        onPress={() => undefined}
                      />
                    </li>
                  ))}
                </HoverCardList>
                <HoverCardRow
                  look={HOVER_CARD_ROW_LOOK.DETAIL}
                  glyph={<BlockedMark aria-hidden="true" />}
                  label={BLOCKED_WORDS}
                />
              </HoverCard>
            }
          />
          <Carded
            label="Agents"
            card={
              <HoverCard>
                <HoverCardHead name="Teammate invitations" corner="2 working" />
                <HoverCardRow
                  look={HOVER_CARD_ROW_LOOK.DETAIL}
                  glyph={<FolderIcon />}
                  label="acme/relay"
                  onPress={() => undefined}
                />
                <HoverCardRow
                  look={HOVER_CARD_ROW_LOOK.DETAIL}
                  glyph={<UserIcon />}
                  label="Created by Sam Rivera · 3d ago"
                />
                <HoverCardRule />
                <HoverCardList label="Agents">
                  <li>
                    <HoverCardRow
                      glyph={<DocumentIcon />}
                      label="Invite flow"
                      onPress={() => undefined}
                    />
                  </li>
                  <li>
                    <HoverCardRow
                      glyph={<DocumentIcon />}
                      label="Expire every invitation a week after it was sent, and say so in the email"
                      end="+120 −14"
                      onPress={() => undefined}
                    />
                  </li>
                  {CATALOG_AGENTS.map((name) => (
                    <li key={name}>
                      <HoverCardRow
                        glyph={<DocumentIcon />}
                        label={name}
                        onPress={() => undefined}
                      />
                    </li>
                  ))}
                </HoverCardList>
              </HoverCard>
            }
          />
          <Carded
            label="Figures"
            card={
              <HoverCard>
                <HoverCardHead
                  name="Opus 5.5 High"
                  sub="Today, 9:34 – 9:43 PM · 9m 12s"
                  corner="Failed"
                />
                <HoverCardNote>Ran out of time.</HoverCardNote>
                <HoverCardRule />
                <HoverCardFigures
                  label="Tokens"
                  figures={[
                    { label: "Input", figure: "12,408" },
                    { label: "Output", figure: "3,921" },
                    { label: "Cache read", figure: "184,233" },
                    { label: "Cache write", figure: "9,870" },
                  ]}
                />
              </HoverCard>
            }
          />
          <Carded
            label="Tools"
            card={
              <HoverCard>
                <HoverCardHead glyph={<PinIcon />} name="Linear" sub="3 tools" />
                <HoverCardRule />
                <HoverCardList label="Linear tools">
                  {CATALOG_TOOLS.map(({ title, summary }) => (
                    <li key={title}>
                      <Tooltip
                        label={title}
                        card={
                          <HoverCard>
                            <HoverCardHead name={title} />
                            <HoverCardNote>{summary}</HoverCardNote>
                          </HoverCard>
                        }
                      >
                        <HoverCardRow glyph={null} label={title} />
                      </Tooltip>
                    </li>
                  ))}
                </HoverCardList>
              </HoverCard>
            }
          />
          <Carded
            label="Long body"
            card={
              <HoverCard>
                <HoverCardHead glyph={<PinIcon />} name="Linear" sub="7 tools" />
                <HoverCardRule />
                <HoverCardScroll>
                  {CATALOG_AGENTS.map((name) => (
                    <HoverCardRow key={name} glyph={<DocumentIcon />} label={name} />
                  ))}
                </HoverCardScroll>
              </HoverCard>
            }
          />
        </Inline>
      </CatalogSection>
    </>
  );
}

export const HOVER_CARDS_EXAMPLE: Example = {
  id: "hover-cards",
  title: "Hover cards",
  Render: HoverCards,
};
