import type { CSSProperties } from "react";
import type { PresentationValues } from "../../api/client";
import { presentationClamp } from "./presentation-model";

export interface PresentationSize {
  width: number;
  height: number;
}

export function presentationMediaStyle(
  presentation: PresentationValues,
  defaultFit: "contain" | "cover"
): CSSProperties {
  const fit = presentation.fit === "auto" ? defaultFit : presentation.fit;
  const focalX =
    fit === "contain" ? 0.5 : presentationClamp(presentation.focalX, 0, 1);
  const focalY =
    fit === "contain" ? 0.5 : presentationClamp(presentation.focalY, 0, 1);
  const position = `${focalX * 100}% ${focalY * 100}%`;
  return {
    objectFit: fit,
    objectPosition: position,
    transformOrigin: position,
    transform: `scale(${fit === "contain" ? 1 : presentationClamp(presentation.zoom, 1, 4)})`
  };
}

export function presentationGeometry(
  source: PresentationSize,
  frame: PresentationSize,
  presentation: PresentationValues,
  defaultFit: "contain" | "cover"
): PresentationSize {
  if (
    source.width <= 0 ||
    source.height <= 0 ||
    frame.width <= 0 ||
    frame.height <= 0 ||
    !Object.values(source).every(Number.isFinite) ||
    !Object.values(frame).every(Number.isFinite)
  ) {
    return { width: 0, height: 0 };
  }
  const fit = presentation.fit === "auto" ? defaultFit : presentation.fit;
  const ratios = [frame.width / source.width, frame.height / source.height];
  const scale =
    (fit === "contain" ? Math.min(...ratios) : Math.max(...ratios)) *
    (fit === "contain" ? 1 : presentationClamp(presentation.zoom, 1, 4));
  return { width: source.width * scale, height: source.height * scale };
}

export function panPresentation(
  presentation: PresentationValues,
  source: PresentationSize,
  frame: PresentationSize,
  movement: { x: number; y: number },
  defaultFit: "contain" | "cover" = "cover"
): Pick<PresentationValues, "focalX" | "focalY"> {
  const rendered = presentationGeometry(
    source,
    frame,
    presentation,
    defaultFit
  );
  const overflowX = rendered.width - frame.width;
  const overflowY = rendered.height - frame.height;
  return {
    focalX:
      overflowX > 0.01
        ? presentationClamp(
            presentation.focalX -
              (Number.isFinite(movement.x) ? movement.x : 0) / overflowX,
            0,
            1
          )
        : 0.5,
    focalY:
      overflowY > 0.01
        ? presentationClamp(
            presentation.focalY -
              (Number.isFinite(movement.y) ? movement.y : 0) / overflowY,
            0,
            1
          )
        : 0.5
  };
}
