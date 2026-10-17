import { asc, eq, sql } from "drizzle-orm";

import { answers, db, fieldOptions, formFields, submissions, users } from "../db/client";
import { normalizeDbTimestamp } from "../utils/timestamp";
import { requireFormAccess } from "./formAccess";

export type ResponseField = { id: number; title: string; section: "demographic" | "feedback"; type: string };

export type ResponseRecord = {
  id: number;
  /** ISO 8601; null only for legacy rows. */
  submittedAt: string | null;
  respondentName: string | null;
  /** fieldId → answer values; multi-select has several, "Other" text is prefixed. */
  answers: Map<number, string[]>;
};

/**
 * Every submission of a form with its answers resolved to labels, oldest first — the
 * shared source for the Individual tab and the raw-data export. Like the dashboard,
 * removed questions stay (flagged) while they still hold answers.
 */
export async function loadResponseRecords(formId: number, adminId: number) {
  const form = await requireFormAccess(formId, adminId, "view");

  const [allFields, subs, answerRows] = await Promise.all([
    db
      .select({
        id: formFields.id,
        label: formFields.fieldLabel,
        type: formFields.fieldType,
        section: formFields.section,
        deletedAt: formFields.deletedAt,
      })
      .from(formFields)
      .where(eq(formFields.formId, formId))
      .orderBy(asc(formFields.fieldOrder), asc(formFields.id)),
    db
      .select({
        id: submissions.id,
        createdAt: submissions.createdAt,
        respondentName: sql<string | null>`coalesce(nullif(${submissions.respondentName}, ''), nullif(${users.fullName}, ''), ${users.email})`,
      })
      .from(submissions)
      .leftJoin(users, eq(submissions.userId, users.id))
      .where(eq(submissions.formId, formId))
      .orderBy(asc(submissions.createdAt), asc(submissions.id)),
    db
      .select({
        submissionId: answers.submissionId,
        fieldId: answers.fieldId,
        text: answers.answerText,
        option: fieldOptions.optionLabel,
      })
      .from(answers)
      .innerJoin(submissions, eq(answers.submissionId, submissions.id))
      .leftJoin(fieldOptions, eq(answers.answerOptionId, fieldOptions.id))
      .where(eq(submissions.formId, formId))
      .orderBy(asc(answers.submissionId), asc(fieldOptions.optionOrder), asc(answers.id)),
  ]);

  const answeredFields = new Set(answerRows.map((row) => row.fieldId));
  const kept = allFields.filter((field) => !field.deletedAt || answeredFields.has(field.id));
  const fields: ResponseField[] = kept.map((field, index) => ({
    id: field.id,
    title: `${field.label?.trim() || `Question ${index + 1}`}${field.deletedAt ? " (removed)" : ""}`,
    section: field.section === "demographic" ? "demographic" : "feedback",
    type: field.type ?? "text",
  }));

  // A free-text answer on a choice field is its "Other".
  const choiceFields = new Set(
    fields.filter((field) => field.type === "radio" || field.type === "checkbox").map((field) => field.id),
  );
  const bySubmission = new Map<number, Map<number, string[]>>();
  for (const row of answerRows) {
    const value = row.option ?? (row.text ? (choiceFields.has(row.fieldId) ? `Other: ${row.text}` : row.text) : null);
    if (value === null) continue;
    const byField = bySubmission.get(row.submissionId) ?? new Map<number, string[]>();
    byField.set(row.fieldId, [...(byField.get(row.fieldId) ?? []), value]);
    bySubmission.set(row.submissionId, byField);
  }

  const records: ResponseRecord[] = subs.map((sub) => ({
    id: sub.id,
    submittedAt: sub.createdAt ? normalizeDbTimestamp(sub.createdAt) : null,
    respondentName: sub.respondentName,
    answers: bySubmission.get(sub.id) ?? new Map(),
  }));

  return { form, fields, records };
}
