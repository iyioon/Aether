import { useEffect, useState } from "react";
import {
  defaultGalleryMetadataFields,
  readGalleryMetadataFields,
  writeGalleryMetadataFields,
  type GalleryMetadataField
} from "./gallery-metadata";

export function useGalleryMetadataFields() {
  const [fields, setFields] = useState<Set<GalleryMetadataField>>(() =>
    readGalleryMetadataFields()
  );

  useEffect(() => {
    writeGalleryMetadataFields(fields);
  }, [fields]);

  function clearFields() {
    setFields(new Set());
  }

  function resetFields() {
    setFields(new Set(defaultGalleryMetadataFields));
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
