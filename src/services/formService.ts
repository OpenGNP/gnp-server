import { and, count, desc, eq, inArray, isNull, max } from "drizzle-orm";

import { db, fieldOptions, folders, formAllowedUsers, formFields, forms, submissions, users } from "../db/client";
import type { CurrentUser } from "../middleware/authMiddleware";
import { badRequest, forbidden, notFound, unauthorized } from "../utils/errors";
import type {
  CreateFieldOptionInput,
  CreateFormFieldInput,
  CreateFormInput,
  FormFieldInput,
  UpdateFormFieldInput,
  UpdateFormInput,
} from "../validators/formValidator";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const nowIso = () => new Date().toISOString();

/**
 * `forms.start_date` / `end_date` are `timestamp` (no time zone) columns and come back
 * zone-less ("2026-06-08 02:55:00"). Writes go in as UTC (`dateStringSchema` →
 * `.toISOString()`), so parse them back as UTC — `Date.parse` on a zone-less string
 * uses the process's local zone, which need not be UTC.
 */
const parseStoredTimestamp = (value: string): number =>
  Date.parse(/Z$|[+-]\d\d(:?\d\d)?$/.test(value) ? value : `${value.replace(" ", "T")}Z`);

/** Insert a list of fields (with their options) for a form, in the given order. */
async function insertFields(tx: Tx, formId: number, fields: FormFieldInput[]) {
  for (const [index, field] of fields.entries()) {
    const [insertedField] = await tx
      .insert(formFields)
      .values({
        formId,
        fieldLabel: field.fieldLabel,
        fieldType: field.fieldType,
        section: field.section,
        isRequired: field.isRequired,
        analyzeWithAi: field.analyzeWithAi,
        allowOther: field.allowOther,
        fieldOrder: field.fieldOrder ?? index + 1,
      })
      .returning();

    if (field.options?.length) {
      await tx.insert(fieldOptions).values(
        field.options.map((option, optionIndex) => ({
          fieldId: insertedField!.id,
          optionLabel: option.optionLabel,
          optionValue: option.optionValue,
          optionOrder: option.optionOrder ?? optionIndex + 1,
        })),
      );
    }
  }
}

/**
 * Stamp `forms.updated_at` so "last updated" reflects edits to the form's fields
 * and options, not just direct changes to the form row.
 */
async function touchForm(formId: number) {
  await db.update(forms).set({ updatedAt: nowIso() }).where(eq(forms.id, formId));
}

async function getOwnedForm(id: number, adminId: number) {
  const [form] = await db.select().from(forms).where(eq(forms.id, id)).limit(1);

  if (!form) throw notFound("Form not found");
  if (form.adminId !== adminId) throw forbidden("You do not have access to this form");

  return form;
}

async function assertFolderOwnership(folderId: number, adminId: number) {
  const [folder] = await db
    .select({ adminId: folders.adminId })
    .from(folders)
    .where(eq(folders.id, folderId))
    .limit(1);

  if (!folder) throw badRequest("Folder not found");
  if (folder.adminId !== adminId) throw forbidden("You do not have access to this folder");
}

async function getFieldOrThrow(fieldId: number, formId: number) {
  const [field] = await db.select().from(formFields).where(eq(formFields.id, fieldId)).limit(1);

  if (!field || field.formId !== formId) throw notFound("Field not found");
  return field;
}

async function getOptionOrThrow(optionId: number, fieldId: number) {
  const [option] = await db.select().from(fieldOptions).where(eq(fieldOptions.id, optionId)).limit(1);

  if (!option || option.fieldId !== fieldId) throw notFound("Option not found");
  return option;
}

async function syncAllowedUsers(tx: Tx, formId: number, organizationId: number | null, emails: string[]) {
  await tx.delete(formAllowedUsers).where(eq(formAllowedUsers.formId, formId));

  if (emails.length === 0 || organizationId === null) return;

  const matchedUsers = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.organizationId, organizationId), inArray(users.email, emails)));

  if (matchedUsers.length === 0) return;

  await tx.insert(formAllowedUsers).values(matchedUsers.map((user) => ({ formId, userId: user.id })));
}

