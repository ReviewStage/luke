import { EllipsisIcon, IconButton, List, ListRow, PencilIcon, TrashIcon, UserIcon } from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * list-row.tsx -- a list's rows with their metadata and acts lined up, the
 * one open now, rows that open nothing, and long words in a narrow column.
 */

const MEMBERS = [
  { id: "ada", name: "Ada Lovelace", email: "ada@example.com", role: "Owner" },
  { id: "grace", name: "Grace Hopper", email: "grace@example.com", role: "Admin" },
  { id: "alan", name: "Alan Turing", email: "alan@example.com", role: "Member" },
] as const;

function Members(): React.JSX.Element {
  const [open, setOpen] = useState<string>("grace");
  return (
    <List label="Members">
      {MEMBERS.map((member) => (
        <ListRow
          key={member.id}
          leading={<UserIcon />}
          title={member.name}
          description={member.email}
          meta={member.role}
          current={open === member.id}
          onPress={() => setOpen(member.id)}
          actions={<IconButton icon={<EllipsisIcon />} label={`More for ${member.name}`} />}
        />
      ))}
    </List>
  );
}

function ListRows(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="list-row-rows" title="Rows that open, with their acts">
        <div className="catalog-column">
          <Members />
        </div>
      </CatalogSection>
      <CatalogSection id="list-row-static" title="Rows that open nothing">
        <div className="catalog-column">
          <List label="Recent runs">
            <ListRow title="Nightly review" meta="2h ago" />
            <ListRow
              title="Release notes"
              description="Finished without changes"
              meta="Yesterday"
            />
          </List>
        </div>
      </CatalogSection>
      <CatalogSection id="list-row-narrow" title="Long words in a narrow column">
        <div className="catalog-narrow">
          <List label="Plans">
            <ListRow
              title="Migrate the acme-corporation-engineering-platform workspace"
              description="Last edited by someone with a very long name indeed"
              meta="3d"
              onPress={() => undefined}
              actions={
                <>
                  <IconButton icon={<PencilIcon />} label="Rename" />
                  <IconButton icon={<TrashIcon />} label="Delete" />
                </>
              }
            />
          </List>
        </div>
      </CatalogSection>
    </>
  );
}

export const LIST_ROW_EXAMPLE: Example = {
  id: "list-row",
  title: "List rows",
  Render: ListRows,
};
