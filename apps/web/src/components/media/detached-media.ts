/** Ref cleanup runs before React removes a node; wait until that commit ends. */
export function releaseDetachedMedia(
  node: HTMLImageElement | HTMLVideoElement
): void {
  queueMicrotask(() => {
    // A ref may be rebound while the same active node stays mounted.
    if (node.isConnected) return;
    if ("pause" in node) node.pause();
    node.removeAttribute("src");
    if ("load" in node) node.load();
  });
}
