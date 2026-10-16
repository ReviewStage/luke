import { createElement, useState } from "react";
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { PROFILE, surfaceAttributes, THEME } from "../../tokens/surface.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { FormField } from "../form-field/form-field.js";
import { TEXT_FIELD_TYPE, TextField } from "../text-field/text-field.js";
import { AUTH_STATUS_TONE, AuthPage } from "./auth-page.js";

/**
 * auth-page.browser.test.ts -- the page is one main region holding one card
 * named by its title, its artwork hidden from a reader; what went wrong is
 * announced from a region that stood before it arrived; and on a phone's
 * width the provider choices and a form's fields fit the screen, each as
 * wide as the card's inside, with nothing scrolling sideways.
 */

const WEB_DARK = surfaceAttributes(PROFILE.WEB, THEME.DARK);

/** A sign-in page whose provider choice fails to start when pressed. */
function SignIn(): React.JSX.Element {
  const [failure, setFailure] = useState<string | undefined>(undefined);
  return createElement(AuthPage, {
    mark: createElement("svg", { width: 52, height: 52 }),
    title: "Sign in to Luke",
    error: failure,
    footnote: "You can close this window after Luke confirms the sign-in.",
    children: createElement(Button, {
      variant: BUTTON_VARIANT.OUTLINE,
      onClick: () => setFailure("Sign-in could not start."),
      children: "Continue with GitHub",
    }),
  });
}

/** A card holding two provider choices and a field whose words run long. */
function NarrowChoices(): React.JSX.Element {
  const [email, setEmail] = useState("someone-with-a-long-address@a-long-domain.example");
  return createElement(
    AuthPage,
    {
      status: { tone: AUTH_STATUS_TONE.ATTENTION, label: "Not completed" },
      title: "Sign in to the workspace acme-corporation-engineering-platform",
      description: "Choose the provider your workspace administrator connected to Luke.",
      error: "The provider refused the request from acme-corporation-engineering-platform.",
    },
    createElement(Button, {
      variant: BUTTON_VARIANT.OUTLINE,
      children: "Continue with Google Workspace",
    }),
    createElement(Button, { variant: BUTTON_VARIANT.OUTLINE, children: "Continue with GitHub" }),
    createElement(FormField, {
      label: "Work email",
      children: (control) =>
        createElement(TextField, {
          field: control,
          type: TEXT_FIELD_TYPE.EMAIL,
          value: email,
          onChange: setEmail,
        }),
    }),
  );
}

test("the card is a region named by its title in the page's main landmark, its artwork hidden", async () => {
  const { container } = await mount(createElement(SignIn), WEB_DARK);
  const card = page.getByRole("main").getByRole("region", { name: "Sign in to Luke" });
  await expect.element(card).toBeInTheDocument();
  await expect
    .element(page.getByRole("heading", { level: 1, name: "Sign in to Luke" }))
    .toBeInTheDocument();
  expect(container.querySelector("svg")?.closest('[aria-hidden="true"]')).not.toBeNull();
  expect(await accessibilityViolations(container)).toEqual([]);
});

test("what went wrong is announced from an alert region that stood empty before it", async () => {
  const { container } = await mount(createElement(SignIn), WEB_DARK);
  const alert = page.getByRole("alert");
  await expect.element(alert).toBeInTheDocument();
  const region = alert.element();
  expect(region.textContent).toBe("");
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
  await expect.element(alert).toHaveTextContent("Sign-in could not start.");
  expect(page.getByRole("alert").element()).toBe(region);
  expect(await accessibilityViolations(container)).toEqual([]);
});

test("on a phone's width every choice and field fits the screen, each as wide as the others", async () => {
  await page.viewport(320, 640);
  try {
    const { container } = await mount(createElement(NarrowChoices), WEB_DARK);
    const card = page.getByRole("region").element().getBoundingClientRect();
    const boxes = [
      page.getByRole("button", { name: "Continue with Google Workspace" }),
      page.getByRole("button", { name: "Continue with GitHub" }),
      page.getByRole("textbox", { name: "Work email" }),
    ].map((choice) => choice.element().getBoundingClientRect());
    for (const box of boxes) {
      expect(box.left).toBeGreaterThan(card.left);
      expect(box.right).toBeLessThan(card.right);
      expect([box.left, box.right]).toEqual([boxes[0]?.left, boxes[0]?.right]);
    }
    expect(card.right).toBeLessThanOrEqual(320);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
    expect(await accessibilityViolations(container)).toEqual([]);
  } finally {
    await page.viewport(1280, 840);
  }
});

test("a page with nothing to say past its title draws its title alone", async () => {
  await mount(createElement(AuthPage, { title: "Continuing to Luke…", description: "" }));
  const card = page.getByRole("region", { name: "Continuing to Luke…" }).element();
  expect(card.textContent).toBe("Continuing to Luke…");
  expect(card.querySelectorAll("p").length).toBe(1);
});
