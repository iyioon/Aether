import { describe, expect, it } from "vitest";
import type {
  AssetRecord,
  PresentationAspect,
  SavedHighlight
} from "../../api/client";
import { defaultPresentationValues } from "../media/presentation-model";
import { resolveFeedFramingAspect } from "./feed-framing";

function media(
  aspects: Array<Exclude<PresentationAspect, "Original">> = [],
  width: number | null = 1600,
  height: number | null = 900
): AssetRecord {
  return {
    id: "media",
    width,
    height,
    presentation: {
      ...defaultPresentationValues(),
      revision: 1,
      renditionKeys: { full: "full", highlight: "highlight", bounce: "bounce" },
      aspectFraming: Object.fromEntries(
        aspects.map((aspect) => [
          aspect,
          { fit: "cover", focalX: 0.3, focalY: 0.4, zoom: 2 }
        ])
      )
    }
  } as AssetRecord;
}

describe("Feed framing selection", () => {
  it.each([
    ["Square", 1000, 1000],
    ["Portrait", 900, 1600],
    ["Landscape", 1600, 1000]
  ] as const)("selects the exact saved %s preset", (aspect, width, height) => {
    expect(
      resolveFeedFramingAspect(media(["Square", "Portrait", "Landscape"]), {
        width,
        height
      })
    ).toBe(aspect);
  });

  it("uses Original when no preset is saved rather than inventing a crop", () => {
    expect(
      resolveFeedFramingAspect(media(), { width: 900, height: 1600 })
    ).toBe("Original");
    const asset = media();
    delete asset.presentation;
    expect(resolveFeedFramingAspect(asset, { width: 900, height: 1600 })).toBe(
      "Original"
    );
  });

  it("uses native proportions when they are the nearest available framing", () => {
    expect(
      resolveFeedFramingAspect(media(["Square", "Landscape"], 1200, 900), {
        width: 1200,
        height: 900
      })
    ).toBe("Original");
    expect(
      resolveFeedFramingAspect(media(["Square"], 600, 1200), {
        width: 900,
        height: 1600
      })
    ).toBe("Original");
  });

  it("never selects a missing preset", () => {
    expect(
      resolveFeedFramingAspect(media(["Square"]), {
        width: 900,
        height: 1600
      })
    ).toBe("Square");
  });

  it.each([
    [0.74, "Portrait"],
    [0.75, "Square"],
    [0.76, "Square"],
    [1.26, "Square"],
    [Math.sqrt(1.6), "Square"],
    [1.27, "Landscape"]
  ] as const)(
    "chooses %s around the symmetric ratio boundary as %s",
    (ratio, expected) => {
      expect(
        resolveFeedFramingAspect(
          media(["Square", "Portrait", "Landscape"], null, null),
          { width: ratio * 1000, height: 1000 }
        )
      ).toBe(expected);
    }
  );

  it("prefers a saved preset to equal-distance Original proportions", () => {
    expect(
      resolveFeedFramingAspect(media(["Square"], 1, 2), {
        width: Math.sqrt(0.5),
        height: 1
      })
    ).toBe("Square");
    expect(
      resolveFeedFramingAspect(media(["Landscape"], 1600, 1000), {
        width: 1600,
        height: 1000
      })
    ).toBe("Landscape");
  });

  it.each([
    [null, 900],
    [1600, null],
    [0, 900],
    [-1600, 900],
    [1600, NaN],
    [Infinity, 900],
    [Number.MAX_VALUE, Number.MIN_VALUE],
    [Number.MIN_VALUE, Number.MAX_VALUE]
  ])("ignores invalid native dimensions %s × %s", (width, height) => {
    expect(
      resolveFeedFramingAspect(media(["Square", "Portrait"], width, height), {
        width: 900,
        height: 1600
      })
    ).toBe("Portrait");
    expect(
      resolveFeedFramingAspect(media([], width, height), {
        width: 900,
        height: 1600
      })
    ).toBe("Original");
  });

  it.each([
    [0, 1000],
    [1000, 0],
    [-1, 1000],
    [1000, NaN],
    [Infinity, 1000],
    [Number.MAX_VALUE, Number.MIN_VALUE],
    [Number.MIN_VALUE, Number.MAX_VALUE]
  ])(
    "uses Original before a valid %s × %s viewport exists",
    (width, height) => {
      expect(
        resolveFeedFramingAspect(media(["Square", "Portrait", "Landscape"]), {
          width,
          height
        })
      ).toBe("Original");
    }
  );

  it("uses the selected highlight's presets without borrowing the main crop", () => {
    const asset = media(["Square"]);
    const highlight: SavedHighlight = {
      ...defaultPresentationValues(),
      id: "ending",
      name: "Ending",
      highlight: { startMs: 8000, endMs: 10000 },
      aspectFraming: {
        Portrait: { fit: "cover", focalX: 0.2, focalY: 0.7, zoom: 1.5 }
      },
      renditionKeys: { full: "full", highlight: "ending", bounce: "bounce" }
    };
    asset.presentation!.highlights = [highlight];
    const viewport = { width: 900, height: 1600 };
    expect(resolveFeedFramingAspect(asset, viewport)).toBe("Square");
    expect(resolveFeedFramingAspect(asset, viewport, "ending")).toBe(
      "Portrait"
    );
    expect(resolveFeedFramingAspect(asset, viewport, "missing")).toBe("Square");
    highlight.aspectFraming = {};
    expect(resolveFeedFramingAspect(asset, viewport, "ending")).toBe(
      "Original"
    );
    expect(asset.presentation!.aspectFraming).toHaveProperty("Square");
  });

  it("keeps log-distance comparisons finite for extreme valid ratios", () => {
    expect(
      resolveFeedFramingAspect(media(["Portrait"], Number.MAX_VALUE, 1), {
        width: Number.MIN_VALUE,
        height: 1
      })
    ).toBe("Portrait");
  });
});
