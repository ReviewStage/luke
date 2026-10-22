import {
  DocumentIcon,
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  INLINE_REF_LOOK,
  INLINE_REF_NAME,
  InlineRef,
  Text,
  UserIcon,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * inline-refs.tsx -- things named in a line of words: a link's words, a
 * byline's wash, and a mention's pill, each pressable and not; a pill
 * saying where its subject stands, one whose subject is gone, a path cut
 * at its start, and long names in a narrow column. Each hangs its card, or
 * its name in a pill, in the window's tooltip, once the pointer rests on
 * it or the keyboard reaches it.
 */

const TASK_CARD = (
  <HoverCard>
    <HoverCardHead glyph={<DocumentIcon />} name="Teammate invitations" sub="acme/relay" />
    <HoverCardNote>
      Expire an invitation after a week, and let its sender send it again.
    </HoverCardNote>
  </HoverCard>
);

/** Nothing happens on a press: the catalog opens nowhere. */
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
            label="Invitations expire too soon"
            state="In progress"
            onPress={press}
          />
          , and the section{" "}
          <InlineRef
            look={INLINE_REF_LOOK.PILL}
            glyph={<DocumentIcon />}
            label="Old rollout"
            gone
            onPress={press}
          />{" "}
          it no longer holds, or the skill{" "}
          <InlineRef look={INLINE_REF_LOOK.PILL} label="/release" onPress={press} />.
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
    </>
  );
}

export const INLINE_REFS_EXAMPLE: Example = {
  id: "inline-refs",
  title: "Inline references",
  Render: InlineRefs,
};