async function loadFormForViewer(id: number) {
  const form = await db.query.forms.findFirst({
    where: eq(forms.id, id),
    with: {
      formFields: {
        orderBy: (fields, { asc }) => [asc(fields.fieldOrder)],
        with: {
          fieldOptions: {
            orderBy: (options, { asc }) => [asc(options.optionOrder)],
          },
        },
      },
      formAllowedUsers: {
        columns: { userId: true },
      },
    },
  });

  if (!form) throw notFound("Form not found");
  return form;
}

function assertAccessible(
  form: { accessType: string | null; organizationId: number | null; formAllowedUsers: { userId: number }[] },
  viewer: CurrentUser | null,
) {
  const accessType = form.accessType ?? "organization";

  if (accessType === "public") return;

  if (!viewer) throw unauthorized("Sign in required to access this form");

  if (accessType === "organization") {
    if (viewer.organizationId === null || viewer.organizationId !== form.organizationId) {
      throw forbidden("You do not have access to this form");
    }
    return;
  }

  if (accessType === "specific") {
    const allowed = form.formAllowedUsers.some((entry) => entry.userId === viewer.id);
    if (!allowed) throw forbidden("You do not have access to this form");
    return;
  }

  // Unrecognized accessType: fail closed rather than silently granting access.
  throw forbidden("You do not have access to this form");
}

