import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PresentationValues } from "../../api/client";
import { isKeyboardActivationTarget } from "../../lib/keyboard";
import { MAX_PRESENTATION_ZOOM, presentationClamp } from "./presentation-model";
import {
  panPresentation,
  type PresentationSize
} from "./presentation-geometry";

interface PresentationFrameProps {
  values: PresentationValues;
  source: PresentationSize;
  aspect: number;
  editing: boolean;
  disabled: boolean;
  children: ReactNode;
  onChange: (values: PresentationValues) => void;
}

export function PresentationFrame({
  values,
  source,
  aspect,
  editing,
  disabled,
  children,
  onChange
}: PresentationFrameProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const valuesRef = useRef(values);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const [size, setSize] = useState({ width: 640, height: 300 });
  const interactive = editing && !disabled && values.fit !== "contain";
  valuesRef.current = values;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const update = () => {
      const rectangle = stage.getBoundingClientRect();
      const width = Math.round(rectangle.width);
      const height = Math.round(rectangle.height);
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height }
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const frameWidth = Math.min(size.width, size.height * aspect);
  const frame = { width: frameWidth, height: frameWidth / aspect };

  function publish(next: PresentationValues) {
    valuesRef.current = next;
    onChange(next);
  }

  function distance() {
    const [first, second] = [...pointers.current.values()];
    return first && second
      ? Math.hypot(second.x - first.x, second.y - first.y)
      : 0;
  }

  return (
    <div className="media-editor-stage" ref={stageRef}>
      <div
        className="media-editor-frame"
        data-editing={interactive || undefined}
        role={interactive ? "application" : "group"}
        aria-label={
          interactive
            ? "Media position. Drag or use arrow keys to move; pinch to zoom."
            : "Media preview"
        }
        tabIndex={interactive ? 0 : undefined}
        style={{ width: frame.width, height: frame.height }}
        onKeyDown={(event) => {
          if (!interactive || event.target !== event.currentTarget) {
            return;
          }
          const movement = event.shiftKey ? 60 : 12;
          const directions: Record<string, { x: number; y: number }> = {
            ArrowLeft: { x: -movement, y: 0 },
            ArrowRight: { x: movement, y: 0 },
            ArrowUp: { x: 0, y: -movement },
            ArrowDown: { x: 0, y: movement }
          };
          const delta = directions[event.key];
          if (delta) {
            event.preventDefault();
            event.stopPropagation();
            const current = valuesRef.current;
            publish({
              ...current,
              fit: "cover",
              ...panPresentation(current, source, frame, delta)
            });
          }
        }}
        onPointerDown={(event) => {
          if (
            !interactive ||
            event.button !== 0 ||
            isKeyboardActivationTarget(event.target)
          ) {
            return;
          }
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY
          });
          if (pointers.current.size === 2) {
            pinch.current = {
              distance: distance(),
              zoom: valuesRef.current.zoom
            };
          }
        }}
        onPointerMove={(event) => {
          const previous = pointers.current.get(event.pointerId);
          if (!interactive || !previous) {
            return;
          }
          pointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY
          });
          const current = valuesRef.current;
          if (
            pointers.current.size >= 2 &&
            pinch.current &&
            pinch.current.distance > 0
          ) {
            publish({
              ...current,
              fit: "cover",
              zoom: presentationClamp(
                (pinch.current.zoom * distance()) / pinch.current.distance,
                1,
                MAX_PRESENTATION_ZOOM
              )
            });
          } else {
            publish({
              ...current,
              fit: "cover",
              ...panPresentation(current, source, frame, {
                x: event.clientX - previous.x,
                y: event.clientY - previous.y
              })
            });
          }
        }}
        onPointerUp={(event) => {
          pointers.current.delete(event.pointerId);
          if (pointers.current.size < 2) {
            pinch.current = null;
          }
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
          pinch.current = null;
        }}
        onLostPointerCapture={(event) => {
          pointers.current.delete(event.pointerId);
          pinch.current = null;
        }}
      >
        <div className="media-editor-preview-content">{children}</div>
        {interactive ? (
          <div className="media-editor-grid" aria-hidden="true" />
        ) : null}
      </div>
    </div>
  );
}
