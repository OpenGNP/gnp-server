import { and, count, desc, eq, inArray, max } from "drizzle-orm";

import { db, fieldOptions, folders, formAllowedUsers, formFields, forms, submissions, users } from "../db/client";
import type { CurrentUser } from "../middleware/authMiddleware";
import { badRequest, forbidden, notFound, unauthorized } from "../utils/errors";
import type {
  CreateFieldOptionInput,
  CreateFormFieldInput,
  CreateFormInput,
  UpdateFormFieldInput,
  UpdateFormInput,
} from "../validators/formValidator";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const nowIso = () => new Date().toISOString();

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

    const now = Date.now();
    if (form.startDate && now < Date.parse(form.startDate)) {
      throw forbidden("This form is not yet accepting responses");
    }
    if (form.endDate && now > Date.parse(form.endDate)) {
      throw forbidden("This form is no longer accepting responses");
    }

    return form;
  },

  async create(admin: CurrentUser, input: CreateFormInput) {
    if (input.folderId !== undefined) {
      await assertFolderOwnership(input.folderId, admin.id);
    }

    return db.transaction(async (tx) => {
      const [form] = await tx
        .insert(forms)
        .values({
          adminId: admin.id,
          folderId: input.folderId ?? null,
          organizationId: admin.organizationId,
          formTitle: input.formTitle,
          formDescription: input.formDescription,
          status: input.status,
          accessType: input.accessType,
          recordName: input.recordName,
          oneResponsePerPerson: input.oneResponsePerPerson,
          startDate: input.startDate,
          endDate: input.endDate,
        })
        .returning();

      for (const [index, field] of input.fields.entries()) {
        const [insertedField] = await tx
          .insert(formFields)
          .values({
            formId: form!.id,
            fieldLabel: field.fieldLabel,
            fieldType: field.fieldType,
            isRequired: field.isRequired,
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

    const { allowedEmails, ...rest } = input;

    return db.transaction(async (tx) => {
      let updated = existing;

      // Any edit here (settings or the allowed-users list) bumps updated_at.
      if (Object.keys(rest).length > 0) {
        const [row] = await tx
          .update(forms)
          .set({ ...rest, updatedAt: nowIso() })
          .where(eq(forms.id, id))
          .returning();
        updated = row!;
      } else if (allowedEmails) {
        const [row] = await tx
          .update(forms)
          .set({ updatedAt: nowIso() })
          .where(eq(forms.id, id))
          .returning();
        updated = row!;
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
          isRequired: input.isRequired,
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
