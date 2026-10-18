import {
  BUTTON_VARIANT,
  Button,
  INLINE_EDIT_LOOK,
  InlineEdit,
  type InlineEditLook,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * inline-edits.tsx -- an InlineEdit showing a name and renaming it in
 * place, as a field on its own ground, as a settings input, and bare in a
 * well that rings it, and
 * a long name in a narrow column.
 */

/** A name the example renames in place, as a list renames a row. */
function Renamed({ start, look }: { start: string; look: InlineEditLook }): React.JSX.Element {
  const [name, setName] = useState(start);
  const [editing, setEditing] = useState(false);
  const edit = (
    <InlineEdit
      value={name}
      label="Task name"
      editing={editing}
      maxLength={120}
      look={look}
      onEnd={({ value }) => {
        setEditing(false);
        if (value !== undefined) setName(value);
      }}
    />
  );
  return (
    <div className="catalog-inline-edit">
      {look === INLINE_EDIT_LOOK.WELL && editing ? (
        <span className="catalog-inline-edit-well">{edit}</span>
      ) : (
        edit
      )}
      {editing ? null : (
        <Button variant={BUTTON_VARIANT.QUIET} onClick={() => setEditing(true)}>
          Rename
        </Button>
      )}
    </div>
  );
}

function InlineEdits(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="inline-edit-field" title="As a field">
        <div className="catalog-column">
          <Renamed start="Ship the beta" look={INLINE_EDIT_LOOK.FIELD} />
        </div>
      </CatalogSection>
      <CatalogSection id="inline-edit-input" title="As an input">
        <div className="catalog-column">
          <Renamed start="Acme" look={INLINE_EDIT_LOOK.INPUT} />
        </div>
      </CatalogSection>
      <CatalogSection id="inline-edit-well" title="In a well">
        <Renamed start="Review the launch plan" look={INLINE_EDIT_LOOK.WELL} />
      </CatalogSection>
      <CatalogSection id="inline-edit-narrow" title="Narrow column, long name">
        <div className="catalog-narrow">
          <Renamed
            start="A plan whose name runs well past its column"
            look={INLINE_EDIT_LOOK.FIELD}
          />
        </div>
      </CatalogSection>
    </>
  );
}

export const INLINE_EDITS_EXAMPLE: Example = {
  id: "inline-edits",
  title: "Inline edits",
  Render: InlineEdits,
};
