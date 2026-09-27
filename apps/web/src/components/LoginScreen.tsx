import { useState, type FormEvent } from "react";
import { CircleAlert, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { ApiError, login } from "../api/client";
import { BrandMark } from "./BrandMark";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

interface LoginScreenProps {
  onAuthenticated: () => void;
}

export function LoginScreen({ onAuthenticated }: LoginScreenProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login(password);
      onAuthenticated();
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.code === "password_not_configured"
      ) {
        setError("Password is not configured on this server.");
      } else if (
        caught instanceof ApiError &&
        caught.code === "too_many_login_attempts"
      ) {
        setError("Too many attempts. Try again later.");
      } else {
        setError("The password was not accepted.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <form
        className="w-full max-w-[390px]"
        aria-busy={isSubmitting}
        onSubmit={handleSubmit}
      >
        <Card>
          <CardHeader>
            <BrandMark className="login-brand-logo" />
            <CardTitle>Aether</CardTitle>
            <CardDescription>
              Where memories gather, preserved beyond time.
            </CardDescription>
          </CardHeader>

          <CardContent className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  autoComplete="current-password"
                  className="pr-10"
                  disabled={isSubmitting}
                  type={isPasswordVisible ? "text" : "password"}
                  value={password}
                  aria-describedby={error ? "login-error" : undefined}
                  aria-invalid={Boolean(error)}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (error) {
                      setError(null);
                    }
                  }}
                />
                <Button
                  className="absolute top-1/2 right-1 -translate-y-1/2"
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                  aria-label={
                    isPasswordVisible ? "Hide password" : "Show password"
                  }
                  aria-pressed={isPasswordVisible}
                  disabled={isSubmitting}
                  onClick={() => setIsPasswordVisible((visible) => !visible)}
                >
                  {isPasswordVisible ? <EyeOff /> : <Eye />}
                </Button>
              </div>
            </div>

            {error ? (
              <Alert id="login-error" variant="destructive">
                <CircleAlert />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <Button
              className="w-full"
              disabled={isSubmitting || !password}
              size="lg"
              type="submit"
            >
              {isSubmitting ? (
                <>
                  <LoaderCircle
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                  Opening...
                </>
              ) : (
                "Enter"
              )}
            </Button>
          </CardContent>
        </Card>
      </form>
    </main>
  );
}
