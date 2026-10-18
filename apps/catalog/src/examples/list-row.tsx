import {
  EllipsisIcon,
  IconButton,
  LIST_DENSITY,
  LIST_VARIANT,
  List,
  ListRow,
  PencilIcon,
  Switch,
  TrashIcon,
  UserIcon,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * list-row.tsx -- a list's rows with their metadata and acts lined up, the
 * one open now, rows that open nothing, rows in a card and compact, and long
 * words in a narrow column.
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

const AUTOMATIONS = [
  { id: "sweep", name: "Nightly sweep", trigger: "Every day at 09:00", next: "Tomorrow" },
  { id: "review", name: "Code review", trigger: "When a pull request is opened", next: "On event" },
] as const;

/** Rows edge to edge in a card, each with a switch beside its press. */
function Automations(): React.JSX.Element {
  const [on, setOn] = useState<Record<string, boolean>>({ sweep: true, review: false });
  return (
    <List label="Automations" variant={LIST_VARIANT.CARD}>
      {AUTOMATIONS.map((automation) => (
        <ListRow
          key={automation.id}
          title={automation.name}
          description={automation.trigger}
          meta={on[automation.id] === true ? automation.next : "Off"}
          onPress={() => undefined}
          actions={
            <Switch
              checked={on[automation.id] === true}
              label={`Turn on ${automation.name}`}
              onChange={(checked) => setOn((all) => ({ ...all, [automation.id]: checked }))}
            />
          }
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
      <CatalogSection id="list-row-card" title="Rows in a card">
        <div className="catalog-column">
          <Automations />
        </div>
      </CatalogSection>
      <CatalogSection id="list-row-compact" title="Compact rows">
        <div className="catalog-narrow">
          <List label="Runs" density={LIST_DENSITY.COMPACT}>
            <ListRow title="Fix the flaky test" description="Working" meta="2m" current />
            <ListRow
              title="Scheduled run"
              description="Finished"
              meta="1d"
              onPress={() => undefined}
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
