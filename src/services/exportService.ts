import ExcelJS from "exceljs";

import { asc, eq } from "drizzle-orm";

import { db, submissions } from "../db/client";
import { resolveTimeZone } from "../utils/timezone";
import { analyticsService } from "./analyticsService";
import { requireFormAccess } from "./formAccess";
import { loadResponseRecords } from "./responseRecords";

export type ExportFormat = "xlsx" | "csv";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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

/** The exports' table header: white bold on the brand blue. */
function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E55C5" } };
  });
}

/** The instant's wall clock in `timeZone` as a Date read as UTC — Excel then shows that local time. */
function localDate(iso: string, timeZone: string): Date {
  return new Date(`${formatLocal(iso, timeZone).replace(" ", "T")}Z`);
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

    styleHeader(sheet.addRow(["Option", "Count", "%"]));
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

// ── Themes (AI analysis) ─────────────────────────────────────────────────

type Cell = string | number | Date;

type ThemesTables = {
  /** Label / value rows: the form, the filters the numbers were taken under, totals. */
  summary: [string, Cell][];
  topics: { headers: string[]; rows: Cell[][] };
  feedback: { headers: string[]; rows: Cell[][] };
};

type Counts = { negative: number; neutral: number; positive: number };
const mentionsOf = (topic: Counts) => topic.negative + topic.neutral + topic.positive;

/** The Themes topic orders — mirrors gnp-client's components/dashboard/topicSort.ts; change both together. */
export const TOPIC_SORTS = {
  priority: { label: "Priority", compare: (a: Counts, b: Counts) => b.negative - a.negative || mentionsOf(b) - mentionsOf(a) },
  negative: { label: "Most negative", compare: (a: Counts, b: Counts) => b.negative - a.negative || mentionsOf(b) - mentionsOf(a) },
  mentions: { label: "Most mentioned", compare: (a: Counts, b: Counts) => mentionsOf(b) - mentionsOf(a) || b.negative - a.negative },
  positive: { label: "Most positive", compare: (a: Counts, b: Counts) => b.positive - a.positive || mentionsOf(b) - mentionsOf(a) },
} as const;
export type TopicSort = keyof typeof TOPIC_SORTS;
export const isTopicSort = (value: unknown): value is TopicSort =>
  typeof value === "string" && Object.hasOwn(TOPIC_SORTS, value);

type ThemesExportOptions = {
  sort: TopicSort;
  from?: number;
  to?: number;
  demo?: Record<string, string[]>;
  timeZone?: string;
  includeNames: boolean;
};

/**
 * The Themes tab as tables, under the same date range and demographic filter the
 * viewer has on screen — from analyticsService.formThemes, so the numbers match.
 */
async function loadThemesTables(formId: number, adminId: number, opts: ThemesExportOptions): Promise<ThemesTables> {
  const timeZone = resolveTimeZone(opts.timeZone);
  const [form, themes, order] = await Promise.all([
    requireFormAccess(formId, adminId, "view"),
    analyticsService.formThemes(formId, adminId, { from: opts.from, to: opts.to, demo: opts.demo, timeZone }),
    // "Response #" as the Individual tab numbers them: 1 = the first submitted.
    db
      .select({ id: submissions.id })
      .from(submissions)
      .where(eq(submissions.formId, formId))
      .orderBy(asc(submissions.createdAt), asc(submissions.id)),
  ]);
  const responseNumber = new Map(order.map((row, index) => [row.id, index + 1]));
  // As the screen lists them: the chosen order, uncategorised last, and for Priority
  // violation topics first.
  const pinViolations = opts.sort === "priority";
  const pinRank = (topic: { id: string; hasViolation: boolean }) =>
    topic.id === "uncategorised" ? 2 : pinViolations && topic.hasViolation ? 0 : 1;
  const topics = [...themes.aiDiscoveredTopics].sort(
    (a, b) => pinRank(a) - pinRank(b) || TOPIC_SORTS[opts.sort].compare(a, b),
  );
  const share = (part: number, whole: number) => (whole > 0 ? part / whole : 0);

  const demoFilter = Object.entries(opts.demo ?? {})
    .filter(([, values]) => values.length > 0)
    .map(([label, values]) => `${label} = ${values.join(", ")}`)
    .join("; ");
  const { negative, neutral, positive } = themes.sentiment;
  const analysed = negative + neutral + positive;

  const summary: [string, Cell][] = [
    ["Form", form.formTitle?.trim() || "Untitled form"],
    ["Date range", themes.rangeLabel],
    ["Respondents", demoFilter || "Everyone"],
    ["Topics sorted by", `${TOPIC_SORTS[opts.sort].label}${pinViolations ? " (violations first)" : ""}`],
    ["Exported at", formatLocal(new Date().toISOString(), timeZone)],
    ["Responders in range", themes.totalResponders],
    ["Analysed feedback", analysed],
    ["Negative", share(negative, analysed)],
    ["Neutral", share(neutral, analysed)],
    ["Positive", share(positive, analysed)],
    ["Flagged as violation", topics.reduce((sum, topic) => sum + topic.feedbackSegment.filter((p) => p.violation).length, 0)],
  ];

  const topicRows = topics.map((topic) => {
    const mentions = topic.negative + topic.neutral + topic.positive;
    return [
      topic.label,
      mentions,
      topic.percentOfTotal / 100,
      topic.negative,
      share(topic.negative, mentions),
      topic.neutral,
      share(topic.neutral, mentions),
      topic.positive,
      share(topic.positive, mentions),
      topic.feedbackSegment.filter((point) => point.violation).length,
      topic.keywords.map((keyword) => keyword.text).join(", "),
      topic.aiSummary,
    ];
  });

  // One column per demographic question, so Excel can filter and pivot on it.
  const demoLabels = themes.demographicFilters.map((group) => group.label);
  const points = topics.flatMap((topic) => topic.feedbackSegment.map((point) => ({ topic: topic.label, point })));
  const withNames = opts.includeNames && points.some(({ point }) => point.respondentName);
  const feedbackRows = points.map(({ topic, point }) => [
    topic,
    point.sentiment,
    point.violation ? "Yes" : "No",
    point.quote,
    point.originalFeedback,
    localDate(point.submittedAt, timeZone),
    responseNumber.get(point.submissionId) ?? "",
    ...(withNames ? [point.respondentName ?? ""] : []),
    ...demoLabels.map((label) => point.demographics.find((demo) => demo.label === label)?.value ?? ""),
  ]);

  return {
    summary,
    topics: {
      headers: [
        "Topic",
        "Mentions",
        "% of total",
        "Negative",
        "Negative %",
        "Neutral",
        "Neutral %",
        "Positive",
        "Positive %",
        "Violations",
        "Keywords",
        "AI summary",
      ],
      rows: topicRows,
    },
    feedback: {
      headers: [
        "Topic",
        "Sentiment",
        "Violation",
        "AI quote",
        "Original feedback",
        "Submitted at",
        "Response #",
        ...(withNames ? ["Respondent"] : []),
        ...demoLabels,
      ],
      rows: feedbackRows,
    },
  };
}

function addThemesSummarySheet(workbook: ExcelJS.Workbook, summary: ThemesTables["summary"]) {
  const sheet = workbook.addWorksheet("Summary");
  sheet.columns = [{ width: 24 }, { width: 48 }];
  for (const [label, value] of summary) {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    if (["Negative", "Neutral", "Positive"].includes(label)) row.getCell(2).numFmt = "0%";
    row.getCell(2).alignment = { horizontal: "left", wrapText: true };
  }
}

/** A header row + data, frozen header, widths from the content; `formats` by 1-based column. */
function addTableSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  table: { headers: string[]; rows: Cell[][] },
  formats: Record<number, string> = {},
) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  styleHeader(sheet.addRow(table.headers));
  for (const row of table.rows) sheet.addRow(row);

  for (const [column, format] of Object.entries(formats)) sheet.getColumn(Number(column)).numFmt = format;
  table.headers.forEach((header, index) => {
    const longest = Math.max(
      header.length,
      ...table.rows.map((row) => {
        const cell = row[index];
        return cell instanceof Date ? 19 : String(cell ?? "").length;
      }),
    );
    const column = sheet.getColumn(index + 1);
    column.width = Math.min(Math.max(longest + 2, 10), 60);
    if (longest > 60) column.alignment = { wrapText: true, vertical: "top" };
  });
}

async function themesToXlsx(tables: ThemesTables): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  addThemesSummarySheet(workbook, tables.summary);
  addTableSheet(workbook, "Topics", tables.topics, { 3: "0%", 5: "0%", 7: "0%", 9: "0%" });
  addTableSheet(workbook, "Feedback", tables.feedback, { 6: "yyyy-mm-dd hh:mm:ss" });
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
    return { buffer: await toXlsx(table, summary), contentType: XLSX_TYPE };
  },

  /** The Themes tab (AI analysis) as xlsx: Summary, Topics, Feedback. */
  async exportThemes(formId: number, adminId: number, options: ThemesExportOptions) {
    const tables = await loadThemesTables(formId, adminId, options);
    return { buffer: await themesToXlsx(tables), contentType: XLSX_TYPE };
  },
};
