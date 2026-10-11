import { useCallback, useState } from "react";

export function useMeasuredAspectRatios() {
  const [measuredAspectRatios, setMeasuredAspectRatios] = useState<
    Record<string, string>
  >({});

  const handleMediaDimensionsKnown = useCallback(
    (assetId: string, width: number, height: number) => {
      if (width <= 0 || height <= 0) {
        return;
      }

      const ratio = `${Math.round(width)} / ${Math.round(height)}`;
      setMeasuredAspectRatios((current) =>
        current[assetId] === ratio
          ? current
          : {
              ...current,
              [assetId]: ratio
            }
      );
    },
    []
  );

  return {
    handleMediaDimensionsKnown,
    measuredAspectRatios
  };
}
