import type { ViewMode } from "../library-state";

export type GalleryMetadataField =
  "title" | "mediaType" | "size" | "score" | "tags" | "favorite";

export const galleryMetadataOptions: Array<{
  label: string;
  value: GalleryMetadataField;
}> = [
  { label: "Title", value: "title" },
  { label: "Type", value: "mediaType" },
  { label: "Size", value: "size" },
  { label: "Score", value: "score" },
  { label: "Tags", value: "tags" },
  { label: "Heart", value: "favorite" }
];

export const defaultGalleryMetadataFields = new Set<GalleryMetadataField>([
  "title",
  "mediaType",
  "size"
]);

function metadataKey(view: ViewMode): string {
  return `aether.${view}.metadata-fields`;
}

export function defaultMetadataFields(
  view: ViewMode
): Set<GalleryMetadataField> {
  return new Set(view === "gallery" ? defaultGalleryMetadataFields : []);
}

export function readGalleryMetadataFields(
  view: ViewMode = "gallery"
): Set<GalleryMetadataField> {
  if (typeof window === "undefined") {
    return defaultMetadataFields(view);
  }

  try {
    const rawValue = window.localStorage.getItem(metadataKey(view));

    if (!rawValue || rawValue.length > 512) {
      return defaultMetadataFields(view);
    }

    const parsedValue = JSON.parse(rawValue) as unknown;

    if (!Array.isArray(parsedValue)) {
      return defaultMetadataFields(view);
    }

    const allowedFields = new Set(
      galleryMetadataOptions.map((option) => option.value)
    );
    const fields = parsedValue.filter(
      (field): field is GalleryMetadataField =>
        typeof field === "string" &&
        allowedFields.has(field as GalleryMetadataField)
    );

    return new Set(fields);
  } catch {
    return defaultMetadataFields(view);
  }
}

export function writeGalleryMetadataFields(
  fields: ReadonlySet<GalleryMetadataField>,
  view: ViewMode = "gallery"
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(metadataKey(view), JSON.stringify([...fields]));
  } catch {
    // Metadata visibility remains usable when storage is full or restricted.
  }
}
