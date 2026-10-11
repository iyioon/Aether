export interface ServerRuntimeClosers {
  closeApplication: () => Promise<void>;
  closeDatabase: () => void;
  releaseLock: () => Promise<void>;
}

function asError(value: unknown): Error {
  return value instanceof Error
    ? value
    : new Error("Server runtime close step failed", { cause: value });
}

/**
 * Closes request/background work and SQLite before making the data directory
 * available to maintenance commands. Every step is attempted, and the first
 * failure is reported after the lock has been released.
 */
export async function closeServerRuntime({
  closeApplication,
  closeDatabase,
  releaseLock
}: ServerRuntimeClosers): Promise<void> {
  let firstError: Error | undefined;

  try {
    await closeApplication();
  } catch (error) {
    firstError = asError(error);
  }

  try {
    closeDatabase();
  } catch (error) {
    firstError ??= asError(error);
  }

  try {
    await releaseLock();
  } catch (error) {
    firstError ??= asError(error);
  }

  if (firstError) {
    throw firstError;
  }
}
