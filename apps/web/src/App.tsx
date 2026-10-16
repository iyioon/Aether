import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, getMe, subscribeToUnauthorized } from "./api/client";
import { AppShell } from "./components/AppShell";
import { CardLoadingPreview } from "./components/dev/CardLoadingPreview";
import { LoginScreen } from "./components/LoginScreen";
import { ServerUnavailableScreen } from "./components/ServerUnavailableScreen";
import { usePageLifecycle } from "./hooks/usePageLifecycle";
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
  const [logoutCleanup, setLogoutCleanup] = useState<{
    run: () => void;
  } | null>(null);
  const authGenerationRef = useRef(0);
  const authCheckControllerRef = useRef<AbortController | null>(null);
  const cancelAuthCheck = useCallback(() => {
    authGenerationRef.current += 1;
    authCheckControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (authStatus !== "anonymous" || !logoutCleanup) return;
    // Child unmount effects flush their checkpoints before this effect runs.
    logoutCleanup.run();
    setLogoutCleanup(null);
  }, [authStatus, logoutCleanup]);

  useEffect(
    () =>
      subscribeToUnauthorized(() => {
        cancelAuthCheck();
        setLoginNotice(
          "Your session expired. Enter your password to continue."
        );
        setAuthStatus("anonymous");
      }),
    [cancelAuthCheck]
  );

  usePageLifecycle({
    onResume: () => {
      if (authStatus === "checking" || authStatus === "anonymous") return;
      if (authStatus === "unavailable") setAuthStatus("checking");
      setAuthCheckAttempt((current) => current + 1);
    }
  });

  useEffect(() => {
    const controller = new AbortController();
    const generation = authGenerationRef.current;
    authCheckControllerRef.current = controller;

    getMe(controller.signal)
      .then(() => {
        if (
          !controller.signal.aborted &&
          generation === authGenerationRef.current
        ) {
          setAuthStatus("authenticated");
        }
      })
      .catch((error: unknown) => {
        if (
          !controller.signal.aborted &&
          generation === authGenerationRef.current
        ) {
          setAuthStatus((current) =>
            error instanceof ApiError && error.status === 401
              ? "anonymous"
              : current === "authenticated"
                ? current
                : "unavailable"
          );
        }
      });

    return () => {
      controller.abort();
      if (authCheckControllerRef.current === controller)
        authCheckControllerRef.current = null;
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
          cancelAuthCheck();
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
        onLogout={(clearResumeAfterUnmount) => {
          setLogoutCleanup({ run: clearResumeAfterUnmount });
          cancelAuthCheck();
          setLoginNotice(null);
          setAuthStatus("anonymous");
        }}
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
