export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const register = () => {
    void navigator.serviceWorker.register("/service-worker.js").catch(() => {
      // Offline support is optional; a failed registration must not block the app.
    });
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
