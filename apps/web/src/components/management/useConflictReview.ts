import { useCallback, useEffect, useRef, useState } from "react";
import {
  previewFileOperation,
  type FileOperationPreview,
  type FileOperationPreviewInput,
  type NameConflictChoice
} from "../../api/client";
import { chooseConflicts, isCompletePreview } from "./conflict-review-model";
import { managementError } from "./management-model";

export function useConflictReview() {
  const [value, setValue] = useState<FileOperationPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<FileOperationPreviewInput | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      requestRef.current?.abort();
    };
  }, []);
  const clear = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    inputRef.current = null;
    setValue(null);
    setError(null);
    setBusy(false);
  }, []);
  const inspect = useCallback(async (input: FileOperationPreviewInput) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    inputRef.current = input;
    setBusy(true);
    setError(null);
    try {
      const result = await previewFileOperation(input, controller.signal);
      if (!activeRef.current || controller.signal.aborted) return null;
      if (
        !isCompletePreview(
          result,
          input.type === "add-media" ? input.files.length : input.items.length
        )
      )
        throw new Error("Incomplete name check");
      setValue(result);
      return result;
    } catch (caught) {
      if (activeRef.current && !controller.signal.aborted)
        setError(managementError(caught));
      return null;
    } finally {
      if (activeRef.current && !controller.signal.aborted) setBusy(false);
    }
  }, []);
  function choose(key: string, choice: NameConflictChoice, remaining: boolean) {
    if (!inputRef.current || !value || busy) return;
    void inspect(
      chooseConflicts(inputRef.current, value, key, choice, remaining)
    );
  }
  function retry() {
    if (inputRef.current) void inspect(inputRef.current);
  }
  return { value, busy, error, inspect, choose, clear, retry };
}
