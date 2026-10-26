import { describe, expect, it } from "vitest";
import { defaultPresentationValues } from "./presentation-model";
import {
  panPresentation,
  presentationGeometry,
  presentationMediaStyle
} from "./presentation-geometry";

const wide = { width: 1920, height: 1080 };
const square = { width: 300, height: 300 };

describe("shared media framing", () => {
  it("retains surface defaults until an explicit framing choice is saved", () => {
    const values = defaultPresentationValues();
    expect(presentationMediaStyle(values, "contain")).toMatchObject({
      objectFit: "contain",
      objectPosition: "50% 50%",
      transform: "scale(1)"
    });
    expect(presentationMediaStyle(values, "cover").objectFit).toBe("cover");
    expect(
      presentationMediaStyle({ ...values, fit: "cover" }, "contain").objectFit
    ).toBe("cover");
  });

  it("always shows the whole frame for Fit even with legacy crop coordinates", () => {
    const values = {
      ...defaultPresentationValues(),
      fit: "contain" as const,
      focalX: 0,
      focalY: 1,
      zoom: 4
    };
    expect(presentationMediaStyle(values, "cover")).toEqual({
      objectFit: "contain",
      objectPosition: "50% 50%",
      transformOrigin: "50% 50%",
      transform: "scale(1)"
    });
    expect(presentationGeometry(wide, square, values, "cover")).toEqual({
      width: 300,
      height: 168.75
    });
    expect(panPresentation(values, wide, square, { x: 100, y: -100 })).toEqual({
      focalX: 0.5,
      focalY: 0.5
    });
  });

  it("uses a common focus and scale for image, video and canvas rendering", () => {
    const values = {
      ...defaultPresentationValues(),
      focalX: 0.25,
      focalY: 0.75,
      zoom: 2
    };
    expect(presentationMediaStyle(values, "cover")).toEqual({
      objectFit: "cover",
      objectPosition: "25% 75%",
      transformOrigin: "25% 75%",
      transform: "scale(2)"
    });
    expect(presentationGeometry(wide, square, values, "cover")).toEqual({
      width: 1066.6666666666667,
      height: 600
    });
  });

  it("moves in the drag direction and clamps each axis to avoid exposed edges", () => {
    const values = defaultPresentationValues();
    const rendered = presentationGeometry(wide, square, values, "cover");
    const overflow = rendered.width - square.width;
    expect(
      panPresentation(values, wide, square, { x: overflow / 4, y: 100 })
    ).toEqual({ focalX: 0.25, focalY: 0.5 });
    expect(
      panPresentation(values, wide, square, { x: 10000, y: -10000 })
    ).toEqual({ focalX: 0, focalY: 0.5 });
    expect(
      panPresentation(values, { width: 1080, height: 1920 }, square, {
        x: -10000,
        y: -10000
      })
    ).toEqual({ focalX: 0.5, focalY: 1 });
    expect(
      panPresentation({ ...values, zoom: 2 }, wide, square, {
        x: 10000,
        y: -10000
      })
    ).toEqual({ focalX: 0, focalY: 1 });
  });

  it("handles invalid dimensions and ignores nonfinite pointer deltas", () => {
    const values = defaultPresentationValues();
    expect(
      presentationGeometry({ width: 0, height: 0 }, square, values, "cover")
    ).toEqual({ width: 0, height: 0 });
    expect(
      presentationGeometry(
        wide,
        { width: Infinity, height: 300 },
        values,
        "cover"
      )
    ).toEqual({ width: 0, height: 0 });
    expect(
      panPresentation(values, wide, square, { x: NaN, y: Infinity })
    ).toEqual({ focalX: 0.5, focalY: 0.5 });
    expect(
      presentationMediaStyle(
        { ...values, focalX: -2, focalY: 9, zoom: 20 },
        "cover"
      )
    ).toMatchObject({ objectPosition: "0% 100%", transform: "scale(4)" });
  });
});
