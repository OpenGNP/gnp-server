import { z } from "zod";

const dateStringSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Invalid date" })
  .transform((value) => new Date(value).toISOString());

// Update-only: lets a caller explicitly clear a previously-set start/end date.
// Create has nothing to clear, so it stays on the plain (non-nullable) schema above.
const nullableDateStringSchema = z.union([dateStringSchema, z.null()]);

// These mirror the DB-level CHECK constraints (chk_access_type, chk_form_status,
// chk_field_type) which are not visible in the introspected schema.ts. `status`:
// draft = created, never published; active = published & visible (public link
// resolves); closed = was published, now taken down; archived = soft-deleted.
// The column default is "draft". `section` mirrors the values the seed writes
// ("demographic" / "feedback"); the column default is "feedback".
export const formAccessTypeEnum = z.enum(["public", "organization", "specific"]);
export const formStatusEnum = z.enum(["draft", "active", "closed", "archived"]);
export const formFieldTypeEnum = z.enum(["text", "textarea", "radio", "checkbox"]);
export const formSectionEnum = z.enum(["demographic", "feedback"]);

const fieldOptionSchema = z.object({
  optionLabel: z.string().trim().min(1).max(255),
  optionValue: z.string().trim().min(1).max(255),
  optionOrder: z.number().int().min(0).optional(),
});

const formFieldSchema = z.object({
  fieldLabel: z.string().trim().min(1).max(255),
  fieldType: formFieldTypeEnum,
  section: formSectionEnum.default("feedback"),
  isRequired: z.boolean().default(false),
  analyzeWithAi: z.boolean().default(false),
  allowOther: z.boolean().default(false),
  fieldOrder: z.number().int().min(0).optional(),
  options: z.array(fieldOptionSchema).optional(),
});

export const createFormSchema = z.object({
  folderId: z.number().int().positive().optional(),
  formTitle: z.string().trim().min(1).max(255),
  formDescription: z.string().trim().max(2000).optional(),
  status: formStatusEnum.default("draft"),
  accessType: formAccessTypeEnum.default("organization"),
  acceptingResponses: z.boolean().default(true),
  recordName: z.boolean().default(false),
  oneResponsePerPerson: z.boolean().default(false),
  startDate: dateStringSchema.optional(),
  endDate: dateStringSchema.optional(),
  fields: z.array(formFieldSchema).default([]),
  allowedEmails: z.array(z.email()).optional(),
});

// NOTE: update schemas are defined independently (not `.partial()` off the
// create schemas) because several create-side fields carry `.default(...)`;
// partial-ing those would silently backfill defaults for fields the caller
// never touched and clobber existing values on PATCH.
//
// `fields`, when present, REPLACES the form's entire field list (and their
// options) in one transaction — see formService.update. It is refused when the
// form already has submissions so an edit to unrelated settings can't cascade-
// delete answers.
export const updateFormSchema = z.object({
  folderId: z.number().int().positive().nullable().optional(),
  formTitle: z.string().trim().min(1).max(255).optional(),
  formDescription: z.string().trim().max(2000).optional(),
  status: formStatusEnum.optional(),
  accessType: formAccessTypeEnum.optional(),
  acceptingResponses: z.boolean().optional(),
  recordName: z.boolean().optional(),
  oneResponsePerPerson: z.boolean().optional(),
  startDate: nullableDateStringSchema.optional(),
  endDate: nullableDateStringSchema.optional(),
  fields: z.array(formFieldSchema).optional(),
  allowedEmails: z.array(z.email()).optional(),
});

export const createFormFieldSchema = formFieldSchema;

export const updateFormFieldSchema = z.object({
  fieldLabel: z.string().trim().min(1).max(255).optional(),
  fieldType: formFieldTypeEnum.optional(),
  section: formSectionEnum.optional(),
  isRequired: z.boolean().optional(),
  analyzeWithAi: z.boolean().optional(),
  allowOther: z.boolean().optional(),
  fieldOrder: z.number().int().min(0).optional(),
});

export const createFieldOptionSchema = fieldOptionSchema;

export const reorderFieldsSchema = z.object({
  fieldIds: z.array(z.number().int().positive()).min(1),
});

export type CreateFormInput = z.infer<typeof createFormSchema>;
export type UpdateFormInput = z.infer<typeof updateFormSchema>;
export type CreateFormFieldInput = z.infer<typeof createFormFieldSchema>;
export type UpdateFormFieldInput = z.infer<typeof updateFormFieldSchema>;
export type CreateFieldOptionInput = z.infer<typeof createFieldOptionSchema>;
export type FormFieldInput = z.infer<typeof formFieldSchema>;
