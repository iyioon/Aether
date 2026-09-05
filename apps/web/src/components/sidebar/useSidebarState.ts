import { useCallback, useEffect, useState } from "react";

const SIDEBAR_COLLAPSED_STORAGE_KEY = "aether.sidebar.collapsed";

export function useSidebarState() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    readSidebarCollapsedPreference
  );

  const closeSidebar = useCallback(() => {
    setIsSidebarOpen(false);
  }, []);

  const openSidebar = useCallback(() => {
    setIsSidebarOpen(true);
  }, []);

  const collapseSidebar = useCallback(() => {
    setIsSidebarCollapsed(true);
    setIsSidebarOpen(false);
  }, []);

  const expandSidebar = useCallback(() => {
    setIsSidebarCollapsed(false);
  }, []);

  useEffect(() => {
    if (!isSidebarOpen) {
      return;
    }

    function closeSidebarOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsSidebarOpen(false);
      }
    }

    window.addEventListener("keydown", closeSidebarOnEscape);

    return () => {
      window.removeEventListener("keydown", closeSidebarOnEscape);
    };
  }, [isSidebarOpen]);

  useEffect(() => {
    writeSidebarCollapsedPreference(isSidebarCollapsed);
  }, [isSidebarCollapsed]);

  return {
    closeSidebar,
    collapseSidebar,
    expandSidebar,
    isSidebarCollapsed,
    isSidebarOpen,
    openSidebar
  };
}

function readSidebarCollapsedPreference(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeSidebarCollapsedPreference(isCollapsed: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_STORAGE_KEY,
      String(isCollapsed)
    );
  } catch {
    // A storage failure should not block the sidebar interaction.
  }
}
