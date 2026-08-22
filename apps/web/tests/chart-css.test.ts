import assert from "node:assert/strict";
import test from "node:test";
import { isSafeChartCssColor, isSafeChartCssKey } from "../src/components/ui/chart-css";

test("a config key must be a plain identifier", () => {
  assert.equal(isSafeChartCssKey("users"), true);
  assert.equal(isSafeChartCssKey("active_users"), true);
  assert.equal(isSafeChartCssKey("chart-2"), true);
  assert.equal(isSafeChartCssKey("_internal"), true);
});

test("a key that could close the declaration or the rule is rejected", () => {
  assert.equal(isSafeChartCssKey(""), false);
  assert.equal(isSafeChartCssKey("2users"), false);
  assert.equal(isSafeChartCssKey("users;color:red"), false);
  assert.equal(isSafeChartCssKey("users} body{"), false);
  assert.equal(isSafeChartCssKey("users</style>"), false);
  assert.equal(isSafeChartCssKey("a b"), false);
});

test("the color shapes chart configs use pass", () => {
  assert.equal(isSafeChartCssColor("#fff"), true);
  assert.equal(isSafeChartCssColor("#22c55e"), true);
  assert.equal(isSafeChartCssColor("#22c55e80"), true);
  assert.equal(isSafeChartCssColor("rebeccapurple"), true);
  assert.equal(isSafeChartCssColor("transparent"), true);
  assert.equal(isSafeChartCssColor("rgb(34 197 94)"), true);
  assert.equal(isSafeChartCssColor("rgba(34, 197, 94, 0.5)"), true);
  assert.equal(isSafeChartCssColor("hsl(142 71% 45%)"), true);
  assert.equal(isSafeChartCssColor("oklch(0.72 0.19 150)"), true);
  assert.equal(isSafeChartCssColor("oklab(0.72 -0.15 0.1)"), true);
  assert.equal(isSafeChartCssColor("color-mix(in oklch, var(--a), var(--b) 40%)"), true);
  assert.equal(isSafeChartCssColor("var(--chart-1)"), true);
  assert.equal(isSafeChartCssColor("var(--chart-1, #fff)"), true);
  assert.equal(isSafeChartCssColor(" #fff "), true);
});

test("a color that could escape the declaration or fetch anything is rejected", () => {
  assert.equal(isSafeChartCssColor(""), false);
  assert.equal(isSafeChartCssColor("red;background:url(https://example.com)"), false);
  assert.equal(isSafeChartCssColor("red} body{display:none"), false);
  assert.equal(isSafeChartCssColor("</style><script>"), false);
  assert.equal(isSafeChartCssColor("url(https://example.com/pixel)"), false);
  assert.equal(isSafeChartCssColor("expression(alert(1))"), false);
  assert.equal(isSafeChartCssColor("@import 'https://example.com/a.css'"), false);
  assert.equal(isSafeChartCssColor("rgb(0 0 0); color: red"), false);
  assert.equal(isSafeChartCssColor("var(--a, url(https://example.com))"), false);
  assert.equal(isSafeChartCssColor("hsl(0 0% 0%) extra"), false);
});
