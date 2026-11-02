import { z } from "zod";

export const FileOperationItem = z
  .object({
    assetId: z.string().min(1).max(256).optional(),
    folderId: z.string().min(1).max(256).optional(),
    trashId: z.string().min(1).max(256).optional(),
    expectedVersion: z.string().min(1).max(256),
    conflict: z.enum(["skip", "keep-both"]).optional()
  })
  .refine(
    (item) =>
      [item.assetId, item.folderId, item.trashId].filter(Boolean).length === 1
  );

export const FileOperationBody = z
  .object({
    requestId: z.uuid(),
    type: z.enum([
      "create-folder",
      "rename-media",
      "rename-folder",
      "move-media",
      "move-folder",
      "trash",
      "restore",
      "purge",
      "empty-trash",
      "add-media"
    ]),
    uploadId: z.uuid().optional(),
    items: z.array(FileOperationItem).max(100).default([]),
    destinationFolderId: z.string().min(1).max(256).optional(),
    expectedParentVersion: z.string().min(1).max(256).optional(),
    expectedRevision: z.string().min(1).max(128).optional(),
    expectedCount: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    expectedInventoryVersion: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    name: z.string().min(1).max(255).optional(),
    conflict: z.enum(["skip", "keep-both"]).default("skip")
  })
  .superRefine((body, context) => {
    const invalid = () =>
      context.addIssue({ code: "custom", message: "Invalid operation." });
    if (
      !["move-media", "move-folder", "restore"].includes(body.type) &&
      body.items.some((item) => item.conflict !== undefined)
    )
      invalid();
    if (body.type === "empty-trash") {
      if (
        body.items.length ||
        body.expectedRevision === undefined ||
        body.expectedCount === undefined ||
        body.destinationFolderId ||
        body.uploadId ||
        body.name
      )
        invalid();
    } else if (body.type === "create-folder" || body.type === "add-media") {
      if (
        body.items.length ||
        !body.destinationFolderId ||
        !body.expectedParentVersion ||
        !body.name
      )
        invalid();
      if (body.type === "add-media" && !body.uploadId) invalid();
    } else {
      if (!body.items.length) invalid();
      const key =
        body.type === "restore" || body.type === "purge"
          ? "trashId"
          : body.type.endsWith("folder")
            ? "folderId"
            : "assetId";
      if (body.items.some((item) => !item[key])) invalid();
      if (
        (body.type.startsWith("rename") || body.type === "move-folder") &&
        body.items.length !== 1
      )
        invalid();
      if (body.type.startsWith("rename") && !body.name) invalid();
      if (body.type.startsWith("move") && !body.destinationFolderId) invalid();
      if (
        new Set(body.items.map((item) => item[key])).size !== body.items.length
      )
        invalid();
    }
  });

export type FileOperationRequest = z.infer<typeof FileOperationBody>;
export type FileOperationRequestItem = z.infer<typeof FileOperationItem>;
export type FileOperationStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled"
  | "needs_attention";

export function validateManagedName(name: string): string {
  if (
    name === "." ||
    name === ".." ||
    name.startsWith(".") ||
    /[\\/]/u.test(name) ||
    Array.from(name).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
    ) ||
    name !== name.trim() ||
    /[. ]$/u.test(name) ||
    Buffer.byteLength(name, "utf8") > 255 ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)
  ) {
    throw new FileManagementError("invalid_name");
  }
  return name;
}

export class FileManagementError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "FileManagementError";
  }
}