export const formService = {
  async assertOwnership(id: number, adminId: number) {
    await getOwnedForm(id, adminId);
  },

  async listByAdmin(adminId: number, folderId?: number) {
    const conditions = [eq(forms.adminId, adminId)];
    if (folderId !== undefined) conditions.push(eq(forms.folderId, folderId));

    return db
      .select({
        id: forms.id,
        formTitle: forms.formTitle,
        formDescription: forms.formDescription,
        status: forms.status,
        accessType: forms.accessType,
        folderId: forms.folderId,
        sortOrder: forms.sortOrder,
        startDate: forms.startDate,
        endDate: forms.endDate,
        createdAt: forms.createdAt,
        updatedAt: forms.updatedAt,
        submissionCount: count(submissions.id),
      })
      .from(forms)
      .leftJoin(submissions, eq(submissions.formId, forms.id))
      .where(and(...conditions))
      .groupBy(forms.id)
      .orderBy(desc(forms.updatedAt));
  },

  async getForEdit(id: number, adminId: number) {
    await getOwnedForm(id, adminId);

    const form = await db.query.forms.findFirst({
      where: eq(forms.id, id),
      with: {
        formFields: {
          orderBy: (fields, { asc }) => [asc(fields.fieldOrder)],
          with: {
            fieldOptions: {
              orderBy: (options, { asc }) => [asc(options.optionOrder)],
            },
          },
        },
        formAllowedUsers: {
          with: {
            user: {
              columns: { id: true, fullName: true, email: true },
            },
          },
        },
      },
    });

    return form!;
  },

  async getPublic(id: number, viewer: CurrentUser | null) {
    const form = await loadFormForViewer(id);

    if (form.status !== "active") throw notFound("Form not found");
    assertAccessible(form, viewer);

    return {
      id: form.id,
      formTitle: form.formTitle,
      formDescription: form.formDescription,
      accessType: form.accessType,
      acceptingResponses: form.acceptingResponses,
      recordName: form.recordName,
      startDate: form.startDate,
      endDate: form.endDate,
      fields: form.formFields,
    };
  },

  /** Same access rules as `getPublic`, plus the accepting-responses window. Used by submission intake. */
  async getFormForSubmission(id: number, viewer: CurrentUser | null) {
    const form = await loadFormForViewer(id);

    if (form.status !== "active") throw notFound("Form not found");
    assertAccessible(form, viewer);

    if (!form.acceptingResponses) {
      throw forbidden("This form is not currently accepting responses");
    }

    const now = Date.now();
    if (form.startDate && now < parseStoredTimestamp(form.startDate)) {
      throw forbidden("This form is not yet accepting responses");
    }
    if (form.endDate && now > parseStoredTimestamp(form.endDate)) {
      throw forbidden("This form is no longer accepting responses");
    }

    return form;
  },

  async create(admin: CurrentUser, input: CreateFormInput) {
    if (input.folderId !== undefined) {
      await assertFolderOwnership(input.folderId, admin.id);
    }

    const folderId = input.folderId ?? null;
    const folderCondition = folderId === null ? isNull(forms.folderId) : eq(forms.folderId, folderId);

    return db.transaction(async (tx) => {
      // New forms append to the end of whatever container (folder or root) they land
      // in, same "current max + 1" pattern as fieldOrder/optionOrder below.
      const [current] = await tx
        .select({ value: max(forms.sortOrder) })
        .from(forms)
        .where(and(eq(forms.adminId, admin.id), folderCondition));

      const [form] = await tx
        .insert(forms)
        .values({
          adminId: admin.id,
          folderId,
          organizationId: admin.organizationId,
          formTitle: input.formTitle,
          formDescription: input.formDescription,
          status: input.status,
          accessType: input.accessType,
          acceptingResponses: input.acceptingResponses,
          recordName: input.recordName,
          oneResponsePerPerson: input.oneResponsePerPerson,
          startDate: input.startDate,
          endDate: input.endDate,
          sortOrder: (current?.value ?? -1) + 1,
        })
        .returning();

      await insertFields(tx, form!.id, input.fields);

      if (input.accessType === "specific" && input.allowedEmails?.length) {
        await syncAllowedUsers(tx, form!.id, admin.organizationId, input.allowedEmails);
      }

      return form!;
    });
  },

  async update(id: number, admin: CurrentUser, input: UpdateFormInput) {
    const existing = await getOwnedForm(id, admin.id);

    if (input.folderId !== undefined && input.folderId !== null) {
      await assertFolderOwnership(input.folderId, admin.id);
    }

    const { allowedEmails, fields, ...rest } = input;

    return db.transaction(async (tx) => {
      let updated = existing;

      // Any edit here (settings, the field list, or the allowed-users list) bumps updated_at.
      if (Object.keys(rest).length > 0) {
        const [row] = await tx
          .update(forms)
          .set({ ...rest, updatedAt: nowIso() })
          .where(eq(forms.id, id))
          .returning();
        updated = row!;
      } else if (allowedEmails || fields) {
        const [row] = await tx
          .update(forms)
          .set({ updatedAt: nowIso() })
          .where(eq(forms.id, id))
          .returning();
        updated = row!;
      }

      if (fields) {
        const [tally] = await tx
          .select({ value: count(submissions.id) })
          .from(submissions)
          .where(eq(submissions.formId, id));

        if ((tally?.value ?? 0) > 0) {
          throw badRequest(
            "This form already has responses, so its questions can no longer be changed. Duplicate it to start a new version.",
          );
        }

        // Replace the whole field list. Options cascade-delete with their field.
        await tx.delete(formFields).where(eq(formFields.formId, id));
        await insertFields(tx, id, fields);
      }

      if (allowedEmails) {
        await syncAllowedUsers(tx, id, admin.organizationId, allowedEmails);
      }

      return updated;
    });
  },

  async remove(id: number, adminId: number) {
    await getOwnedForm(id, adminId);
    await db.delete(forms).where(eq(forms.id, id));
  },

  async addField(formId: number, adminId: number, input: CreateFormFieldInput) {
    await getOwnedForm(formId, adminId);

    const field = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ value: max(formFields.fieldOrder) })
        .from(formFields)
        .where(eq(formFields.formId, formId));

      const [inserted] = await tx
        .insert(formFields)
        .values({
          formId,
          fieldLabel: input.fieldLabel,
          fieldType: input.fieldType,
          section: input.section,
          isRequired: input.isRequired,
          analyzeWithAi: input.analyzeWithAi,
          allowOther: input.allowOther,
          fieldOrder: input.fieldOrder ?? (current?.value ?? 0) + 1,
        })
        .returning();

      if (input.options?.length) {
        await tx.insert(fieldOptions).values(
          input.options.map((option, index) => ({
            fieldId: inserted!.id,
            optionLabel: option.optionLabel,
            optionValue: option.optionValue,
            optionOrder: option.optionOrder ?? index + 1,
          })),
        );
      }

      return inserted!;
    });

    await touchForm(formId);
    return field;
  },

  async updateField(formId: number, fieldId: number, adminId: number, input: UpdateFormFieldInput) {
    await getOwnedForm(formId, adminId);
    await getFieldOrThrow(fieldId, formId);

    if (Object.keys(input).length === 0) {
      const [field] = await db.select().from(formFields).where(eq(formFields.id, fieldId)).limit(1);
      return field!;
    }

    const [updated] = await db.update(formFields).set(input).where(eq(formFields.id, fieldId)).returning();
    await touchForm(formId);
    return updated!;
  },

  async removeField(formId: number, fieldId: number, adminId: number) {
    await getOwnedForm(formId, adminId);
    await getFieldOrThrow(fieldId, formId);
    await db.delete(formFields).where(eq(formFields.id, fieldId));
    await touchForm(formId);
  },

  async reorderFields(formId: number, adminId: number, fieldIds: number[]) {
    await getOwnedForm(formId, adminId);

    const existingFields = await db
      .select({ id: formFields.id })
      .from(formFields)
      .where(eq(formFields.formId, formId));
    const existingIds = new Set(existingFields.map((field) => field.id));

    if (fieldIds.length !== existingIds.size || !fieldIds.every((id) => existingIds.has(id))) {
      throw badRequest("fieldIds must match the form's existing fields exactly");
    }

    await db.transaction(async (tx) => {
      for (const [index, fieldId] of fieldIds.entries()) {
        await tx
          .update(formFields)
          .set({ fieldOrder: index + 1 })
          .where(eq(formFields.id, fieldId));
      }
    });

    await touchForm(formId);
  },

  /**
   * Reorders one container's worth of sidebar siblings (a folder's forms, or the
   * folder-less ones at root). Deliberately does NOT call touchForm — a drag-reorder
   * isn't a content change, and bumping updated_at here would scramble Home's
   * "recent forms" (sorted by updated_at) every time someone reorders the sidebar.
   */
  async reorderForms(adminId: number, folderId: number | null, formIds: number[]) {
    const folderCondition = folderId === null ? isNull(forms.folderId) : eq(forms.folderId, folderId);

    const existingForms = await db
      .select({ id: forms.id })
      .from(forms)
      .where(and(eq(forms.adminId, adminId), folderCondition));
    const existingIds = new Set(existingForms.map((form) => form.id));

    if (formIds.length !== existingIds.size || !formIds.every((id) => existingIds.has(id))) {
      throw badRequest("formIds must match the forms currently in that folder exactly");
    }

    await db.transaction(async (tx) => {
      for (const [index, formId] of formIds.entries()) {
        await tx.update(forms).set({ sortOrder: index }).where(eq(forms.id, formId));
      }
    });
  },

  async addOption(formId: number, fieldId: number, adminId: number, input: CreateFieldOptionInput) {
    await getOwnedForm(formId, adminId);
    await getFieldOrThrow(fieldId, formId);

    const [current] = await db
      .select({ value: max(fieldOptions.optionOrder) })
      .from(fieldOptions)
      .where(eq(fieldOptions.fieldId, fieldId));

    const [option] = await db
      .insert(fieldOptions)
      .values({
        fieldId,
        optionLabel: input.optionLabel,
        optionValue: input.optionValue,
        optionOrder: input.optionOrder ?? (current?.value ?? 0) + 1,
      })
      .returning();

    await touchForm(formId);
    return option!;
  },

  async removeOption(formId: number, fieldId: number, optionId: number, adminId: number) {
    await getOwnedForm(formId, adminId);
    await getFieldOrThrow(fieldId, formId);
    await getOptionOrThrow(optionId, fieldId);
    await db.delete(fieldOptions).where(eq(fieldOptions.id, optionId));
    await touchForm(formId);
  },
};
