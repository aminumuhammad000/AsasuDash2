import { parse as parseCsv } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { nanoid } from "nanoid";
import type { AgentRole, PaymentSchedule, PaymentScheduleEntry, UploadPreviewRow } from "@asasu/shared";
import { COMMISSION_RATES, PROCESSING_FEE, calculateCommission, nowIso, roundCurrency, scheduleTotals } from "./domain.js";
import type { StoredUser } from "./domain.js";
import { matchUploadedRow } from "./matcher.js";

type Cell = string | number | boolean | null | undefined;

export interface UploadedClaimRow {
  id: string;
  clientName: string;
  serviceCharge: number;
  processingFeeApplied: boolean;
}

function cleanHeader(value: Cell) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\w%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asNumber(value: Cell): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const numeric = String(value ?? "")
    .replace(/[₦,\s]/g, "")
    .replace(/[^\d.-]/g, "");
  if (!numeric) {
    return undefined;
  }
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asText(value: Cell) {
  return String(value ?? "").trim();
}

function findHeaderIndex(headers: string[], candidates: string[]) {
  return headers.findIndex((header) => candidates.some((candidate) => header.includes(candidate)));
}

function findHeaderIndexByPriority(headers: string[], candidates: string[]) {
  for (const candidate of candidates) {
    const index = headers.findIndex((header) => header.includes(candidate));
    if (index >= 0) {
      return index;
    }
  }
  return -1;
}

function findHeaderRow(rows: Cell[][]) {
  return rows.findIndex((row) => {
    const headers = row.map(cleanHeader);
    const hasClient = findHeaderIndex(headers, ["acct name", "account name", "client name", "customer name", "name"]) >= 0;
    const hasAmount = findHeaderIndex(headers, ["service charge", "serv chg", "1% serv", "2% serv", "rsa amount", "equity", "0 01"]) >= 0;
    return hasClient && hasAmount;
  });
}

function unwrapCell(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value && "result" in value) {
    return unwrapCell((value as { result?: unknown }).result);
  }
  if (typeof value === "object" && value && "richText" in value) {
    return (value as { richText?: Array<{ text?: string }> }).richText?.map((part) => part.text ?? "").join("") ?? "";
  }
  return String(value);
}

function inferBranch(lines: string[], sheetName: string) {
  const source = [...lines, sheetName].join(" ").toUpperCase();
  if (source.includes("ABUJA")) return "Abuja";
  if (source.includes("YOLA")) return "Yola";
  return sheetName.replace(/\b(ASASU|REALTY|TRANSACTIONS?|RSA|25%)\b/gi, " ").replace(/\s+/g, " ").trim() || "All branches";
}

