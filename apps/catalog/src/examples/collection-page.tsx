import {
  BUTTON_VARIANT,
  Button,
  COLLECTION_STATE,
  CollectionPage,
  type CollectionState,
  EllipsisIcon,
  IconButton,
  LIST_ROW_CURRENT,
  List,
  ListRow,
  PAGE_FRAME,
  PAGE_WIDTH,
  PlusIcon,
  Segmented,
  TextField,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * collection-page.tsx -- a collection's page in each state its content
 * takes, switched in place so the header and filters can be seen to stand
 * still, and the same page in a phone's width; the page under a window's
 * toolbar, which holds its title and acts, and a board under it standing
 * across the room and scrolling sideways. The empty and failed states
 * here are plain words, standing in for the shared EmptyState and
 * ErrorState. Every name is made up.
 */

const TASKS = [
  { id: "launch", name: "Launch checklist", detail: "Edited by Ada Lovelace", when: "2h ago" },
  { id: "billing", name: "Billing migration", detail: "Edited by Grace Hopper", when: "Yesterday" },
  {
    id: "platform",
    name: "Migrate the acme-corporation-engineering-platform workspace onto the new runners",
    detail: "Edited by someone with a very long name indeed",
    when: "3d",
  },
  { id: "hiring", name: "Hiring loop", detail: "Edited by Alan Turing", when: "Last week" },
] as const;

const SCOPES = [
  { value: "all", label: "All" },
  { value: "mine", label: "Mine" },
  { value: "archived", label: "Archived" },
] as const;

const STAGES = ["Todo", "In progress", "In review", "Done"] as const;

type Scope = (typeof SCOPES)[number]["value"];

const STATES = Object.values(COLLECTION_STATE).map((state) => ({ value: state, label: state }));

function Tasks({ state }: { state: CollectionState }): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [open, setOpen] = useState<string>("billing");
  return (
    <CollectionPage
      title="Tasks"
      description="Everything planned in this workspace."
      actions={
        <Button variant={BUTTON_VARIANT.PRIMARY} icon={<PlusIcon />}>
          New task
        </Button>
      }
      filters={
        <>
          <TextField label="Search tasks" placeholder="Search" value={query} onChange={setQuery} />
          <Segmented<Scope> legend="Show" options={SCOPES} value={scope} onChange={setScope} />
        </>
      }
      state={state}
      loadingLabel="Reading tasks"
      empty={<p>No tasks yet. Start one by talking it through.</p>}
      error={<p role="alert">Tasks could not be read. Try again in a moment.</p>}
    >
      <List label="Tasks">
        {TASKS.map((task) => (
          <ListRow
            key={task.id}
            title={task.name}
            description={task.detail}
            meta={task.when}
            current={open === task.id ? LIST_ROW_CURRENT.ITEM : undefined}
            onPress={() => setOpen(task.id)}
            actions={<IconButton icon={<EllipsisIcon />} label={`More for ${task.name}`} />}
          />
        ))}
      </List>
    </CollectionPage>
  );
}

/** The window's toolbar over the tasks, holding their title and the act to make one. */
function Toolbar(): React.JSX.Element {
  return (
    <header className="catalog-window-toolbar">
      <h1 className="catalog-window-toolbar-title">Tasks</h1>
      <Button variant={BUTTON_VARIANT.OUTLINE} icon={<PlusIcon />}>
        New task
      </Button>
    </header>
  );
}

function TasksUnderToolbar({ state }: { state: CollectionState }): React.JSX.Element {
  const [query, setQuery] = useState("");
  return (
    <CollectionPage
      frame={PAGE_FRAME.TOOLBAR}
      label="Tasks"
      toolbar={<Toolbar />}
      filters={
        <TextField label="Search tasks" placeholder="Search" value={query} onChange={setQuery} />
      }
      state={state}
      loadingLabel="Reading tasks"
      empty={<p>No tasks yet. Start one by talking it through.</p>}
      error={<p role="alert">Tasks could not be read. Try again in a moment.</p>}
    >
      <List label="Tasks">
        {TASKS.map((task) => (
          <ListRow
            key={task.id}
            title={task.name}
            description={task.detail}
            meta={task.when}
            onPress={() => undefined}
          />
        ))}
      </List>
    </CollectionPage>
  );
}

/** The tasks as a board under the toolbar, its columns across the room. */
function Board(): React.JSX.Element {
  return (
    <CollectionPage
      frame={PAGE_FRAME.TOOLBAR}
      width={PAGE_WIDTH.FULL}
      label="Tasks"
      toolbar={<Toolbar />}
      state={COLLECTION_STATE.READY}
      loadingLabel="Reading tasks"
    >
      <div className="catalog-board">
        {STAGES.map((stage, column) => (
          <div key={stage} className="catalog-board-column">
            <List label={stage}>
              <ListRow title={stage} description={TASKS[column]?.name} onPress={() => undefined} />
            </List>
          </div>
        ))}
      </div>
    </CollectionPage>
  );
}

function SwitchedUnderToolbar(): React.JSX.Element {
  const [state, setState] = useState<CollectionState>(COLLECTION_STATE.READY);
  return (
    <div className="catalog-stack">
      <Segmented<CollectionState>
        legend="Content state"
        options={STATES}
        value={state}
        onChange={setState}
      />
      <div className="catalog-screen catalog-screen-collection">
        <TasksUnderToolbar state={state} />
      </div>
    </div>
  );
}

function Switched(): React.JSX.Element {
  const [state, setState] = useState<CollectionState>(COLLECTION_STATE.READY);
  return (
    <div className="catalog-stack">
      <Segmented<CollectionState>
        legend="Content state"
        options={STATES}
        value={state}
        onChange={setState}
      />
      <div className="catalog-screen catalog-screen-collection">
        <Tasks state={state} />
      </div>
    </div>
  );
}

function CollectionPages(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="collection-page-states" title="Each content state, in place">
        <Switched />
      </CatalogSection>
      <CatalogSection id="collection-page-phone" title="A phone's width, loading and ready">
        <div className="catalog-screens">
          <div className="catalog-screen catalog-screen-phone catalog-screen-collection">
            <Tasks state={COLLECTION_STATE.LOADING} />
          </div>
          <div className="catalog-screen catalog-screen-phone catalog-screen-collection">
            <Tasks state={COLLECTION_STATE.READY} />
          </div>
        </div>
      </CatalogSection>
      <CatalogSection id="collection-page-toolbar" title="Under the window's toolbar">
        <SwitchedUnderToolbar />
      </CatalogSection>
      <CatalogSection
        id="collection-page-board"
        title="A board across the room, scrolling sideways"
      >
        <div className="catalog-screens">
          <div className="catalog-screen catalog-screen-collection">
            <Board />
          </div>
          <div className="catalog-screen catalog-screen-phone catalog-screen-collection">
            <Board />
          </div>
        </div>
      </CatalogSection>
    </>
  );
}

export const COLLECTION_PAGE_EXAMPLE: Example = {
  id: "collection-page",
  title: "Collection page",
  Render: CollectionPages,
};
