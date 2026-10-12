// rule-commands.ts -- SPIKE: the keys a rule's editor walks its statement and examples with, shared by the ProseMirror and TipTap prototypes.

import { type Command, Selection, TextSelection } from "prosemirror-state";

/**
 * Enter in a rule walks its parts as a form would: the statement to the
 * first example's Given (adding an example where there is none), each
 * clause to the next, and Then to a new example after its own.
 */
export const ruleEnter: Command = (state, dispatch) => {
  const { $from } = state.selection;
  const name = $from.parent.type.name;
  const schema = state.schema;
  const exampleType = schema.nodes.example;
  if (exampleType === undefined) return false;
  const emptyExample = () => exampleType.createAndFill();
  if (name === "statement") {
    const examplesPos = $from.after(1);
    const examples = state.doc.child(1);
    let tr = state.tr;
    if (examples.childCount === 0) {
      const created = emptyExample();
      if (created === null) return false;
      tr = tr.insert(examplesPos + 1, created);
    }
    // Inside examples (+1), inside the first example (+1), inside Given (+1).
    tr = tr.setSelection(TextSelection.create(tr.doc, examplesPos + 3));
    dispatch?.(tr.scrollIntoView());
    return true;
  }
  if (name === "given" || name === "when") {
    const next = $from.after() + 1;
    dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, next)).scrollIntoView());
    return true;
  }
  if (name === "then") {
    const after = $from.after(2);
    const created = emptyExample();
    if (created === null) return false;
    const tr = state.tr.insert(after, created);
    dispatch?.(tr.setSelection(TextSelection.create(tr.doc, after + 2)).scrollIntoView());
    return true;
  }
  return false;
};

/** Backspace at the start of an example whose clauses are all empty strikes it. */
export const ruleBackspace: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset !== 0 || $from.depth < 3) return false;
  const example = $from.node(2);
  if (example.type.name !== "example" || example.textContent !== "") return false;
  const start = $from.before(2);
  const tr = state.tr.delete(start, start + example.nodeSize);
  dispatch?.(tr.setSelection(Selection.near(tr.doc.resolve(Math.max(1, start - 1)), -1)));
  return true;
};
