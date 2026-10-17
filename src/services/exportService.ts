import ExcelJS from "exceljs";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { answers, db, fieldOptions, formFields, submissions, users } from "../db/client";
import { requireFormAccess } from "./formAccess";
import { resolveTimeZone } from "../utils/timezone";

export type ExportFormat = "xlsx" | "csv";

type ResponseTable = { title: string; headers: string[]; rows: { submittedAt: string; cells: string[] }[] };

/** "2026-10-17 14:05:09" — the instant's wall-clock time in `timeZone`. */
function formatLocal(iso: string, timeZone: string): string {
  const parts: Record<string, string> = {};
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  for (const part of format.formatToParts(new Date(iso))) parts[part.type] = part.value;
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/** One row per submission, one column per field (form order); multi-select answers joined with ", ". */
async function loadResponseTable(
  formId: number,
  adminId: number,
  timeZone: string,
  includeNames: boolean,
): Promise<ResponseTable> {
  const form = await requireFormAccess(formId, adminId, "view");

  const fields = await db
    .select({ id: formFields.id, label: formFields.fieldLabel, type: formFields.fieldType })
    .from(formFields)
    .where(and(eq(formFields.formId, formId), isNull(formFields.deletedAt)))
    .orderBy(asc(formFields.fieldOrder), asc(formFields.id));

  const subs = await db
    .select({
      id: submissions.id,
      createdAt: submissions.createdAt,
      respondentName: sql<string | null>`coalesce(nullif(${submissions.respondentName}, ''), nullif(${users.fullName}, ''), ${users.email})`,
    })
    .from(submissions)
    .leftJoin(users, eq(submissions.userId, users.id))
    .where(eq(submissions.formId, formId))
    .orderBy(asc(submissions.createdAt), asc(submissions.id));

  const answerRows = subs.length
    ? await db
        .select({
          submissionId: answers.submissionId,
          fieldId: answers.fieldId,
          text: answers.answerText,
          option: fieldOptions.optionLabel,
          optionOrder: fieldOptions.optionOrder,
        })
        .from(answers)
        .leftJoin(fieldOptions, eq(answers.answerOptionId, fieldOptions.id))
        .where(inArray(answers.submissionId, subs.map((sub) => sub.id)))
        .orderBy(asc(answers.submissionId), asc(fieldOptions.optionOrder), asc(answers.id))
    : [];

  // submissionId → fieldId → values; a free-text answer on a choice field is its "Other".
  const choiceFields = new Set(
    fields.filter((field) => field.type === "radio" || field.type === "checkbox").map((field) => field.id),
  );
  const values = new Map<number, Map<number, string[]>>();
  for (const row of answerRows) {
    const value = row.option ?? (row.text ? (choiceFields.has(row.fieldId) ? `Other: ${row.text}` : row.text) : null);
    if (value === null) continue;
    const byField = values.get(row.submissionId) ?? new Map<number, string[]>();
    byField.set(row.fieldId, [...(byField.get(row.fieldId) ?? []), value]);
    values.set(row.submissionId, byField);
  }

  const withNames = includeNames && subs.some((sub) => sub.respondentName);
  const headers = [
    "Submitted at",
    ...(withNames ? ["Respondent"] : []),
    ...fields.map((field, index) => field.label?.trim() || `Question ${index + 1}`),
  ];

  const rows = subs.map((sub) => {
    const byField = values.get(sub.id);
    return {
      submittedAt: sub.createdAt ? formatLocal(sub.createdAt, timeZone) : "",
      cells: [
        ...(withNames ? [sub.respondentName ?? ""] : []),
        ...fields.map((field) => byField?.get(field.id)?.join(", ") ?? ""),
      ],
    };
  });

  return { title: form.formTitle?.trim() || "Responses", headers, rows };
}

async function toXlsx(table: ResponseTable): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Responses", { views: [{ state: "frozen", ySplit: 1 }] });

  sheet.addRow(table.headers).font = { bold: true };
  for (const row of table.rows) {
    // Wall-clock string read as UTC, so Excel shows the viewer's local time.
    const submittedAt = row.submittedAt ? new Date(`${row.submittedAt.replace(" ", "T")}Z`) : "";
    sheet.addRow([submittedAt, ...row.cells]);
  }

  sheet.getColumn(1).numFmt = "yyyy-mm-dd hh:mm:ss";
  sheet.columns.forEach((column, index) => {
    const longest = Math.max(
      table.headers[index]?.length ?? 0,
      ...table.rows.map((row) => (index === 0 ? 19 : (row.cells[index - 1]?.length ?? 0))),
    );
    column.width = Math.min(Math.max(longest + 2, 12), 60);
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function csvCell(value: string): string {
  // Neutralise spreadsheet formulas in respondent text (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function toCsv(table: ResponseTable): Buffer {
  const lines = [table.headers, ...table.rows.map((row) => [row.submittedAt, ...row.cells])].map((cells) =>
    cells.map(csvCell).join(","),
  );
  // BOM so Excel opens Thai text as UTF-8.
  return Buffer.from(`﻿${lines.join("\r\n")}\r\n`, "utf8");
}

export const exportService = {
  async exportResponses(
    formId: number,
    adminId: number,
    format: ExportFormat,
    options: { timeZone?: string; includeNames: boolean },
  ) {
    const table = await loadResponseTable(formId, adminId, resolveTimeZone(options.timeZone), options.includeNames);
    return format === "xlsx"
      ? {
          buffer: await toXlsx(table),
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }
      : { buffer: toCsv(table), contentType: "text/csv; charset=utf-8" };
  },
};
