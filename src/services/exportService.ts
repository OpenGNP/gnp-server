import ExcelJS from "exceljs";

import { resolveTimeZone } from "../utils/timezone";
import { analyticsService } from "./analyticsService";
import { requireFormAccess } from "./formAccess";
import { loadResponseRecords } from "./responseRecords";

export type ExportFormat = "xlsx" | "csv";

type ResponseTable = { headers: string[]; rows: { submittedAt: string; cells: string[] }[] };

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
  const { fields, records } = await loadResponseRecords(formId, adminId);

  const withNames = includeNames && records.some((record) => record.respondentName);
  const headers = ["Submitted at", ...(withNames ? ["Respondent"] : []), ...fields.map((field) => field.title)];
  const rows = records.map((record) => ({
    submittedAt: record.submittedAt ? formatLocal(record.submittedAt, timeZone) : "",
    cells: [
      ...(withNames ? [record.respondentName ?? ""] : []),
      ...fields.map((field) => record.answers.get(field.id)?.join(", ") ?? ""),
    ],
  }));

  return { headers, rows };
}

type SummaryTable = {
  title: string;
  totalResponses: number;
  exportedAt: string;
  questions: { title: string; note: string | null; rows: { label: string; count: number; share: number }[] }[];
};

/** Option counts per choice question — the Response tab's charts as tables. Free-text answers live in the raw sheet. */
async function loadSummaryTable(formId: number, adminId: number, timeZone: string): Promise<SummaryTable> {
  const form = await requireFormAccess(formId, adminId, "view");
  const analytics = await analyticsService.formResponses(formId, adminId);

  const questions = [...analytics.demographic, ...analytics.feedback].flatMap((breakdown) => {
    if (breakdown.kind === "text") return [];
    // Same denominators as the dashboard cards: answers to a single-choice question,
    // respondents to a multi-choice one (whose shares can sum past 100%).
    const base =
      breakdown.kind === "multi-choice"
        ? breakdown.totalRespondents
        : breakdown.options.reduce((sum, option) => sum + option.value, 0);
    return [
      {
        title: breakdown.title,
        note: breakdown.kind === "multi-choice" ? `${base} respondents, could select more than one` : null,
        rows: breakdown.options.map((option) => ({
          label: option.label,
          count: option.value,
          share: base > 0 ? option.value / base : 0,
        })),
      },
    ];
  });

  return {
    title: form.formTitle?.trim() || "Responses",
    totalResponses: analytics.totalResponses,
    exportedAt: formatLocal(new Date().toISOString(), timeZone),
    questions,
  };
}

function addResponsesSheet(workbook: ExcelJS.Workbook, table: ResponseTable) {
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
}

function addSummarySheet(workbook: ExcelJS.Workbook, summary: SummaryTable) {
  const sheet = workbook.addWorksheet("Summary");
  sheet.columns = [{ width: 40 }, { width: 12 }, { width: 12 }];

  sheet.addRow(["Form", summary.title]).getCell(1).font = { bold: true };
  sheet.addRow(["Total responses", summary.totalResponses]).getCell(1).font = { bold: true };
  sheet.addRow(["Exported at", summary.exportedAt]).getCell(1).font = { bold: true };

  for (const question of summary.questions) {
    sheet.addRow([]);
    sheet.addRow([question.title]).font = { bold: true };
    if (question.note) sheet.addRow([question.note]).font = { italic: true, color: { argb: "FF6B7280" } };

    const header = sheet.addRow(["Option", "Count", "%"]);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E55C5" } };
    });
    for (const row of question.rows) {
      sheet.addRow([row.label, row.count, row.share]).getCell(3).numFmt = "0%";
    }
  }
}

async function toXlsx(table: ResponseTable, summary: SummaryTable): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  addResponsesSheet(workbook, table);
  addSummarySheet(workbook, summary);
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
  return Buffer.from(`\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}

export const exportService = {
  async exportResponses(
    formId: number,
    adminId: number,
    format: ExportFormat,
    options: { timeZone?: string; includeNames: boolean },
  ) {
    const timeZone = resolveTimeZone(options.timeZone);
    if (format === "csv") {
      const table = await loadResponseTable(formId, adminId, timeZone, options.includeNames);
      return { buffer: toCsv(table), contentType: "text/csv; charset=utf-8" };
    }

    const [table, summary] = await Promise.all([
      loadResponseTable(formId, adminId, timeZone, options.includeNames),
      loadSummaryTable(formId, adminId, timeZone),
    ]);
    return {
      buffer: await toXlsx(table, summary),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  },
};
