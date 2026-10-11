import { CircleAlert, RefreshCw } from "lucide-react";
import { BrandMark } from "./BrandMark";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";

interface ServerUnavailableScreenProps {
  onRetry: () => void;
}

export function ServerUnavailableScreen({
  onRetry
}: ServerUnavailableScreenProps) {
  return (
    <main className="login-page">
      <Card className="w-full max-w-[390px]">
        <CardHeader>
          <BrandMark className="login-brand-logo" />
          <h1 className="leading-none font-semibold">Aether is unavailable</h1>
        </CardHeader>
        <CardContent className="grid gap-5">
          <Alert variant="destructive" role="alert">
            <CircleAlert />
            <AlertTitle>Could not reach the server</AlertTitle>
            <AlertDescription>
              Check that Aether is running and that this device is connected to
              the same network, then try again.
            </AlertDescription>
          </Alert>
          <Button size="lg" type="button" onClick={onRetry}>
            <RefreshCw data-icon="inline-start" />
            Try again
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
