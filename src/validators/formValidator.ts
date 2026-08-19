import { z } from "zod";

const dateStringSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Invalid date" })
  .transform((value) => new Date(value).toISOString());

// These mirror the DB-level CHECK constraints (chk_access_type, chk_form_status,
// chk_field_type) which are not visible in the introspected schema.ts — verified
// directly against pg_constraint rather than assumed.
export const formAccessTypeEnum = z.enum(["public", "organization", "specific"]);
export const formStatusEnum = z.enum(["active", "inactive"]);
export const formFieldTypeEnum = z.enum(["text", "textarea", "radio", "checkbox"]);

const fieldOptionSchema = z.object({
  optionLabel: z.string().trim().min(1).max(255),
  optionValue: z.string().trim().min(1).max(255),
  optionOrder: z.number().int().min(0).optional(),
});

const formFieldSchema = z.object({
  fieldLabel: z.string().trim().min(1).max(255),
  fieldType: formFieldTypeEnum,
  isRequired: z.boolean().default(false),
  fieldOrder: z.number().int().min(0).optional(),
  options: z.array(fieldOptionSchema).optional(),
});

export const createFormSchema = z.object({
  folderId: z.number().int().positive().optional(),
  formTitle: z.string().trim().min(1).max(255),
  formDescription: z.string().trim().max(2000).optional(),
  status: formStatusEnum.default("inactive"),
  accessType: formAccessTypeEnum.default("organization"),
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
export const updateFormSchema = z.object({
  folderId: z.number().int().positive().nullable().optional(),
  formTitle: z.string().trim().min(1).max(255).optional(),
  formDescription: z.string().trim().max(2000).optional(),
  status: formStatusEnum.optional(),
  accessType: formAccessTypeEnum.optional(),
  recordName: z.boolean().optional(),
  oneResponsePerPerson: z.boolean().optional(),
  startDate: dateStringSchema.optional(),
  endDate: dateStringSchema.optional(),
  allowedEmails: z.array(z.email()).optional(),
});

export const createFormFieldSchema = formFieldSchema;

export const updateFormFieldSchema = z.object({
  fieldLabel: z.string().trim().min(1).max(255).optional(),
  fieldType: formFieldTypeEnum.optional(),
  isRequired: z.boolean().optional(),
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