function inferPaymentDate(lines: string[]) {
  const source = lines.join(" ").toUpperCase();
  const monthNames: Record<string, number> = {
    JANUARY: 1,
    FEBRUARY: 2,
    MARCH: 3,
    APRIL: 4,
    MAY: 5,
    JUNE: 6,
    JULY: 7,
    AUGUST: 8,
    SEPTEMBER: 9,
    OCTOBER: 10,
    NOVEMBER: 11,
    DECEMBER: 12
  };
  const match = source.match(/(\d{1,2})(?:ST|ND|RD|TH)?\s+(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+(20\d{2})/);
  if (!match) return nowIso().slice(0, 10);
  const [, day, month, year] = match;
  return `${year}-${String(monthNames[month!] ?? 1).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
}

function scheduleNumber(branch: string, paymentDate: string) {
  return `AS-${branch.slice(0, 3).toUpperCase()}-${paymentDate.replaceAll("-", "")}`;
}

async function workbookRows(buffer: Buffer, filename = "") {
  const text = buffer.toString("utf8");

  if (text.trim().startsWith("<")) {
    throw new Error("Invalid file format. The uploaded file is an HTML page or document, not an Excel workbook or CSV.");
  }

  // 1. Try parsing as Excel (.xlsx / .xls)
  try {
    const workbook = new ExcelJS.Workbook();
    const excelInput = buffer as unknown as Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(excelInput);
    if (workbook.worksheets.length > 0) {
      return workbook.worksheets.map((worksheet) => {
        const rows: Cell[][] = [];
        worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
          const values = Array.isArray(row.values) ? row.values.slice(1) : [];
          rows[rowNumber - 1] = values.map(unwrapCell);
        });
        return { sheetName: worksheet.name, rows };
      });
    }
  } catch {
    // If Excel load failed, attempt CSV fallback below
  }

  // 2. Parse as CSV (fallback for plain text / .csv files or exported sheets)
  try {
    const rows = parseCsv(text, {
      skip_empty_lines: false,
      relax_column_count: true
    }) as Cell[][];
    if (rows && rows.length > 0) {
      return [{ sheetName: filename || "Sheet1", rows }];
    }
  } catch {
    // CSV parse failed as well
  }

  throw new Error("Unable to parse file. Please upload a valid Excel (.xlsx, .xls) or CSV document.");
}

export async function parseScheduleWorkbook(buffer: Buffer, user: StoredUser, title?: string, filename?: string): Promise<PaymentSchedule> {
  const scheduleId = `sch_${nanoid(10)}`;
  const entries: PaymentScheduleEntry[] = [];
  const sheets = await workbookRows(buffer, filename);
  const branches = new Set<string>();
  const paymentDates = new Set<string>();
  const warnings: string[] = [];

  for (const sheet of sheets) {
    const headerRowIndex = findHeaderRow(sheet.rows);
    if (headerRowIndex < 0) {
      continue;
    }

    const headerRow = sheet.rows[headerRowIndex];
    if (!headerRow) {
      continue;
    }

    const headers = headerRow.map(cleanHeader);
    const headingLines = sheet.rows
      .slice(0, headerRowIndex)
      .flatMap((row) => row.map(asText))
      .filter(Boolean);
    const branch = inferBranch(headingLines, sheet.sheetName);
    const paymentDate = inferPaymentDate(headingLines);
    branches.add(branch);
    paymentDates.add(paymentDate);
    const accountIndex = findHeaderIndex(headers, ["acct no", "account no", "account number"]);
    const clientIndex = findHeaderIndex(headers, ["acct name", "account name", "client name", "customer name"]);
    const rsaIndex = findHeaderIndex(headers, ["rsa amount", "principal", "amount"]);
    const threePctIndex = findHeaderIndex(headers, ["3% serv", "3 % serv", "3 service"]);
    const onePctIndex = findHeaderIndex(headers, ["1% serv", "1 % serv"]);
    const twoPctIndex = findHeaderIndex(headers, ["2% serv", "2 % serv"]);
    const netIndex = findHeaderIndex(headers, ["net"]);
    if (clientIndex < 0) {
      continue;
    }

    for (let index = headerRowIndex + 1; index < sheet.rows.length; index += 1) {
      const row = sheet.rows[index];
      if (!row) {
        continue;
      }
      const firstCell = asText(row[0]);
      const clientName = asText(row[clientIndex]);
      if (!clientName || firstCell.toUpperCase() === "TOTAL" || clientName.toUpperCase() === "TOTAL") {
        continue;
      }

      const onePercentServiceCharge = onePctIndex >= 0 ? asNumber(row[onePctIndex]) : undefined;
      const twoPercentServiceCharge = twoPctIndex >= 0 ? asNumber(row[twoPctIndex]) : undefined;
      const threePercentServiceCharge = threePctIndex >= 0 ? asNumber(row[threePctIndex]) : undefined;
      const serviceCharge = onePercentServiceCharge ?? threePercentServiceCharge ?? asNumber(row[rsaIndex]) ?? 0;

      if (!serviceCharge) {
        continue;
      }

      entries.push({
        id: `sch_ent_${nanoid(10)}`,
        scheduleId,
        sourceSheet: sheet.sheetName,
        rowNumber: index + 1,
        serialNumber: firstCell || String(entries.length + 1),
        accountNo: accountIndex >= 0 ? asText(row[accountIndex]) : undefined,
        applicationNumber: accountIndex >= 0 ? asText(row[accountIndex]) : undefined,
        clientName,
        rsaAmount: rsaIndex >= 0 ? (asNumber(row[rsaIndex]) ?? 0) : 0,
        paymentDate,
        serviceCharge: roundCurrency(serviceCharge),
        threePercentServiceCharge: threePercentServiceCharge ? roundCurrency(threePercentServiceCharge) : undefined,
        onePercentServiceCharge: onePercentServiceCharge ? roundCurrency(onePercentServiceCharge) : undefined,
        twoPercentServiceCharge: twoPercentServiceCharge ? roundCurrency(twoPercentServiceCharge) : undefined,
        netAmount: netIndex >= 0 ? asNumber(row[netIndex]) : undefined
      });
    }
  }

  const duplicateAccounts = [...new Set(entries.map((entry) => entry.accountNo).filter((value): value is string => Boolean(value)))].filter(
    (accountNo) => entries.filter((entry) => entry.accountNo === accountNo).length > 1
  );
  if (duplicateAccounts.length) warnings.push(`${duplicateAccounts.length} duplicate account number${duplicateAccounts.length === 1 ? "" : "s"} detected.`);
  const missingAccounts = entries.filter((entry) => !entry.accountNo).length;
  if (missingAccounts) warnings.push(`${missingAccounts} row${missingAccounts === 1 ? " has" : "s have"} no account/application number.`);
  const missingAmounts = entries.filter((entry) => !entry.rsaAmount).length;
  if (missingAmounts) warnings.push(`${missingAmounts} row${missingAmounts === 1 ? " has" : "s have"} no RSA amount and cannot be claimed.`);

  const branch = branches.size === 1 ? [...branches][0]! : "Multiple branches";
  const paymentDate = [...paymentDates].sort().at(-1) ?? nowIso().slice(0, 10);
  const totals = scheduleTotals(entries);
  const uploadedAt = nowIso();

  return {
    id: scheduleId,
    title: title || `${branch} payment schedule · ${paymentDate}`,
    scheduleNumber: scheduleNumber(branch, paymentDate),
    branch,
    bankName: "Adamawa Mortgage Bank",
    paymentDate,
    sourceFileName: filename,
    status: "PUBLISHED",
    uploadedBy: user.id,
    uploadedAt,
    publishedAt: uploadedAt,
    entryCount: entries.length,
    ...totals,
    importWarnings: warnings,
    entries
  };
}

export async function parseClaimWorkbook(buffer: Buffer, filename: string | undefined, role: AgentRole): Promise<UploadedClaimRow[]> {
  const sheets = await workbookRows(buffer, filename);
  const rows: UploadedClaimRow[] = [];

  for (const sheet of sheets) {
    const headerRowIndex = findHeaderRow(sheet.rows);
    if (headerRowIndex < 0) {
      continue;
    }

    const headerRow = sheet.rows[headerRowIndex];
    if (!headerRow) {
      continue;
    }

    const headers = headerRow.map(cleanHeader);
    const clientIndex = findHeaderIndex(headers, ["client name", "acct name", "account name", "customer name", "name"]);
    const roleSpecificCandidates = role === "SUB_DEVELOPER" ? ["2% serv", "2 % serv"] : ["1% serv", "1 % serv"];
    const serviceChargeIndex = findHeaderIndexByPriority(headers, [
      ...roleSpecificCandidates,
      "service charge",
      "service charges",
      "serv chg",
      "3% serv",
      "0 01",
      "equity",
      "amount"
    ]);
    if (clientIndex < 0 || serviceChargeIndex < 0) {
      continue;
    }

    for (let index = headerRowIndex + 1; index < sheet.rows.length; index += 1) {
      const row = sheet.rows[index];
      if (!row) {
        continue;
      }
      const firstCell = asText(row[0]);
      const clientName = asText(row[clientIndex]);
      const serviceCharge = asNumber(row[serviceChargeIndex]);
      if (!clientName || !serviceCharge || firstCell.toUpperCase() === "TOTAL" || clientName.toUpperCase() === "TOTAL") {
        continue;
      }

      rows.push({
        id: `upl_${nanoid(10)}`,
        clientName,
        serviceCharge: roundCurrency(serviceCharge),
        processingFeeApplied: false
      });
    }
  }

  return rows;
}

export function createPreviewRows(
  rows: UploadedClaimRow[],
  role: AgentRole,
  scheduleEntries: PaymentScheduleEntry[]
): UploadPreviewRow[] {
  return rows.map((row) => {
    const comparison = matchUploadedRow(row, role, scheduleEntries);
    const commissionRate = COMMISSION_RATES[role];
    const processingFeeAmount = role === "SUB_DEVELOPER" && row.processingFeeApplied ? PROCESSING_FEE : 0;
    return {
      ...row,
      commissionRate,
      commissionAmount: calculateCommission(comparison.officialAmount ?? row.serviceCharge, commissionRate),
      processingFeeAmount,
      comparison
    };
  });
}
