import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PresentationFrame } from "./PresentationFrame";
import { defaultPresentationValues } from "./presentation-model";

function renderFrame({
  fit = "contain",
  editing = true,
  disabled = false
}: {
  fit?: "contain" | "cover";
  editing?: boolean;
  disabled?: boolean;
} = {}) {
  return renderToStaticMarkup(
    createElement(PresentationFrame, {
      values: { ...defaultPresentationValues(), fit },
      source: { width: 800, height: 600 },
      aspect: 1,
      editing,
      disabled,
      children: createElement("span", null, "Preview"),
      onChange: () => undefined
    })
  );
}

describe("framing preview grid", () => {
  it("keeps the framing grid visible for Fit without exposing movement controls", () => {
    const markup = renderFrame();
    expect(markup).toContain('class="media-editor-grid" aria-hidden="true"');
    expect(markup).toContain('role="group" aria-label="Media preview"');
    expect(markup).not.toContain('tabindex="0"');
    expect(markup).not.toContain("data-editing");
  });

  it("exposes movement only for enabled Fill framing", () => {
    const markup = renderFrame({ fit: "cover" });
    expect(markup).toContain('data-editing="true"');
    expect(markup).toContain('role="application"');
    expect(markup).toContain('tabindex="0"');
    const disabled = renderFrame({ fit: "cover", disabled: true });
    expect(disabled).toContain("media-editor-grid");
    expect(disabled).not.toContain("data-editing");
  });

  it("hides the grid outside the Framing section", () => {
    expect(renderFrame({ editing: false })).not.toContain("media-editor-grid");
  });
});
