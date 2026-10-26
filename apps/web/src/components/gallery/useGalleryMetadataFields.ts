import { useEffect, useState } from "react";
import type { ViewMode } from "../library-state";
import {
  defaultMetadataFields,
  readGalleryMetadataFields,
  writeGalleryMetadataFields,
  type GalleryMetadataField
} from "./gallery-metadata";

export function useGalleryMetadataFields(view: ViewMode = "gallery") {
  const [byView, setByView] = useState(() => ({
    gallery: readGalleryMetadataFields("gallery"),
    feed: readGalleryMetadataFields("feed"),
    compare: readGalleryMetadataFields("compare")
  }));
  const fields = byView[view];
  function setFields(
    update:
      | Set<GalleryMetadataField>
      | ((current: Set<GalleryMetadataField>) => Set<GalleryMetadataField>)
  ) {
    setByView((current) => ({
      ...current,
      [view]: typeof update === "function" ? update(current[view]) : update
    }));
  }

  useEffect(() => {
    writeGalleryMetadataFields(fields, view);
  }, [fields, view]);

  function clearFields() {
    setFields(new Set());
  }

  function resetFields() {
    setFields(defaultMetadataFields(view));
  }

  function toggleField(field: GalleryMetadataField) {
    setFields((current) => {
      const next = new Set(current);

      if (next.has(field)) {
        next.delete(field);
      } else {
        next.add(field);
      }

      return next;
    });
  }

  return {
    clearFields,
    fields,
    resetFields,
    toggleField
  };
}
