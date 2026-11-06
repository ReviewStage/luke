(() => {
  const GROUND = { light: "#fffcfa", dark: "#0f0d0b" };
  let chosen = null;
  try {
    chosen = localStorage.getItem("app.theme");
  } catch {}
  const theme =
    chosen === "light" || chosen === "dark"
      ? chosen
      : matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  const root = document.documentElement;
  root.setAttribute("data-ui-theme", theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", GROUND[theme]);
})();
