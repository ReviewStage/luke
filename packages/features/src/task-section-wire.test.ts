import assert from "node:assert/strict";
import { Schema as EffectSchema } from "effect";
import { describe, it } from "vitest";
import {
  TASK_SECTION_GLYPH,
  TASK_SECTION_ICON_COLOR,
  TASK_SECTION_ICON_KIND,
  taskSectionIconSchema,
} from "./task-section-wire.js";

const isIcon = EffectSchema.is(taskSectionIconSchema);

const glyph = (name: string, color?: string) => ({
  kind: TASK_SECTION_ICON_KIND.GLYPH,
  glyph: name,
  ...(color === undefined ? undefined : { color }),
});

describe("taskSectionIconSchema", () => {
  it("takes every glyph a section could wear before, with no color", () => {
    for (const name of Object.values(TASK_SECTION_GLYPH)) assert.ok(isIcon(glyph(name)), name);
  });

  it("takes any kebab-case glyph name, in a color of the palette", () => {
    assert.ok(isIcon(glyph("arrow-down-wide-narrow", TASK_SECTION_ICON_COLOR.TEAL)));
    assert.ok(isIcon(glyph("grid2x2", TASK_SECTION_ICON_COLOR.PINK)));
  });

  it("refuses a glyph name spelled other than kebab-case, or past its bound", () => {
    for (const name of ["", "FlaskConical", "flask conical", "-flask", "flask--conical", "a/b"]) {
      assert.equal(isIcon(glyph(name)), false, name);
    }
    assert.equal(isIcon(glyph("a".repeat(65))), false);
  });

  it("refuses a color off the palette", () => {
    assert.equal(isIcon(glyph("rocket", "#ff0000")), false);
  });
});
