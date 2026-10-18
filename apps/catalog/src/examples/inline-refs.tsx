import {
  DocumentIcon,
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  INLINE_REF_LOOK,
  INLINE_REF_NAME,
  InlineRef,
  type InlineRefHint,
  Text,
  TooltipCard,
  TooltipPill,
  UserIcon,
} from "@luke/ui";
import { cloneElement, useId, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * inline-refs.tsx -- things named in a line of words: a link's words, a
 * byline's wash, and a mention's pill, each pressable and not; a pill
 * saying where its subject stands, one whose subject is gone, a path cut
 * at its start, and long names in a narrow column. Each hangs its card, or
 * its name in a pill, while the pointer rests on it or the keyboard
 * reaches it: the catalog's own stand-in for the timing an app gives its
 * hints.
 */

/** The catalog's hint: the card where the token hands one, else a pill naming it, while the pointer or the keyboard is on it. */
const Hint: InlineRefHint = ({ label, card, children }) => {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | undefined>(undefined);
  const show = (event: { currentTarget: HTMLElement }) => setAnchor(event.currentTarget);
  const hide = () => setAnchor(undefined);
  const hint =
    anchor === undefined ? null : card === undefined ? (
      <TooltipPill id={id} anchor={anchor} instant={false} label={label} />
    ) : (
      <TooltipCard id={id} anchor={anchor} instant={false}>
        {card}
      </TooltipCard>
    );
  return (
    <>
      {cloneElement(children, {
        "aria-describedby": anchor === undefined ? undefined : id,
        onPointerEnter: show,
        onPointerLeave: hide,
        onFocus: show,
        onBlur: hide,
      })}
      {hint}
    </>
  );
};

const PLAN_CARD = (
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
            hint={Hint}
          />{" "}
          and{" "}
          <InlineRef
            look={INLINE_REF_LOOK.LINK}
            glyph={<DocumentIcon />}
            label="Teammate invitations"
            hint={Hint}
            card={PLAN_CARD}
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
            hint={Hint}
          />{" "}
          on{" "}
          <InlineRef
            look={INLINE_REF_LOOK.WASH}
            glyph={<UserIcon />}
            label="Lee Park"
            heard=" (former member)"
            hint={Hint}
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
            hint={Hint}
            card={PLAN_CARD}
          />
          , its issue{" "}
          <InlineRef
            look={INLINE_REF_LOOK.PILL}
            glyph={<DocumentIcon />}
            label="Invitations expire too soon"
            state="In progress"
            onPress={press}
            hint={Hint}
          />
          , and the section{" "}
          <InlineRef
            look={INLINE_REF_LOOK.PILL}
            glyph={<DocumentIcon />}
            label="Old rollout"
            gone
            onPress={press}
            hint={Hint}
          />{" "}
          it no longer holds, or the skill{" "}
          <InlineRef look={INLINE_REF_LOOK.PILL} label="/release" onPress={press} hint={Hint} />.
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
              hint={Hint}
            />{" "}
            and{" "}
            <InlineRef
              look={INLINE_REF_LOOK.LINK}
              glyph={<DocumentIcon />}
              label="apps/desktop/src/renderer/tasks/a-very-long-folder-name/inline-ref.tsx"
              name={INLINE_REF_NAME.PATH}
              state="4–9"
              onPress={press}
              hint={Hint}
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
