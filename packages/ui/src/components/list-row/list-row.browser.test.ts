import { createElement, useState } from "react";
import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { PROFILE, surfaceAttributes, THEME } from "../../tokens/surface.js";
import { IconButton } from "../button/button.js";
import { List, ListRow } from "./list-row.js";

/**
 * list-row.browser.test.ts -- a row's press and its acts are sibling
 * controls, never one inside the other: each is reached by Tab in turn and
 * pressed alone. A row is named by its words, title first, the one open is announced as current, a row that opens nothing is no control,
 * and a column of rows lines its metadata and its acts up on each row's
 * middle, a long title giving way rather than pushing them out.
 */

const MEMBERS = [
  { id: "ada", name: "Ada Lovelace", role: "Owner" },
  { id: "grace", name: "Grace Hopper with a name long enough to run past the row", role: "Admin" },
] as const;

/** Members whose rows open one and whose ⋯ is pressed, what was pressed listed after them. */
function Members(): React.JSX.Element {
  const [open, setOpen] = useState<string | undefined>(undefined);
  const [heard, setHeard] = useState<string[]>([]);
  return createElement(
    "div",
    { style: { width: "320px" } },
    createElement(List, {
      label: "Members",
      children: MEMBERS.map((member) =>
        createElement(ListRow, {
          key: member.id,
          leading: createElement("svg", { width: 16, height: 16 }),
          title: member.name,
          description: `${member.id}@example.com`,
          meta: member.role,
          current: open === member.id,
          onPress: () => {
            setOpen(member.id);
            setHeard((all) => [...all, `open ${member.id}`]);
          },
          actions: createElement(IconButton, {
            icon: createElement("svg", { width: 16, height: 16 }),
            label: `More for ${member.id}`,
            onClick: () => setHeard((all) => [...all, `more ${member.id}`]),
          }),
        }),
      ),
    }),
    createElement("output", null, heard.join(",")),
  );
}

function heard(): string | null | undefined {
  return document.querySelector("output")?.textContent;
}

test("a row's press and its acts are sibling controls in its item, never nested", async () => {
  const { container } = await mount(createElement(Members));
  const buttons = [...container.querySelectorAll("button")];
  expect(buttons.length).toBe(4);
  for (const button of buttons) {
    expect(button.parentElement?.closest("button")).toBeNull();
  }
  const row = page.getByRole("button", { name: "Ada Lovelace ada@example.com Owner" }).element();
  const more = page.getByRole("button", { name: "More for ada" }).element();
  expect(row.closest("li")).toBe(more.closest("li"));
  expect(await accessibilityViolations(container)).toEqual([]);
});

test("pressing an act does not press its row, and Tab reaches the row, then its acts", async () => {
  await mount(createElement(Members));
  await page.getByRole("button", { name: "More for ada" }).click();
  expect(heard()).toBe("more ada");
  await page.getByRole("button", { name: "Ada Lovelace ada@example.com Owner" }).click();
  await userEvent.keyboard("{Tab}");
  await expect.element(page.getByRole("button", { name: "More for ada" })).toHaveFocus();
  await userEvent.keyboard("{Tab}");
  const next = page.getByRole("button", { name: /^Grace Hopper/ });
  await expect.element(next).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(heard()).toBe("more ada,open ada,open grace");
});

test("a row is named by its words, title first, and the open one is announced as current", async () => {
  await mount(createElement(Members));
  const row = page.getByRole("button", { name: "Ada Lovelace ada@example.com Owner" });
  await expect.element(row).not.toHaveAttribute("aria-current");
  await row.click();
  await expect.element(row).toHaveAttribute("aria-current", "true");
  await expect.element(page.getByRole("list", { name: "Members" })).toBeInTheDocument();
});

test("a row that opens nothing is no control, its acts still are", async () => {
  const { container } = await mount(
    createElement(List, {
      label: "Runs",
      children: createElement(ListRow, {
        title: "Nightly review",
        meta: "2h ago",
        actions: createElement(IconButton, {
          icon: createElement("svg", { width: 16, height: 16 }),
          label: "Run again",
        }),
      }),
    }),
  );
  expect(page.getByRole("button").all().length).toBe(1);
  await expect.element(page.getByRole("button", { name: "Run again" })).toBeInTheDocument();
  await expect.element(page.getByRole("listitem")).toHaveTextContent("Nightly review2h ago");
  expect(await accessibilityViolations(container)).toEqual([]);
});

for (const profile of Object.values(PROFILE)) {
  test(`on the ${profile} profile, metadata and acts sit on each row's middle and inside it`, async () => {
    await mount(createElement(Members), surfaceAttributes(profile, THEME.LIGHT));
    const metas: DOMRect[] = [];
    const acts: DOMRect[] = [];
    for (const member of MEMBERS) {
      const metaBox = page.getByText(member.role).element().getBoundingClientRect();
      const act = page.getByRole("button", { name: `More for ${member.id}` }).element();
      const actBox = act.getBoundingClientRect();
      const row = act.closest("li")?.getBoundingClientRect() ?? new DOMRect();
      const middle = row.top + row.height / 2;
      expect(Math.abs(metaBox.top + metaBox.height / 2 - middle)).toBeLessThanOrEqual(1);
      expect(Math.abs(actBox.top + actBox.height / 2 - middle)).toBeLessThanOrEqual(1);
      expect(metaBox.right).toBeLessThanOrEqual(actBox.left);
      expect(actBox.right).toBeLessThanOrEqual(row.right);
      metas.push(metaBox);
      acts.push(actBox);
    }
    expect(metas.map((box) => box.right)).toEqual(metas.map(() => metas[0]?.right));
    expect(acts.map((box) => box.left)).toEqual(acts.map(() => acts[0]?.left));
  });
}

test("a row that opens nothing is still announced as current", async () => {
  const { container } = await mount(
    createElement(List, {
      label: "Runs",
      children: createElement(ListRow, { title: "Running review", current: true }),
    }),
  );
  const row = page.getByText("Running review").element().closest("[aria-current]");
  expect(row?.getAttribute("aria-current")).toBe("true");
  expect(await accessibilityViolations(container)).toEqual([]);
});
