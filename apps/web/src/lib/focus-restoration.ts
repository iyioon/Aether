export function captureFocusTarget(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || focused === document.body)
    return null;
  const menu = focused.closest('[role="menu"]');
  const triggerId = menu?.getAttribute("aria-labelledby");
  const trigger = triggerId ? document.getElementById(triggerId) : null;
  return trigger instanceof HTMLElement ? trigger : focused;
}

export function restoreFocusAfterClose(target: HTMLElement | null): void {
  if (!target || typeof window === "undefined") return;
  window.requestAnimationFrame(() => {
    if (
      !target.isConnected ||
      target.closest('[inert], [aria-hidden="true"]') ||
      target.matches(":disabled") ||
      !target.getClientRects().length ||
      window.getComputedStyle(target).visibility === "hidden"
    )
      return;
    const focused = document.activeElement;
    if (
      focused !== target &&
      focused !== document.body &&
      focused instanceof HTMLElement &&
      focused.isConnected &&
      !focused.closest(
        '[inert], [aria-hidden="true"], [role="dialog"][data-state="closed"], [role="alertdialog"][data-state="closed"]'
      ) &&
      focused.getClientRects().length &&
      window.getComputedStyle(focused).visibility !== "hidden"
    )
      return;
    const focusedDialog = document.activeElement?.closest(
      '[role="dialog"], [role="alertdialog"]'
    );
    if (
      focusedDialog instanceof HTMLElement &&
      focusedDialog.dataset.state !== "closed" &&
      !focusedDialog.contains(target)
    )
      return;
    const modal = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]'
      )
    )
      .filter(
        (element) =>
          element.dataset.state !== "closed" && element.getClientRects().length
      )
      .at(-1);
    if (modal && !modal.contains(target)) return;
    target.focus({ preventScroll: true });
  });
}
