export type GalleryMetadataField =
  | "title"
  | "mediaType"
  | "size"
  | "rating"
  | "tags"
  | "favorite";

export const galleryMetadataOptions: Array<{
  label: string;
  value: GalleryMetadataField;
}> = [
  { label: "Title", value: "title" },
  { label: "Type", value: "mediaType" },
  { label: "Size", value: "size" },
  { label: "Rating", value: "rating" },
  { label: "Tags", value: "tags" },
  { label: "Heart", value: "favorite" }
];

export const defaultGalleryMetadataFields = new Set<GalleryMetadataField>([
  "title",
  "mediaType",
  "size"
]);

const GALLERY_METADATA_STORAGE_KEY = "aether.gallery.metadata-fields";

export function readGalleryMetadataFields(): Set<GalleryMetadataField> {
  if (typeof window === "undefined") {
    return new Set(defaultGalleryMetadataFields);
  }

  try {
    const rawValue = window.localStorage.getItem(GALLERY_METADATA_STORAGE_KEY);

    if (!rawValue) {
      return new Set(defaultGalleryMetadataFields);
    }

    const parsedValue = JSON.parse(rawValue) as unknown;

    if (!Array.isArray(parsedValue)) {
      return new Set(defaultGalleryMetadataFields);
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
    return new Set(defaultGalleryMetadataFields);
  }
}

export function writeGalleryMetadataFields(
  fields: ReadonlySet<GalleryMetadataField>
): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    GALLERY_METADATA_STORAGE_KEY,
    JSON.stringify([...fields])
  );
}
