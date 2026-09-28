import { useEffect, useState } from "react";
import { getMe } from "./api/client";
import { AppShell } from "./components/AppShell";
import { CardLoadingPreview } from "./components/dev/CardLoadingPreview";
import { LoginScreen } from "./components/LoginScreen";
import { clearSessionScrollPositions } from "./components/scroll-restoration";
import {
  useAppearanceSettings,
  type AppearanceSettings
} from "./components/settings/useAppearanceSettings";
import { Toaster } from "./components/ui/sonner";

type AuthStatus = "checking" | "anonymous" | "authenticated";

export function App() {
  const appearance = useAppearanceSettings();

  if (isCardLoadingPreview()) {
    return <CardLoadingPreview />;
  }

  return <AuthenticatedApp appearance={appearance} />;
}

function AuthenticatedApp({
  appearance
}: {
  appearance: AppearanceSettings;
}) {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");

  useEffect(() => {
    let active = true;

    getMe()
      .then(() => {
        if (active) {
          setAuthStatus("authenticated");
        }
      })
      .catch(() => {
        if (active) {
          setAuthStatus("anonymous");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  if (authStatus === "checking") {
    return (
      <main className="boot-screen">
        <div className="boot-mark" />
      </main>
    );
  }

  if (authStatus === "anonymous") {
    return (
      <LoginScreen
        onAuthenticated={() => {
          clearSessionScrollPositions();
          setAuthStatus("authenticated");
        }}
      />
    );
  }

  return (
    <>
      <AppShell
        appearance={appearance}
        onLogout={() => setAuthStatus("anonymous")}
      />
      <Toaster
        closeButton
        position="top-center"
        theme={appearance.theme}
      />
    </>
  );
}

function isCardLoadingPreview(): boolean {
  if (!import.meta.env.DEV) {
    return false;
  }

  return window.location.pathname.replace(/\/+$/, "") === "/dev/card-loading";
}
