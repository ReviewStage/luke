import {
  DocumentIcon,
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  INLINE_REF_LOOK,
  INLINE_REF_NAME,
  InlineRef,
  SubjectLine,
  Text,
  UserIcon,
} from "@repo/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

const TASK_CARD = (
  <HoverCard>
    <HoverCardHead glyph={<DocumentIcon />} name="Teammate invitations" sub="acme/relay" />
    <HoverCardNote>
      Expire an invitation after a week, and let its sender send it again.
    </HoverCardNote>
  </HoverCard>
);

function press(): void {}

function InlineRefs(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="inline-ref-link" title="Link">
        <Text>
          Opened{" "}
          <InlineRef
            look={INLINE_REF_LOOK.LINK}
            glyph={<DocumentIcon />}
            label="packages/service/src/maintenance/maintenance-sweep.ts"
            name={INLINE_REF_NAME.PATH}
            state="12–40"
            onPress={press}
          />{" "}
          and{" "}
          <InlineRef
            look={INLINE_REF_LOOK.LINK}
            glyph={<DocumentIcon />}
            label="Teammate invitations"
            card={TASK_CARD}
          />{" "}
          beside it.
        </Text>
      </CatalogSection>
      <CatalogSection id="inline-ref-wash" title="Wash">
        <Text>
          Edited by{" "}
          <InlineRef
            look={INLINE_REF_LOOK.WASH}
            glyph={<UserIcon />}
            label="Charles Pan"
            onPress={press}
          />{" "}
          on{" "}
          <InlineRef
            look={INLINE_REF_LOOK.WASH}
            glyph={<UserIcon />}
            label="Lee Park"
            heard=" (former member)"
          />
          ’s call.
        </Text>
      </CatalogSection>
      <CatalogSection id="inline-ref-pill" title="Pill">
        <Text>
          See{" "}
          <InlineRef
            look={INLINE_REF_LOOK.PILL}
            glyph={<DocumentIcon />}
            label="Teammate invitations"
            onPress={press}
            card={TASK_CARD}
          />
          , its issue{" "}
          <InlineRef
            look={INLINE_REF_LOOK.PILL}
            glyph={<DocumentIcon />}
            kind="issue"
            label="Invitations expire too soon"
            state="In progress"
            onPress={press}
            linkHref="https://linear.app/acme/issue/REL-42"
            leaves
          />
          , and the section{" "}
          <InlineRef
            look={INLINE_REF_LOOK.PILL}
            glyph={<DocumentIcon />}
            kind="section"
            label="Old rollout"
            gone
            onPress={press}
          />{" "}
          it no longer holds, or the skill{" "}
          <InlineRef look={INLINE_REF_LOOK.PILL} kind="skill" label="/release" onPress={press} />.
        </Text>
      </CatalogSection>
      <CatalogSection id="inline-ref-narrow" title="Long names in a narrow column">
        <div className="catalog-column">
          <Text>
            <InlineRef
              look={INLINE_REF_LOOK.PILL}
              glyph={<DocumentIcon />}
              label="Move every scheduled automation onto the workspace's own timezone"
              onPress={press}
            />{" "}
            and{" "}
            <InlineRef
              look={INLINE_REF_LOOK.LINK}
              glyph={<DocumentIcon />}
              label="apps/desktop/src/renderer/tasks/a-very-long-folder-name/inline-ref.tsx"
              name={INLINE_REF_NAME.PATH}
              state="4–9"
              onPress={press}
            />
          </Text>
        </div>
      </CatalogSection>
      <CatalogSection id="inline-ref-subject" title="The subject of a line">
        <div className="catalog-column">
          <SubjectLine lead="Thread answer">
            <InlineRef
              look={INLINE_REF_LOOK.PILL}
              glyph={<DocumentIcon />}
              label="Expire an invitation after a week?"
              onPress={press}
            />
          </SubjectLine>
          <SubjectLine lead="Thread message">
            <InlineRef
              look={INLINE_REF_LOOK.PILL}
              glyph={<DocumentIcon />}
              label="Move every scheduled automation onto the workspace's own timezone"
              onPress={press}
            />
          </SubjectLine>
        </div>
      </CatalogSection>
    </>
  );
}

export const INLINE_REFS_EXAMPLE: Example = {
  id: "inline-refs",
  title: "Inline references",
  Render: InlineRefs,
};
