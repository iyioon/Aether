import { useEffect, useState } from "react";
import { ApiError, getMe, subscribeToUnauthorized } from "./api/client";
import { AppShell } from "./components/AppShell";
import { CardLoadingPreview } from "./components/dev/CardLoadingPreview";
import { LoginScreen } from "./components/LoginScreen";
import { ServerUnavailableScreen } from "./components/ServerUnavailableScreen";
import { clearSessionScrollPositions } from "./components/scroll-restoration";
import {
  useAppearanceSettings,
  type AppearanceSettings
} from "./components/settings/useAppearanceSettings";
import { Toaster } from "./components/ui/sonner";

type AuthStatus = "checking" | "anonymous" | "authenticated" | "unavailable";

export function App() {
  const appearance = useAppearanceSettings();

  if (isCardLoadingPreview()) {
    return <CardLoadingPreview />;
  }

  return <AuthenticatedApp appearance={appearance} />;
}

function AuthenticatedApp({ appearance }: { appearance: AppearanceSettings }) {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
  const [authCheckAttempt, setAuthCheckAttempt] = useState(0);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);

  useEffect(
    () =>
      subscribeToUnauthorized(() => {
        clearSessionScrollPositions();
        setLoginNotice(
          "Your session expired. Enter your password to continue."
        );
        setAuthStatus("anonymous");
      }),
    []
  );

  useEffect(() => {
    const controller = new AbortController();

    getMe(controller.signal)
      .then(() => {
        if (!controller.signal.aborted) {
          setAuthStatus("authenticated");
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setAuthStatus(
            error instanceof ApiError && error.status === 401
              ? "anonymous"
              : "unavailable"
          );
        }
      });

    return () => {
      controller.abort();
    };
  }, [authCheckAttempt]);

  if (authStatus === "checking") {
    return (
      <main className="boot-screen" aria-live="polite" role="status">
        <div className="boot-mark" aria-hidden="true" />
        <span className="sr-only">Opening Aether</span>
      </main>
    );
  }

  if (authStatus === "unavailable") {
    return (
      <ServerUnavailableScreen
        onRetry={() => {
          setAuthStatus("checking");
          setAuthCheckAttempt((current) => current + 1);
        }}
      />
    );
  }

  if (authStatus === "anonymous") {
    return (
      <LoginScreen
        notice={loginNotice}
        onAuthenticated={() => {
          clearSessionScrollPositions();
          setLoginNotice(null);
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
      <Toaster closeButton position="top-center" theme={appearance.theme} />
    </>
  );
}

function isCardLoadingPreview(): boolean {
  if (!import.meta.env.DEV) {
    return false;
  }

  return window.location.pathname.replace(/\/+$/, "") === "/dev/card-loading";
}
