function newestToast(): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(".ui-toast:not([data-leaving])")].at(-1);
}

export function newestToastSays(): string | undefined {
  return newestToast()?.textContent ?? undefined;
}

export function newestToastAction(): HTMLButtonElement | undefined {
  return newestToast()?.querySelector<HTMLButtonElement>("button") ?? undefined;
}
