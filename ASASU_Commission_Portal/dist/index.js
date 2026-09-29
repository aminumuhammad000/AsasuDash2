// src/index.ts
import dotenv from "dotenv";
import http from "http";
import fs2 from "fs";
import fsPromises from "fs/promises";
import path2 from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { Server } from "socket.io";
import { v2 as cloudinary } from "cloudinary";
import { nanoid as nanoid2 } from "nanoid";
import { z } from "zod";

// src/domain.ts
var COMMISSION_RATES = {
  AGENT: 0.01,
  SUB_DEVELOPER: 0.02
};
var SUB_DEVELOPER_RATES = [0.015, 0.02];
var PROCESSING_FEE = 0;
var STAFF_ROLES = ["SUPER_ADMIN", "ADMIN", "FINANCE", "OPERATIONS", "AUDITOR", "SUPPORT", "BRANCH_ADMIN"];
function isStaffRole(role) {
  return STAFF_ROLES.includes(role);
}
function isAgentRole(role) {
  return role === "AGENT" || role === "SUB_DEVELOPER";
}
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
function normalizeName(value) {
  return value.toUpperCase().normalize("NFKD").replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}
function publicUser(user) {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}
function allowedCommissionRate(role, requestedRate) {
  if (role === "AGENT") return COMMISSION_RATES.AGENT;
  return SUB_DEVELOPER_RATES.includes(requestedRate) ? requestedRate : COMMISSION_RATES.SUB_DEVELOPER;
}
function calculateCommission(rsaAmount, rate) {
  return roundCurrency(rsaAmount * rate);
}
function getClaimRollups(items) {
  const totalRsaAmount = roundCurrency(items.reduce((sum, item) => sum + item.rsaAmount, 0));
  const totalServiceCharge = roundCurrency(items.reduce((sum, item) => sum + item.serviceCharge, 0));
  const commissionAmount = roundCurrency(items.reduce((sum, item) => sum + item.commissionAmount, 0));
  const processingFeeAmount = roundCurrency(items.reduce((sum, item) => sum + item.processingFeeAmount, 0));
  const totalPayable = roundCurrency(commissionAmount + processingFeeAmount);
  const matchScore = Math.round(items.reduce((sum, item) => sum + item.comparison.matchScore, 0) / Math.max(items.length, 1));
  return { totalRsaAmount, totalServiceCharge, commissionAmount, processingFeeAmount, totalPayable, matchScore };
}
function initialClaimStatus(items) {
  return items.every((item) => item.comparison.status === "MATCHED") ? "PENDING_VERIFICATION" : "NEEDS_REVIEW";
}
function latestSchedule(schedules) {
  return [...schedules].filter((schedule) => schedule.status === "PUBLISHED").sort((a, b) => (b.publishedAt ?? b.uploadedAt).localeCompare(a.publishedAt ?? a.uploadedAt))[0];
}
function calculateDashboardMetrics(user, users, claims, payments, schedules, disputes) {
  const admin = isStaffRole(user.role);
  const scopedClaims2 = admin ? claims : claims.filter((claim) => claim.userId === user.id);
  const earnedClaims = admin ? scopedClaims2 : scopedClaims2.filter((claim) => ["APPROVED", "PARTIALLY_APPROVED", "PAID"].includes(claim.status));
  const pendingStatuses = ["PENDING_VERIFICATION", "NEEDS_REVIEW", "INFO_REQUESTED", "PARTIALLY_APPROVED"];
  const thisMonth = nowIso().slice(0, 7);
  const today = nowIso().slice(0, 10);
  const activeEntryIds = new Set(
    claims.filter((claim) => claim.status !== "REJECTED").flatMap((claim) => claim.items.filter((item) => item.status !== "REJECTED").map((item) => item.scheduleEntryId))
  );
  const approvalDurations = claims.filter((claim) => ["APPROVED", "PAID", "PARTIALLY_APPROVED"].includes(claim.status)).map((claim) => (new Date(claim.updatedAt).getTime() - new Date(claim.createdAt).getTime()) / 36e5).filter((duration) => Number.isFinite(duration) && duration >= 0);
  const metrics = {
    totalCommissionEarned: roundCurrency(earnedClaims.reduce((sum, claim) => sum + claim.commissionAmount, 0)),
    pendingClaims: scopedClaims2.filter((claim) => pendingStatuses.includes(claim.status)).length,
    approvedClaims: scopedClaims2.filter((claim) => ["APPROVED", "PAID", "PARTIALLY_APPROVED"].includes(claim.status)).length,
    totalPaid: roundCurrency(scopedClaims2.filter((claim) => claim.status === "PAID").reduce((sum, claim) => sum + claim.totalPayable, 0)),
    totalProcessingFeesEarned: roundCurrency(scopedClaims2.reduce((sum, claim) => sum + claim.processingFeeAmount, 0)),
    availableClients: (latestSchedule(schedules)?.entries ?? []).filter((entry) => !activeEntryIds.has(entry.id)).length
  };
  if (admin) {
    metrics.totalAgents = users.filter((item) => item.role === "AGENT").length;
    metrics.totalSubDevelopers = users.filter((item) => item.role === "SUB_DEVELOPER").length;
    metrics.totalClaimsPending = claims.filter((claim) => pendingStatuses.includes(claim.status)).length;
    metrics.totalCommissionsPaidThisMonth = roundCurrency(
      payments.filter((payment) => payment.paidAt.startsWith(thisMonth)).reduce((sum, payment) => sum + payment.amount, 0)
    );
    metrics.totalProcessingFeesCollected = roundCurrency(claims.reduce((sum, claim) => sum + claim.processingFeeAmount, 0));
    metrics.schedulesUploaded = schedules.length;
    metrics.openDisputes = disputes.filter((dispute) => ["OPEN", "UNDER_REVIEW"].includes(dispute.status)).length;
    metrics.averageApprovalHours = approvalDurations.length ? roundCurrency(approvalDurations.reduce((sum, duration) => sum + duration, 0) / approvalDurations.length) : 0;
    metrics.paidToday = roundCurrency(payments.filter((payment) => payment.paidAt.startsWith(today)).reduce((sum, payment) => sum + payment.amount, 0));
  }
  return metrics;
}
function buildTrends(user, claims) {
  const monthKeys = Array.from({ length: 6 }, (_, index) => {
    const date = /* @__PURE__ */ new Date();
    date.setMonth(date.getMonth() - (5 - index));
    return date.toISOString().slice(0, 7);
  });
  return monthKeys.map((key) => {
    const monthClaims = claims.filter((claim) => {
      const belongsToUser = isStaffRole(user.role) || claim.userId === user.id;
      return belongsToUser && claim.createdAt.startsWith(key);
    });
    return {
      month: key,
      commission: roundCurrency(monthClaims.reduce((sum, claim) => sum + claim.commissionAmount, 0)),
      processingFees: roundCurrency(monthClaims.reduce((sum, claim) => sum + claim.processingFeeAmount, 0)),
      paid: roundCurrency(monthClaims.filter((claim) => claim.status === "PAID").reduce((sum, claim) => sum + claim.totalPayable, 0))
    };
  });
}
function scheduleTotals(entries) {
  return {
    totalRsaAmount: roundCurrency(entries.reduce((sum, entry) => sum + entry.rsaAmount, 0)),
    totalServiceCharge: roundCurrency(entries.reduce((sum, entry) => sum + (entry.onePercentServiceCharge ?? entry.serviceCharge ?? 0), 0))
  };
}
function buildQuarterlyLeaderboards(users, claims, payments, periodCount = 8) {
  const now = /* @__PURE__ */ new Date();
  const currentQuarterIndex = now.getUTCFullYear() * 4 + Math.floor(now.getUTCMonth() / 3);
  const eligibleUsers = users.filter((user) => user.active && isAgentRole(user.role));
  const qualifiedStatuses = ["APPROVED", "PARTIALLY_APPROVED", "PAID"];
  return Array.from({ length: periodCount }, (_, offset) => {
    const quarterIndex = currentQuarterIndex - offset;
    const year = Math.floor(quarterIndex / 4);
    const quarter = quarterIndex % 4 + 1;
    const startsAt = new Date(Date.UTC(year, (quarter - 1) * 3, 1));
    const endsAt = new Date(Date.UTC(year, quarter * 3, 1));
    const inPeriod = (value) => {
      const time = new Date(value).getTime();
      return time >= startsAt.getTime() && time < endsAt.getTime();
    };
    const entries = eligibleUsers.map((partner) => {
      const partnerClaims = claims.filter((claim) => {
        const performanceDate = claim.paidAt ?? claim.updatedAt ?? claim.createdAt;
        return claim.userId === partner.id && qualifiedStatuses.includes(claim.status) && inPeriod(performanceDate);
      });
      const approvedItems = partnerClaims.flatMap(
        (claim) => claim.items.filter((item) => item.status === "APPROVED" || claim.status === "PAID" && item.status !== "REJECTED")
      );
      const commissionPaid = payments.filter((payment) => payment.userId === partner.id && inPeriod(payment.paidAt)).reduce((sum, payment) => sum + payment.amount, 0);
      return {
        rank: 0,
        userId: partner.id,
        name: partner.name,
        role: partner.role,
        agency: partner.agency,
        branch: partner.branch,
        verifiedSalesVolume: roundCurrency(approvedItems.reduce((sum, item) => sum + item.rsaAmount, 0)),
        commissionEarned: roundCurrency(approvedItems.reduce((sum, item) => sum + item.commissionAmount + item.processingFeeAmount, 0)),
        commissionPaid: roundCurrency(commissionPaid),
        approvedClients: approvedItems.length,
        approvedClaims: partnerClaims.length
      };
    });
    const ranked = (role) => entries.filter((entry) => entry.role === role).sort(
      (a, b) => b.verifiedSalesVolume - a.verifiedSalesVolume || b.approvedClients - a.approvedClients || b.commissionPaid - a.commissionPaid || a.name.localeCompare(b.name)
    ).map((entry, index) => ({ ...entry, rank: index + 1 }));
    return {
      key: `${year}-Q${quarter}`,
      label: `Q${quarter} ${year}`,
      year,
      quarter,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      agents: ranked("AGENT"),
      subDevelopers: ranked("SUB_DEVELOPER")
    };
  });
}

// src/auth.ts
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
var jwtSecret = process.env.JWT_SECRET || "asasudash_secret_2026";
async function verifyPassword(password, hash2) {
  return bcrypt.compare(password, hash2);
}
async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}
function signToken(user) {
  return jwt.sign({ sub: user.id, id: user.id, role: user.role, email: user.email, name: user.name }, jwtSecret, { expiresIn: "7d" });
}
function authMiddleware(store2) {
  return async (request, response, next) => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : void 0;
    if (!token) {
      response.status(401).json({ message: "Missing bearer token" });
      return;
    }
    try {
      const payload = jwt.verify(token, jwtSecret);
      const userId = payload.sub || payload.id || "";
      const userEmail = payload.email || "";
      const data = await store2.read();
      let user = data.users.find(
        (item) => (item.id === userId || userEmail && item.email.toLowerCase() === userEmail.toLowerCase()) && item.active
      );
      if (!user && (userEmail || userId)) {
        const rawRole = payload.role ? String(payload.role).toUpperCase() : "ADMIN";
        const normRole = rawRole === "SUPER_ADMIN" || rawRole === "ADMIN" || rawRole === "FINANCE" || rawRole === "OPERATIONS" || rawRole === "BRANCH_ADMIN" || rawRole === "SUPPORT" || rawRole === "AUDITOR" || rawRole === "SUB_DEVELOPER" ? rawRole : "AGENT";
        user = {
          id: userId || `usr_${Date.now()}`,
          name: payload.name || "Authenticated User",
          email: (userEmail || `user_${userId}@asasurealty.com`).toLowerCase(),
          role: normRole,
          agency: "ASASU Realty",
          active: true,
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          passwordHash: ""
        };
        data.users.push(user);
        await store2.write(data);
      }
      if (!user || !user.active) {
        response.status(401).json({ message: "User is inactive or does not exist" });
        return;
      }
      request.user = user;
      next();
    } catch (err) {
      console.warn("JWT verification failed in authMiddleware:", err);
      response.status(401).json({ message: "Invalid or expired token" });
    }
  };
}
function requireRole(...roles) {
  return (request, response, next) => {
    if (!request.user || !roles.includes(request.user.role)) {
      response.status(403).json({ message: "You do not have access to this action" });
      return;
    }
    next();
  };
}
function authResponse(user) {
  return { ...publicUser(user), token: signToken(user) };
}

// src/parser.ts
import { parse as parseCsv } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { nanoid } from "nanoid";

// src/matcher.ts
function tokenScore(left, right) {
  const leftTokens = new Set(normalizeName(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeName(right).split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}
function roleAmount(entry, role) {
  if (role === "SUB_DEVELOPER") {
    return entry.twoPercentServiceCharge ?? entry.rsaAmount * 0.02;
  }
  return entry.onePercentServiceCharge ?? entry.serviceCharge ?? entry.rsaAmount * 0.01;
}
function amountScore(uploadedAmount, officialAmount) {
  const delta = Math.abs(uploadedAmount - officialAmount);
  const base = Math.max(Math.abs(uploadedAmount), Math.abs(officialAmount), 1);
  return Math.max(0, 1 - delta / base);
}
function matchUploadedRow(row, role, scheduleEntries) {
  const candidates = scheduleEntries.map((entry) => {
    const officialAmount = roleAmount(entry, role);
    const name = tokenScore(row.clientName, entry.clientName);
    const amount = amountScore(row.serviceCharge, officialAmount);
    const score = Math.round((name * 0.7 + amount * 0.3) * 100);
    return { entry, officialAmount, name, amount, score };
  }).sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) {
    return {
      matchScore: 0,
      status: "NO_MATCH",
      notes: ["No official payment schedule has been uploaded yet."]
    };
  }
  const amountDelta = roundCurrency(row.serviceCharge - best.officialAmount);
  const isMatched = best.score >= 94 && best.amount >= 0.985 && best.name >= 0.75;
  const status = isMatched ? "MATCHED" : best.score >= 72 ? "NEEDS_REVIEW" : "NO_MATCH";
  const notes = [];
  if (isMatched) {
    notes.push("Client and amount matched the official schedule.");
  } else {
    if (best.name < 0.75) {
      notes.push("Client name only partially matches the closest official schedule row.");
    }
    if (best.amount < 0.985) {
      notes.push(`Uploaded amount differs from official amount by ${amountDelta.toLocaleString("en-NG")}.`);
    }
    if (status === "NO_MATCH") {
      notes.push("No reliable schedule match was found.");
    }
  }
  return {
    scheduleEntryId: best.entry.id,
    officialClientName: best.entry.clientName,
    officialAmount: best.officialAmount,
    amountDelta,
    matchScore: best.score,
    status,
    notes
  };
}

// src/parser.ts
function cleanHeader(value) {
  return String(value ?? "").toLowerCase().replace(/[^\w%]+/g, " ").replace(/\s+/g, " ").trim();
}
function asNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const numeric = String(value ?? "").replace(/[₦,\s]/g, "").replace(/[^\d.-]/g, "");
  if (!numeric) {
    return void 0;
  }
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? parsed : void 0;
}
function asText(value) {
  return String(value ?? "").trim();
}
function findHeaderIndex(headers, candidates) {
  return headers.findIndex(
    (header) => candidates.some((candidate) => header.includes(candidate) || header.length >= 3 && candidate.includes(header))
  );
}
function findHeaderIndexByPriority(headers, candidates) {
  for (const candidate of candidates) {
    const index = headers.findIndex((header) => header.includes(candidate) || header.length >= 3 && candidate.includes(header));
    if (index >= 0) {
      return index;
    }
  }
  return -1;
}
function findHeaderRow(rows) {
  const index = rows.findIndex((row) => {
    const headers = row.map(cleanHeader);
    const hasClient = findHeaderIndex(headers, ["client", "client name", "acct name", "account name", "customer", "customer name", "applicant", "applicant name", "beneficiary", "mortgagor", "name"]) >= 0;
    const hasAmount = findHeaderIndex(headers, ["rsa", "rsa amount", "rsa amt", "service charge", "serv chg", "1% serv", "2% serv", "3% serv", "equity", "amt", "amount", "contribution", "principal", "paid", "value", "total", "0 01"]) >= 0;
    return hasClient && hasAmount;
  });
  if (index >= 0) return index;
  return rows.length > 0 ? 0 : -1;
}
function unwrapCell(value) {
  if (value === null || value === void 0) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value && "result" in value) {
    return unwrapCell(value.result);
  }
  if (typeof value === "object" && value && "richText" in value) {
    return value.richText?.map((part) => part.text ?? "").join("") ?? "";
  }
  return String(value);
}
function inferBranch(lines, sheetName) {
  const source = [...lines, sheetName].join(" ").toUpperCase();
  if (source.includes("ABUJA")) return "Abuja";
  if (source.includes("YOLA")) return "Yola";
  return sheetName.replace(/\b(ASASU|REALTY|TRANSACTIONS?|RSA|25%)\b/gi, " ").replace(/\s+/g, " ").trim() || "All branches";
}
function inferPaymentDate(lines) {
  const source = lines.join(" ").toUpperCase();
  const monthNames = {
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
  return `${year}-${String(monthNames[month] ?? 1).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
}
function scheduleNumber(branch, paymentDate) {
  return `AS-${branch.slice(0, 3).toUpperCase()}-${paymentDate.replaceAll("-", "")}`;
}
async function workbookRows(buffer, filename = "") {
  const text = buffer.toString("utf8");
  if (text.trim().startsWith("<") || text.includes("<html") || text.includes("<table")) {
    try {
      const rows = [];
      const rowMatches = text.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi);
      if (rowMatches && rowMatches.length > 0) {
        for (const tr of rowMatches) {
          const cells = [];
          const cellMatches = tr.match(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi);
          if (cellMatches) {
            for (const cellHtml of cellMatches) {
              const content = cellHtml.replace(/<[^>]+>/g, "").trim();
              cells.push(content);
            }
          }
          if (cells.length > 0) {
            rows.push(cells);
          }
        }
        if (rows.length > 0) {
          return [{ sheetName: filename || "Sheet1", rows }];
        }
      }
    } catch {
    }
  }
  try {
    const workbook = new ExcelJS.Workbook();
    const excelInput = buffer;
    await workbook.xlsx.load(excelInput);
    if (workbook.worksheets.length > 0) {
      return workbook.worksheets.map((worksheet) => {
        const rows = [];
        worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
          const values = Array.isArray(row.values) ? row.values.slice(1) : [];
          rows[rowNumber - 1] = values.map(unwrapCell);
        });
        return { sheetName: worksheet.name, rows };
      });
    }
  } catch {
  }
  try {
    const rows = parseCsv(text, {
      skip_empty_lines: false,
      relax_column_count: true,
      delimiter: [",", ";", "	", "|"]
    });
    if (rows && rows.length > 0) {
      return [{ sheetName: filename || "Sheet1", rows }];
    }
  } catch {
  }
  throw new Error("Unable to parse file. Please upload a valid Excel (.xlsx, .xls) or CSV document.");
}
async function parseScheduleWorkbook(buffer, user, title, filename, overrides) {
  const scheduleId = `sch_${nanoid(10)}`;
  const entries = [];
  const sheets = await workbookRows(buffer, filename);
  const branches = /* @__PURE__ */ new Set();
  const paymentDates = /* @__PURE__ */ new Set();
  const warnings = [];
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
    const headingLines = sheet.rows.slice(0, headerRowIndex).flatMap((row) => row.map(asText)).filter(Boolean);
    const branch2 = overrides?.branch || overrides?.detectedFields?.branch || inferBranch(headingLines, sheet.sheetName);
    const paymentDate2 = overrides?.paymentDate || overrides?.detectedFields?.paymentDate || inferPaymentDate(headingLines);
    branches.add(branch2);
    paymentDates.add(paymentDate2);
    const accountIndex = findHeaderIndex(headers, ["acct no", "account no", "account number", "acct number", "account", "no", "sn", "s n", "serial"]);
    const clientIndex = findHeaderIndex(headers, ["acct name", "account name", "client name", "customer name", "client", "customer", "applicant", "beneficiary", "name"]);
    const rsaIndex = findHeaderIndex(headers, ["rsa amount", "rsa amt", "rsa", "principal", "amount", "equity", "paid", "value", "total"]);
    const threePctIndex = findHeaderIndex(headers, ["3% serv", "3 % serv", "3 service", "3% serv chg", "3% serv.chg"]);
    const onePctIndex = findHeaderIndex(headers, ["1% serv", "1 % serv", "1% serv chg", "1% serv.chg"]);
    const twoPctIndex = findHeaderIndex(headers, ["2% serv", "2 % serv", "2% serv chg", "2% serv.chg"]);
    const netIndex = findHeaderIndex(headers, ["net"]);
    const resolvedClientIndex = clientIndex >= 0 ? clientIndex : headers.length > 1 ? 1 : 0;
    for (let index = headerRowIndex + 1; index < sheet.rows.length; index += 1) {
      const row = sheet.rows[index];
      if (!row) {
        continue;
      }
      const firstCell = asText(row[0]);
      const clientName = asText(row[resolvedClientIndex]);
      const clientUpper = clientName.toUpperCase();
      if (!clientName || firstCell.toUpperCase() === "TOTAL" || clientUpper === "TOTAL" || clientUpper === "SUBTOTAL" || clientUpper.startsWith("GRAND TOTAL")) {
        continue;
      }
      const onePercentServiceCharge = onePctIndex >= 0 ? asNumber(row[onePctIndex]) : void 0;
      const twoPercentServiceCharge = twoPctIndex >= 0 ? asNumber(row[twoPctIndex]) : void 0;
      const threePercentServiceCharge = threePctIndex >= 0 ? asNumber(row[threePctIndex]) : void 0;
      const rsaAmount = rsaIndex >= 0 ? asNumber(row[rsaIndex]) : asNumber(row[2]) ?? asNumber(row[1]) ?? asNumber(row[0]);
      const serviceCharge = onePercentServiceCharge ?? threePercentServiceCharge ?? twoPercentServiceCharge ?? (rsaAmount ? roundCurrency(rsaAmount * 0.01) : 0);
      const hasImportableValue = Boolean(clientName && (Number(rsaAmount ?? 0) > 0 || Number(serviceCharge) > 0));
      if (!hasImportableValue) {
        continue;
      }
      entries.push({
        id: `sch_ent_${nanoid(10)}`,
        scheduleId,
        sourceSheet: sheet.sheetName,
        rowNumber: index + 1,
        serialNumber: firstCell || String(entries.length + 1),
        accountNo: accountIndex >= 0 ? asText(row[accountIndex]) : void 0,
        applicationNumber: accountIndex >= 0 ? asText(row[accountIndex]) : void 0,
        clientName,
        rsaAmount: roundCurrency(rsaAmount ?? 0),
        paymentDate: paymentDate2,
        serviceCharge: roundCurrency(serviceCharge),
        threePercentServiceCharge: threePercentServiceCharge ? roundCurrency(threePercentServiceCharge) : void 0,
        onePercentServiceCharge: onePercentServiceCharge ? roundCurrency(onePercentServiceCharge) : void 0,
        twoPercentServiceCharge: twoPercentServiceCharge ? roundCurrency(twoPercentServiceCharge) : void 0,
        netAmount: netIndex >= 0 ? asNumber(row[netIndex]) : void 0
      });
    }
  }
  const duplicateAccounts = [...new Set(entries.map((entry) => entry.accountNo).filter((value) => Boolean(value)))].filter(
    (accountNo) => entries.filter((entry) => entry.accountNo === accountNo).length > 1
  );
  if (duplicateAccounts.length) warnings.push(`${duplicateAccounts.length} duplicate account number${duplicateAccounts.length === 1 ? "" : "s"} detected.`);
  const missingAccounts = entries.filter((entry) => !entry.accountNo).length;
  if (missingAccounts) warnings.push(`${missingAccounts} row${missingAccounts === 1 ? " has" : "s have"} no account/application number.`);
  const missingAmounts = entries.filter((entry) => !entry.rsaAmount).length;
  if (missingAmounts) warnings.push(`${missingAmounts} row${missingAmounts === 1 ? " has" : "s have"} no RSA amount and cannot be claimed.`);
  if (overrides?.warnings?.length) warnings.push(...overrides.warnings);
  const branch = overrides?.branch || (branches.size === 1 ? [...branches][0] : "Multiple branches");
  const paymentDate = overrides?.paymentDate || [...paymentDates].sort().at(-1) || nowIso().slice(0, 10);
  const totals = scheduleTotals(entries);
  const uploadedAt = nowIso();
  return {
    id: scheduleId,
    title: title || `${branch} payment schedule \xB7 ${paymentDate}`,
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
async function parseClaimWorkbook(buffer, filename, role) {
  const sheets = await workbookRows(buffer, filename);
  const rows = [];
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
function createPreviewRows(rows, role, scheduleEntries) {
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

// src/index.ts
import { createRequire } from "module";

// src/openapi.ts
var bearer = [{ bearerAuth: [] }];
var pathId = (name) => [{ name, in: "path", required: true, schema: { type: "string" } }];
var openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "ASASU Commission OS API",
    version: "1.0.0",
    description: "Schedule publication, immutable-row claims, duplicate protection, verification, disputes, notifications, and finance settlement."
  },
  servers: [{ url: "http://localhost:4300/api" }],
  security: bearer,
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    schemas: {
      ClaimSubmission: {
        type: "object",
        required: ["scheduleId", "scheduleEntryIds"],
        properties: {
          scheduleId: { type: "string" },
          scheduleEntryIds: { type: "array", minItems: 1, maxItems: 250, items: { type: "string" } },
          commissionRate: { type: "number", enum: [0.01, 0.015, 0.02] }
        }
      }
    }
  },
  paths: {
    "/auth/login": {
      post: {
        security: [],
        summary: "Authenticate with email and password",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["email", "password"], properties: { email: { type: "string", format: "email" }, password: { type: "string" } } } } }
        },
        responses: { "200": { description: "Authenticated user and access token" }, "401": { description: "Invalid credentials" } }
      }
    },
    "/dashboard": {
      get: { summary: "Get the role-scoped operating view", responses: { "200": { description: "Metrics, latest schedule, claims, disputes, payments, notifications, and audit data" } } }
    },
    "/payment-schedules/preview": {
      post: { summary: "Inspect and validate a schedule workbook without publishing", requestBody: { content: { "multipart/form-data": { schema: { type: "object", required: ["file"], properties: { file: { type: "string", format: "binary" } } } } } }, responses: { "200": { description: "Detected mapping, rows, totals, and warnings" }, "422": { description: "No valid schedule rows" } } }
    },
    "/payment-schedules/upload": {
      post: { summary: "Publish a validated schedule and notify active agents", requestBody: { content: { "multipart/form-data": { schema: { type: "object", required: ["file"], properties: { title: { type: "string" }, file: { type: "string", format: "binary" } } } } } }, responses: { "201": { description: "Published schedule" }, "409": { description: "Duplicate schedule" } } }
    },
    "/payment-schedules/{scheduleId}/entries": {
      get: { summary: "Search and paginate schedule entries", parameters: [...pathId("scheduleId"), { name: "query", in: "query", schema: { type: "string" } }, { name: "state", in: "query", schema: { type: "string", enum: ["ALL", "AVAILABLE", "CLAIMED_BY_YOU", "CLAIMED_BY_ANOTHER"] } }, { name: "page", in: "query", schema: { type: "integer", minimum: 1 } }, { name: "pageSize", in: "query", schema: { type: "integer", minimum: 10, maximum: 100 } }], responses: { "200": { description: "Role-decorated entry page" } } }
    },
    "/claims": {
      post: { summary: "Atomically claim selected schedule rows", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ClaimSubmission" } } } }, responses: { "201": { description: "Claim created and rows locked" }, "409": { description: "A selected row is already claimed" } } }
    },
    "/claims/{claimId}/status": {
      patch: { summary: "Approve, partially approve, reject, request information, or mark paid", parameters: pathId("claimId"), responses: { "200": { description: "Updated claim and optional payment" }, "409": { description: "Invalid workflow transition" } } }
    },
    "/claims/{claimId}/messages": {
      post: { summary: "Add a claim conversation message", parameters: pathId("claimId"), responses: { "201": { description: "Updated claim" } } }
    },
    "/disputes": {
      post: { summary: "File an ownership dispute for a claimed schedule row", responses: { "201": { description: "Dispute created and reviewers notified" }, "409": { description: "Row is not eligible for dispute" } } }
    },
    "/disputes/{disputeId}": {
      patch: { summary: "Review, reject, resolve, or transfer a disputed claim", parameters: pathId("disputeId"), responses: { "200": { description: "Updated dispute" } } }
    },
    "/notifications/{notificationId}/read": {
      patch: { summary: "Mark an in-app notification read", parameters: pathId("notificationId"), responses: { "204": { description: "Marked read" } } }
    },
    "/tickets": {
      get: { summary: "List role-scoped support tickets", responses: { "200": { description: "Tickets" } } },
      post: { summary: "Create a support ticket", responses: { "201": { description: "Created ticket" } } }
    },
    "/tickets/{ticketId}/replies": {
      post: { summary: "Reply to a support ticket", parameters: pathId("ticketId"), responses: { "201": { description: "Updated ticket" } } }
    },
    "/payments/export.csv": {
      get: { summary: "Export the finance settlement ledger", responses: { "200": { description: "CSV payment log" } } }
    }
  }
};

// src/store.ts
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// src/seedData.ts
import bcrypt2 from "bcryptjs";
var createdAt = "2026-07-20T08:30:00.000Z";
function hash(password) {
  return bcrypt2.hashSync(password, 10);
}
var sourceRows = [
  ["001282273061", "OWOYALUMO, STEPHEN-MUSA", 2281159283e-2],
  ["001281595211", "YAKUBU, JAMILA ADAMU", 1765691698e-2],
  ["001282104992", "ALIYU, AHMAD MOHAMMED", 1516853304e-2],
  ["001282326511", "AGWU, COMFORT ONYE", 1510575924e-2],
  ["001282257941", "ISTIFANUS, BULUS", 118765235e-1],
  ["001281810581", "IGBINOSA, IKPONMWEN BENS", 1068751467e-2],
  ["001282295451", "DANBATTA, ABUBAKAR SULE", 1046974411e-2],
  ["001282326481", "TANIMU, ISMAIL MAIDOKI", 1017762339e-2],
  ["001282249451", "MUSA, IBRAHIM GULANI", 1012069677e-2],
  ["001282041631", "ADIEZE, CHIEMEKA KELECHI", 938899659e-2],
  ["001282309831", "DADA, OLUWADARE EMMANUE", 904622611e-2],
  ["001282261211", "ABALI, IBRAHIM BABA", 859519911e-2]
];
function scheduleEntry(index, row) {
  const [accountNo, clientName, rsaAmount] = row;
  return {
    id: `sch_ent_${index + 1}`,
    scheduleId: "sch_20jul2026",
    sourceSheet: "ASASU Realty Abuja",
    rowNumber: index + 4,
    serialNumber: String(index + 1),
    accountNo,
    applicationNumber: accountNo,
    clientName,
    rsaAmount,
    paymentDate: "2026-07-20",
    serviceCharge: calculateCommission(rsaAmount, 0.01),
    onePercentServiceCharge: calculateCommission(rsaAmount, 0.01),
    twoPercentServiceCharge: calculateCommission(rsaAmount, 0.02),
    threePercentServiceCharge: calculateCommission(rsaAmount, 0.03),
    netAmount: roundCurrency(rsaAmount - calculateCommission(rsaAmount, 0.031) - 2e4)
  };
}
function claimItem(entry, rate, id) {
  return {
    id,
    scheduleEntryId: entry.id,
    clientName: entry.clientName,
    applicationNumber: entry.applicationNumber,
    rsaAmount: entry.rsaAmount,
    serviceCharge: entry.onePercentServiceCharge ?? calculateCommission(entry.rsaAmount, 0.01),
    commissionRate: rate,
    commissionAmount: calculateCommission(entry.rsaAmount, rate),
    processingFeeApplied: false,
    processingFeeAmount: 0,
    status: "PENDING",
    comparison: {
      scheduleEntryId: entry.id,
      officialClientName: entry.clientName,
      officialAmount: entry.rsaAmount,
      amountDelta: 0,
      matchScore: 100,
      status: "MATCHED",
      notes: ["Claimed directly from the published schedule row."]
    }
  };
}
function createSeedData() {
  const users = [
    {
      id: "usr_admin",
      name: "Amina Yusuf",
      email: "admin@asasurealty.com",
      passwordHash: hash("Admin@2026"),
      role: "ADMIN",
      agency: "ASASU Realty HQ",
      branch: "Head Office",
      phone: "+234 800 000 0001",
      active: true,
      createdAt
    },
    {
      id: "usr_asasu_admin",
      name: "ASASU Admin",
      email: "asasu@gmail.com",
      passwordHash: hash("Admin@123456"),
      role: "ADMIN",
      agency: "ASASU Realty HQ",
      branch: "Head Office",
      phone: "+234 800 000 0000",
      active: true,
      createdAt
    },
    {
      id: "usr_agent",
      name: "Tunde Balogun",
      email: "agent@asasurealty.com",
      passwordHash: hash("Agent@2026"),
      role: "AGENT",
      agency: "Yola Partner Desk",
      branch: "Yola",
      phone: "+234 800 000 0002",
      paymentAccount: {
        bankName: "Guaranty Trust Bank",
        accountName: "Tunde Balogun",
        accountNumber: "0123456789"
      },
      active: true,
      createdAt
    },
    {
      id: "usr_developer",
      name: "Nkechi Okafor",
      email: "developer@asasurealty.com",
      passwordHash: hash("Developer@2026"),
      role: "SUB_DEVELOPER",
      agency: "Abuja Development Network",
      branch: "Abuja",
      phone: "+234 800 000 0003",
      paymentAccount: {
        bankName: "Access Bank",
        accountName: "Nkechi Okafor",
        accountNumber: "0234567891"
      },
      active: true,
      createdAt
    }
  ];
  const entries = sourceRows.map((row, index) => scheduleEntry(index, row));
  const schedule = {
    id: "sch_20jul2026",
    title: "25% RSA Transactions \xB7 Abuja",
    scheduleNumber: "AS-ABU-20260720",
    branch: "Abuja",
    bankName: "Adamawa Mortgage Bank",
    paymentDate: "2026-07-20",
    sourceFileName: "ASASU ABUJA 20th.xlsx",
    status: "PUBLISHED",
    uploadedBy: "usr_admin",
    uploadedAt: createdAt,
    publishedAt: "2026-07-20T08:35:00.000Z",
    entryCount: entries.length,
    ...scheduleTotals(entries),
    importWarnings: [],
    entries
  };
  const agentItems = [claimItem(entries[0], 0.01, "itm_seed_agent_1")];
  const agentRollups = getClaimRollups(agentItems);
  const developerItems = [claimItem(entries[4], 0.02, "itm_seed_dev_1"), claimItem(entries[5], 0.02, "itm_seed_dev_2")];
  developerItems.forEach((item) => item.status = "APPROVED");
  const developerRollups = getClaimRollups(developerItems);
  const claims = [
    {
      id: "clm_seed_agent",
      reference: "CLM-20260720-0142",
      userId: "usr_agent",
      submitterName: "Tunde Balogun",
      submitterRole: "AGENT",
      scheduleId: schedule.id,
      scheduleTitle: schedule.title,
      branch: schedule.branch,
      status: "PENDING_VERIFICATION",
      commissionRate: 0.01,
      ...agentRollups,
      items: agentItems,
      messages: [],
      createdAt: "2026-07-20T09:15:00.000Z",
      updatedAt: "2026-07-20T09:15:00.000Z"
    },
    {
      id: "clm_seed_developer",
      reference: "CLM-20260720-0136",
      userId: "usr_developer",
      submitterName: "Nkechi Okafor",
      submitterRole: "SUB_DEVELOPER",
      scheduleId: schedule.id,
      scheduleTitle: schedule.title,
      branch: schedule.branch,
      status: "PAID",
      commissionRate: 0.02,
      ...developerRollups,
      items: developerItems,
      messages: [],
      createdAt: "2026-07-20T08:50:00.000Z",
      updatedAt: "2026-07-20T10:10:00.000Z",
      paidAt: "2026-07-20T10:10:00.000Z"
    }
  ];
  const tickets = [
    {
      id: "tkt_seed_1",
      userId: "usr_agent",
      submitterName: "Tunde Balogun",
      subject: "Account number confirmation",
      description: "Please confirm the leading zero is retained in schedule searches.",
      priority: "MEDIUM",
      status: "WAITING",
      replies: [],
      createdAt: "2026-07-19T12:20:00.000Z",
      updatedAt: "2026-07-19T12:30:00.000Z"
    }
  ];
  return {
    users,
    schedules: [schedule],
    claims,
    disputes: [],
    tickets,
    notifications: [
      {
        id: "ntf_seed_1",
        userId: "usr_agent",
        title: "New payment schedule published",
        body: "Abuja \xB7 20 July 2026 is ready. Search your clients and claim in seconds.",
        read: false,
        createdAt: "2026-07-20T08:35:00.000Z"
      }
    ],
    payments: [
      {
        id: "pay_seed_1",
        claimId: "clm_seed_developer",
        userId: "usr_developer",
        recipientName: "Nkechi Okafor",
        amount: developerRollups.totalPayable,
        paidAt: "2026-07-20T10:10:00.000Z",
        reference: "ASASU-20260720-0136",
        recipientPhone: "+234 800 000 0003",
        paymentAccount: {
          bankName: "Access Bank",
          accountName: "Nkechi Okafor",
          accountNumber: "0234567891"
        }
      }
    ],
    auditLog: [
      {
        id: "aud_seed_1",
        actorId: "usr_admin",
        actorName: "Amina Yusuf",
        action: "SCHEDULE_PUBLISHED",
        entityType: "SCHEDULE",
        entityId: schedule.id,
        detail: `${schedule.scheduleNumber} published with ${schedule.entryCount} clients.`,
        createdAt: "2026-07-20T08:35:00.000Z"
      }
    ]
  };
}

// src/store.ts
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var dataPath = path.resolve(__dirname, "../data/store.json");
var JsonStore = class {
  data = null;
  mutationQueue = Promise.resolve();
  async read() {
    if (this.data) {
      return this.data;
    }
    try {
      const raw = await fs.readFile(dataPath, "utf8");
      const parsed = JSON.parse(raw);
      const hasCurrentSchema = Boolean(
        parsed.schedules?.every((schedule) => schedule.scheduleNumber && schedule.status && typeof schedule.totalRsaAmount === "number") && parsed.claims?.every((claim) => claim.reference && claim.scheduleId && typeof claim.totalRsaAmount === "number") && parsed.disputes && parsed.auditLog
      );
      this.data = hasCurrentSchema ? parsed : createSeedData();
      if (!hasCurrentSchema) await this.write(this.data);
    } catch {
      this.data = createSeedData();
      await this.write(this.data);
    }
    return this.data;
  }
  async write(nextData) {
    this.data = nextData ?? this.data ?? createSeedData();
    await fs.mkdir(path.dirname(dataPath), { recursive: true });
    await fs.writeFile(dataPath, JSON.stringify(this.data, null, 2));
    return this.data;
  }
  async mutate(mutator) {
    let result;
    const next = this.mutationQueue.then(async () => {
      const data = await this.read();
      await mutator(data);
      await this.write(data);
      result = data;
    });
    this.mutationQueue = next.catch(() => void 0);
    await next;
    return result;
  }
};

// src/index.ts
var require2 = createRequire(import.meta.url);
dotenv.config();
var moduleRoot = path2.dirname(fileURLToPath2(import.meta.url));
var rootEnvPath = path2.resolve(moduleRoot, "../../../../.env");
if (!process.env.CLOUDINARY_API_KEY && fs2.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
}
function loadEmailUtil() {
  const possiblePaths = [
    path2.resolve(moduleRoot, "../../../../utils/email.js"),
    path2.resolve(moduleRoot, "../../../utils/email.js"),
    path2.resolve(moduleRoot, "../../utils/email.js"),
    path2.resolve(process.cwd(), "utils/email.js"),
    path2.resolve(process.cwd(), "../../utils/email.js")
  ];
  for (const emailPath of possiblePaths) {
    if (fs2.existsSync(emailPath)) {
      try {
        return require2(emailPath);
      } catch (err) {
        console.warn("Failed loading email util from", emailPath, err);
      }
    }
  }
  return async (to, subject, text) => {
    console.log(`[Email util fallback] To: ${to}, Subject: ${subject}`);
  };
}
var sendEmail = loadEmailUtil();
var app = express();
var server = http.createServer(app);
var port = Number(process.env.PORT ?? process.env.API_PORT ?? 3e3);
var corsOrigin = process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(",").map((origin) => origin.trim()) : true;
var store = new JsonStore();
var upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const allowed = [".xlsx", ".xls", ".csv"];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf("."));
    callback(null, allowed.includes(ext));
  }
});
var evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const allowedTypes = /* @__PURE__ */ new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
    if (allowedTypes.has(file.mimetype)) callback(null, true);
    else callback(new Error("Evidence must be a PNG, JPG, WEBP, or PDF file."));
  }
});
var uploadRoot = path2.resolve(moduleRoot, "../uploads/disputes");
var scheduleUploadRoot = path2.resolve(moduleRoot, "../uploads/payment_schedules");
if (!fs2.existsSync(scheduleUploadRoot)) {
  fs2.mkdirSync(scheduleUploadRoot, { recursive: true });
}
function findWebDistRoot() {
  const candidates = [
    path2.resolve(moduleRoot, "../apps/web/dist"),
    path2.resolve(moduleRoot, "../../web/dist"),
    path2.resolve(moduleRoot, "../web/dist"),
    path2.resolve(process.cwd(), "ASASU_Commission_Portal/apps/web/dist"),
    path2.resolve(process.cwd(), "apps/web/dist"),
    path2.resolve(moduleRoot, "../dist"),
    path2.resolve(process.cwd(), "public")
  ];
  for (const candidate of candidates) {
    if (fs2.existsSync(candidate) && fs2.existsSync(path2.join(candidate, "index.html"))) {
      return candidate;
    }
  }
  return candidates[0] || path2.resolve(moduleRoot, "../apps/web/dist");
}
var webDistRoot = findWebDistRoot();
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});
var io = new Server(server, { cors: { origin: corsOrigin, credentials: true } });
io.on("connection", (socket) => {
  const userId = String(socket.handshake.auth.userId ?? "");
  if (userId) socket.join(userId);
});
app.use(helmet());
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(rateLimit({ windowMs: 6e4, limit: 240, standardHeaders: true, legacyHeaders: false }));
var requireAuth = authMiddleware(store);
var scheduleManagers = ["SUPER_ADMIN", "ADMIN", "OPERATIONS", "BRANCH_ADMIN"];
var claimReviewers = ["SUPER_ADMIN", "ADMIN", "OPERATIONS", "BRANCH_ADMIN", "FINANCE"];
var disputeReviewers = ["SUPER_ADMIN", "ADMIN", "OPERATIONS", "SUPPORT", "BRANCH_ADMIN"];
var paymentAccountViewers = ["SUPER_ADMIN", "ADMIN", "FINANCE", "AUDITOR"];
function notify(userId, title, body) {
  const notification = { id: `ntf_${nanoid2(10)}`, userId, title, body, read: false, createdAt: nowIso() };
  io.to(userId).emit("notification", notification);
  return notification;
}
function logAction(data, request, action, entityType, entityId, detail) {
  const actor = request.user;
  data.auditLog.push({
    id: `aud_${nanoid2(10)}`,
    actorId: actor?.id ?? "anonymous",
    actorName: actor?.name ?? "Anonymous",
    action,
    entityType,
    entityId,
    detail,
    ipAddress: request.ip,
    userAgent: request.get("user-agent"),
    createdAt: nowIso()
  });
}
function scopedClaims(role, userId, claims) {
  return isStaffRole(role) ? claims : claims.filter((claim) => claim.userId === userId);
}
function scopedTickets(role, userId, tickets) {
  return isStaffRole(role) ? tickets : tickets.filter((ticket) => ticket.userId === userId);
}
function agentRole(role) {
  if (!isAgentRole(role)) throw new Error("Only agents can submit commission claims");
  return role;
}
function activeClaimForEntry(entryId, claims) {
  return claims.find(
    (claim) => claim.status !== "REJECTED" && claim.items.some((item) => item.scheduleEntryId === entryId && item.status !== "REJECTED")
  );
}
function decorateSchedule(schedule, userId, role, claims) {
  return {
    ...schedule,
    entries: schedule.entries.map((entry) => {
      const claim = activeClaimForEntry(entry.id, claims);
      if (!claim) return { ...entry, claimState: "AVAILABLE" };
      return {
        ...entry,
        claimState: claim.userId === userId ? "CLAIMED_BY_YOU" : "CLAIMED_BY_ANOTHER",
        claimId: claim.id,
        claimedByName: isStaffRole(role) ? claim.submitterName : void 0
      };
    })
  };
}
function claimRollupItems(claim) {
  const active = claim.items.filter((item) => item.status !== "REJECTED");
  Object.assign(claim, getClaimRollups(active));
}
function createDirectClaimItem(entry, rate) {
  return {
    id: `itm_${nanoid2(10)}`,
    scheduleEntryId: entry.id,
    clientName: entry.clientName,
    applicationNumber: entry.applicationNumber ?? entry.accountNo,
    rsaAmount: entry.rsaAmount,
    serviceCharge: entry.onePercentServiceCharge ?? entry.serviceCharge ?? calculateCommission(entry.rsaAmount, 0.01),
    commissionRate: rate,
    commissionAmount: calculateCommission(entry.rsaAmount, rate),
    processingFeeApplied: false,
    processingFeeAmount: 0,
    status: "PENDING",
    comparison: {
      scheduleEntryId: entry.id,
      officialClientName: entry.clientName,
      officialAmount: entry.rsaAmount,
      amountDelta: 0,
      matchScore: 100,
      status: "MATCHED",
      notes: ["Claimed directly from a published schedule row."]
    }
  };
}
app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "asasu-commission-api", timestamp: nowIso() });
});
app.get("/api/openapi.json", (_request, response) => response.json(openApiSpec));
app.post("/api/auth/register", async (request, response) => {
  const parsed = z.object({
    name: z.string().trim().min(2),
    email: z.string().email(),
    password: z.string().min(8),
    agency: z.string().trim().min(2),
    branch: z.string().trim().optional().default(""),
    phone: z.string().trim().optional().default(""),
    role: z.enum(["AGENT", "SUB_DEVELOPER"])
  }).safeParse(request.body);
  if (!parsed.success) {
    return void response.status(400).json({ message: "Please provide your name, email, password, agency, and choose an account type." });
  }
  const { name, email, password, agency, branch, phone, role } = parsed.data;
  const data = await store.read();
  const normalizedEmail = email.toLowerCase();
  if (data.users.some((item) => item.email.toLowerCase() === normalizedEmail && item.active)) {
    return void response.status(409).json({ message: "An account with this email already exists." });
  }
  const user = {
    id: `usr_${nanoid2(10)}`,
    name,
    email: normalizedEmail,
    role,
    agency,
    branch: branch || void 0,
    phone: phone || void 0,
    active: true,
    createdAt: nowIso(),
    passwordHash: await hashPassword(password)
  };
  data.users.push(user);
  data.auditLog.push({
    id: `aud_${nanoid2(10)}`,
    actorId: user.id,
    actorName: user.name,
    action: "REGISTER",
    entityType: "AUTH",
    entityId: user.id,
    detail: `Created ${role.toLowerCase()} account`,
    ipAddress: request.ip,
    userAgent: request.get("user-agent"),
    createdAt: nowIso()
  });
  await store.write(data);
  response.json(authResponse(user));
});
app.post("/api/auth/login", async (request, response) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(request.body);
  if (!parsed.success) return void response.status(400).json({ message: "A valid email and password are required" });
  const data = await store.read();
  const user = data.users.find((item) => item.email.toLowerCase() === parsed.data.email.toLowerCase() && item.active);
  if (!user || !await verifyPassword(parsed.data.password, user.passwordHash)) {
    return void response.status(401).json({ message: "Invalid login credentials" });
  }
  response.json(authResponse(user));
});
app.get("/api/me", requireAuth, (request, response) => response.json(publicUser(request.user)));
app.patch("/api/me/payment-account", requireAuth, async (request, response) => {
  const parsed = z.object({
    bankName: z.string().trim().min(2).max(80),
    accountName: z.string().trim().min(2).max(100),
    accountNumber: z.string().regex(/^\d{10}$/, "Enter a valid 10-digit account number"),
    phone: z.string().trim().min(7).max(24).regex(/^\+?[0-9()\-\s]+$/, "Enter a valid phone number")
  }).safeParse(request.body);
  if (!parsed.success) {
    return void response.status(400).json({ message: parsed.error.issues[0]?.message ?? "Enter valid payment account details" });
  }
  let updatedUser;
  await store.mutate((data) => {
    const user = data.users.find((item) => item.id === request.user.id);
    if (!user) return;
    user.paymentAccount = {
      bankName: parsed.data.bankName,
      accountName: parsed.data.accountName,
      accountNumber: parsed.data.accountNumber
    };
    user.phone = parsed.data.phone;
    updatedUser = user;
    logAction(data, request, "PAYMENT_ACCOUNT_UPDATED", "USER", user.id, "Payment account details updated.");
  });
  if (!updatedUser) return void response.status(404).json({ message: "User not found" });
  response.json(publicUser(updatedUser));
});
app.get("/api/dashboard", requireAuth, async (request, response) => {
  const data = await store.read();
  const user = request.user;
  const safeUsers = data.users.map(publicUser);
  const canViewPaymentAccounts = paymentAccountViewers.includes(user.role);
  const claims = scopedClaims(user.role, user.id, data.claims).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const disputes = (isStaffRole(user.role) ? data.disputes : data.disputes.filter((item) => item.raisedById === user.id || item.againstUserId === user.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const published = latestSchedule(data.schedules);
  const schedule = published ? decorateSchedule(published, user.id, user.role, data.claims) : void 0;
  response.json({
    user: publicUser(user),
    metrics: calculateDashboardMetrics(publicUser(user), safeUsers, data.claims, data.payments, data.schedules, data.disputes),
    trends: buildTrends(publicUser(user), data.claims),
    leaderboards: buildQuarterlyLeaderboards(safeUsers, data.claims, data.payments),
    claims,
    disputes,
    tickets: scopedTickets(user.role, user.id, data.tickets).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    notifications: data.notifications.filter((item) => item.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    schedule,
    schedules: [...data.schedules].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)).map((item) => item.id === schedule?.id ? schedule : { ...item, entries: [] }),
    users: isStaffRole(user.role) ? safeUsers.map((item) => canViewPaymentAccounts ? item : { ...item, paymentAccount: void 0 }) : void 0,
    payments: isStaffRole(user.role) ? data.payments.map((item) => canViewPaymentAccounts ? item : { ...item, paymentAccount: void 0 }) : data.payments.filter((payment) => payment.userId === user.id),
    auditLog: isStaffRole(user.role) ? [...data.auditLog].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100) : void 0
  });
});
app.get("/api/payment-schedules/:scheduleId/entries", requireAuth, async (request, response) => {
  const data = await store.read();
  const schedule = data.schedules.find((item) => item.id === request.params.scheduleId);
  if (!schedule || schedule.status !== "PUBLISHED" && !isStaffRole(request.user.role)) {
    return void response.status(404).json({ message: "Schedule not found" });
  }
  const decorated = decorateSchedule(schedule, request.user.id, request.user.role, data.claims);
  const query = String(request.query.query ?? "").trim().toLowerCase();
  const state = String(request.query.state ?? "ALL");
  const page = Math.max(1, Number(request.query.page ?? 1));
  const pageSize = Math.min(100, Math.max(10, Number(request.query.pageSize ?? 25)));
  const filtered = decorated.entries.filter((entry) => {
    const matchesSearch = !query || [entry.clientName, entry.accountNo, entry.applicationNumber, entry.serialNumber, schedule.branch].some((value) => value?.toLowerCase().includes(query));
    const matchesState = state === "ALL" || entry.claimState === state;
    return matchesSearch && matchesState;
  });
  response.json({ rows: filtered.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: filtered.length });
});
app.post("/api/payment-schedules/preview", requireAuth, requireRole(...scheduleManagers), upload.single("file"), async (request, response) => {
  if (!request.file) return void response.status(400).json({ message: "Upload an Excel or CSV file" });
  const schedule = await parseScheduleWorkbook(request.file.buffer, request.user, request.body.title, request.file.originalname);
  if (!schedule.entries.length) return void response.status(422).json({ message: "No schedule rows found. Expected account name and RSA amount columns." });
  let sourceFileUrl;
  let sourceFileId;
  if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY) {
    try {
      const dataUri = `data:${request.file.mimetype};base64,${request.file.buffer.toString("base64")}`;
      const uploadResult = await cloudinary.uploader.upload(dataUri, {
        folder: "asasu/payment_schedules",
        resource_type: "raw",
        public_id: `payment_schedule_preview_${Date.now()}`,
        use_filename: true,
        unique_filename: true
      });
      sourceFileUrl = uploadResult.secure_url;
      sourceFileId = uploadResult.public_id;
    } catch (error) {
      console.warn("Cloudinary preview upload skipped or failed:", error);
    }
  }
  if (!sourceFileUrl) {
    try {
      const safeName = `payment_schedule_preview_${Date.now()}${path2.extname(request.file.originalname) || ".xlsx"}`;
      const filePath = path2.join(scheduleUploadRoot, safeName);
      await fsPromises.writeFile(filePath, request.file.buffer);
      sourceFileUrl = `/uploads/payment_schedules/${encodeURIComponent(safeName)}`;
      sourceFileId = safeName;
    } catch (error) {
      console.warn("Local preview file storage skipped or failed:", error);
    }
  }
  response.json({
    schedule: {
      ...schedule,
      sourceFileUrl,
      sourceFileId
    },
    detectedColumns: ["Account number", "Client name", "RSA amount", "1% service charge", "2% service charge"],
    warnings: schedule.importWarnings,
    duplicateAccountNumbers: []
  });
});
app.post("/api/payment-schedules/upload", requireAuth, requireRole(...scheduleManagers), upload.single("file"), async (request, response) => {
  if (!request.file) return void response.status(400).json({ message: "Upload an Excel or CSV file" });
  let metadata = {};
  if (typeof request.body.metadata === "string") {
    try {
      metadata = JSON.parse(request.body.metadata);
    } catch {
      metadata = {};
    }
  }
  const schedule = await parseScheduleWorkbook(request.file.buffer, request.user, request.body.title, request.file.originalname, metadata);
  if (!schedule.entries.length) return void response.status(422).json({ message: "No schedule rows found. Expected account name and RSA amount columns." });
  if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY) {
    try {
      const dataUri = `data:${request.file.mimetype};base64,${request.file.buffer.toString("base64")}`;
      const uploadResult = await cloudinary.uploader.upload(dataUri, {
        folder: "asasu/payment_schedules",
        resource_type: "raw",
        public_id: `payment_schedule_${schedule.scheduleNumber}_${Date.now()}`,
        use_filename: true,
        unique_filename: true
      });
      schedule.sourceFileUrl = uploadResult.secure_url;
      schedule.sourceFileId = uploadResult.public_id;
    } catch (error) {
      console.warn("Cloudinary upload skipped or failed:", error);
    }
  }
  if (!schedule.sourceFileUrl) {
    try {
      const safeName = `payment_schedule_${schedule.scheduleNumber}_${Date.now()}${path2.extname(request.file.originalname) || ".xlsx"}`;
      const filePath = path2.join(scheduleUploadRoot, safeName);
      await fsPromises.writeFile(filePath, request.file.buffer);
      schedule.sourceFileUrl = `/uploads/payment_schedules/${encodeURIComponent(safeName)}`;
      schedule.sourceFileId = safeName;
    } catch (error) {
      console.warn("Local schedule file storage skipped or failed:", error);
    }
  }
  let duplicate = false;
  await store.mutate((data) => {
    duplicate = data.schedules.some((item) => item.scheduleNumber === schedule.scheduleNumber && item.entryCount === schedule.entryCount);
    if (duplicate) return;
    data.schedules.push(schedule);
    for (const user of data.users.filter((item) => item.active && isAgentRole(item.role))) {
      data.notifications.push(notify(user.id, "New payment schedule published", `${schedule.branch} \xB7 ${schedule.paymentDate} is ready. Search your clients and claim in seconds.`));
      if (user.email) {
        void sendEmail(
          user.email,
          `New payment schedule published: ${schedule.branch} ${schedule.paymentDate}`,
          `${schedule.branch} payment schedule for ${schedule.paymentDate} has been published. Log in to the portal to view and claim your clients.`,
          `<p>New payment schedule published for <strong>${schedule.branch}</strong> on <strong>${schedule.paymentDate}</strong>.</p><p>Log in to the portal to view and claim your clients.</p>`
        );
      }
    }
    data.notifications.push(notify(request.user.id, "Schedule published", `${schedule.entryCount} clients imported with ${schedule.importWarnings.length} warning${schedule.importWarnings.length === 1 ? "" : "s"}.`));
    logAction(data, request, "SCHEDULE_PUBLISHED", "SCHEDULE", schedule.id, `${schedule.scheduleNumber} published with ${schedule.entryCount} rows.`);
  });
  if (duplicate) return void response.status(409).json({ message: "This schedule appears to have already been published." });
  response.status(201).json(schedule);
});
app.patch("/api/payment-schedules/:scheduleId/status", requireAuth, requireRole(...scheduleManagers), async (request, response) => {
  const parsed = z.object({ status: z.enum(["PUBLISHED", "ARCHIVED"]) }).safeParse(request.body);
  if (!parsed.success) return void response.status(400).json({ message: "Invalid schedule status" });
  let updated;
  await store.mutate((data) => {
    const schedule = data.schedules.find((item) => item.id === request.params.scheduleId);
    if (!schedule) return;
    schedule.status = parsed.data.status;
    if (parsed.data.status === "PUBLISHED") schedule.publishedAt = nowIso();
    updated = schedule;
    logAction(data, request, `SCHEDULE_${parsed.data.status}`, "SCHEDULE", schedule.id, `${schedule.scheduleNumber} is now ${parsed.data.status}.`);
  });
  if (!updated) return void response.status(404).json({ message: "Schedule not found" });
  response.json(updated);
});
app.post("/api/uploads/claims/preview", requireAuth, upload.single("file"), async (request, response) => {
  if (!request.file) return void response.status(400).json({ message: "Upload an Excel or CSV file" });
  if (!isAgentRole(request.user.role)) return void response.status(403).json({ message: "Only agents can submit claims" });
  let uploadedFileUrl;
  let uploadedFileId;
  if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY) {
    try {
      const dataUri = `data:${request.file.mimetype};base64,${request.file.buffer.toString("base64")}`;
      const uploadResult = await cloudinary.uploader.upload(dataUri, {
        folder: "asasu/uploads",
        resource_type: "raw",
        public_id: `claim_upload_${Date.now()}`,
        use_filename: true,
        unique_filename: true
      });
      uploadedFileUrl = uploadResult.secure_url;
      uploadedFileId = uploadResult.public_id;
    } catch (error) {
      console.warn("Cloudinary claim upload skipped or failed:", error);
    }
  }
  if (!uploadedFileUrl) {
    try {
      const safeName = `claim_upload_${Date.now()}${path2.extname(request.file.originalname) || ".xlsx"}`;
      const filePath = path2.join(uploadRoot, safeName);
      await fsPromises.writeFile(filePath, request.file.buffer);
      uploadedFileUrl = `/uploads/${encodeURIComponent(safeName)}`;
      uploadedFileId = safeName;
    } catch (error) {
      console.warn("Local claim upload storage skipped or failed:", error);
    }
  }
  const data = await store.read();
  const schedule = latestSchedule(data.schedules);
  const rows = await parseClaimWorkbook(request.file.buffer, request.file.originalname, request.user.role);
  if (!rows.length) return void response.status(422).json({ message: "No legacy claim rows found." });
  response.json({
    uploadId: `upl_${nanoid2(10)}`,
    rows: createPreviewRows(rows, request.user.role, schedule?.entries ?? []),
    uploadedFileUrl,
    uploadedFileId
  });
});
app.post("/api/claims", requireAuth, async (request, response) => {
  if (!isAgentRole(request.user.role)) return void response.status(403).json({ message: "Only agents and sub-developers can submit claims" });
  const parsed = z.object({
    scheduleId: z.string().min(1),
    scheduleEntryIds: z.array(z.string().min(1)).min(1).max(250),
    commissionRate: z.number().optional()
  }).safeParse(request.body);
  if (!parsed.success) return void response.status(400).json({ message: "Select at least one valid schedule row" });
  const user = request.user;
  const role = agentRole(user.role);
  const rate = allowedCommissionRate(role, parsed.data.commissionRate);
  let createdClaim;
  let conflictClient;
  let invalidSelection = false;
  await store.mutate((data) => {
    const schedule = data.schedules.find((item) => item.id === parsed.data.scheduleId && item.status === "PUBLISHED");
    if (!schedule) {
      invalidSelection = true;
      return;
    }
    const uniqueIds = [...new Set(parsed.data.scheduleEntryIds)];
    const entries = uniqueIds.map((id) => schedule.entries.find((entry) => entry.id === id)).filter((entry) => Boolean(entry));
    if (entries.length !== uniqueIds.length || entries.some((entry) => !entry.rsaAmount)) {
      invalidSelection = true;
      return;
    }
    const conflict = entries.find((entry) => activeClaimForEntry(entry.id, data.claims));
    if (conflict) {
      conflictClient = conflict.clientName;
      return;
    }
    const items = entries.map((entry) => createDirectClaimItem(entry, rate));
    const timestamp = nowIso();
    const rollups = getClaimRollups(items);
    createdClaim = {
      id: `clm_${nanoid2(10)}`,
      reference: `CLM-${timestamp.slice(0, 10).replaceAll("-", "")}-${String(data.claims.length + 1).padStart(4, "0")}`,
      userId: user.id,
      submitterName: user.name,
      submitterRole: role,
      scheduleId: schedule.id,
      scheduleTitle: schedule.title,
      branch: schedule.branch,
      status: initialClaimStatus(items),
      commissionRate: rate,
      ...rollups,
      items,
      messages: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    data.claims.push(createdClaim);
    data.notifications.push(notify(user.id, "Claim submitted", `${createdClaim.reference} is pending verification.`));
    for (const admin of data.users.filter((item) => item.active && ["SUPER_ADMIN", "ADMIN", "OPERATIONS", "BRANCH_ADMIN"].includes(item.role))) {
      data.notifications.push(notify(admin.id, "New claim submitted", `${user.name} submitted ${items.length} client${items.length === 1 ? "" : "s"} for \u20A6${createdClaim.totalPayable.toLocaleString("en-NG")}.`));
    }
    logAction(data, request, "CLAIM_SUBMITTED", "CLAIM", createdClaim.id, `${createdClaim.reference}: ${items.length} rows at ${rate * 100}%.`);
  });
  if (invalidSelection) return void response.status(422).json({ message: "One or more selected rows are invalid or the schedule is no longer published." });
  if (conflictClient) return void response.status(409).json({ message: `${conflictClient} has already been claimed. Refresh the schedule to see its current status.` });
  response.status(201).json(createdClaim);
});
app.patch("/api/claims/:claimId/status", requireAuth, requireRole(...claimReviewers), async (request, response) => {
  const parsed = z.object({
    action: z.enum(["approve", "partial_approve", "reject", "request_info", "paid"]),
    approvedItemIds: z.array(z.string()).optional(),
    note: z.string().max(1e3).optional()
  }).safeParse(request.body);
  if (!parsed.success) return void response.status(400).json({ message: "Invalid claim action" });
  if (parsed.data.action === "paid" && !["SUPER_ADMIN", "ADMIN", "FINANCE"].includes(request.user.role)) {
    return void response.status(403).json({ message: "Only Finance or an administrator can mark claims as paid" });
  }
  let updated;
  let payment;
  let invalidTransition;
  await store.mutate((data) => {
    const claim = data.claims.find((item) => item.id === request.params.claimId);
    if (!claim) return;
    const timestamp = nowIso();
    const action = parsed.data.action;
    if (action === "approve") {
      claim.items.forEach((item) => item.status = "APPROVED");
      claim.status = "APPROVED";
    } else if (action === "partial_approve") {
      const approved = new Set(parsed.data.approvedItemIds ?? []);
      if (!approved.size) {
        invalidTransition = "Choose at least one client row for partial approval.";
        return;
      }
      claim.items.forEach((item) => item.status = approved.has(item.id) ? "APPROVED" : "REJECTED");
      claim.status = claim.items.every((item) => item.status === "APPROVED") ? "APPROVED" : "PARTIALLY_APPROVED";
      claimRollupItems(claim);
    } else if (action === "reject") {
      claim.items.forEach((item) => item.status = "REJECTED");
      claim.status = "REJECTED";
      claimRollupItems(claim);
    } else if (action === "request_info") {
      claim.status = "INFO_REQUESTED";
    } else if (action === "paid") {
      if (!["APPROVED", "PARTIALLY_APPROVED"].includes(claim.status)) {
        invalidTransition = "Approve this claim before marking it as paid.";
        return;
      }
      const recipient = data.users.find((item) => item.id === claim.userId);
      if (!recipient?.paymentAccount || !recipient.phone) {
        invalidTransition = "The partner must add a payment account and phone number before this claim can be marked as paid.";
        return;
      }
      claim.status = "PAID";
      claim.paidAt = timestamp;
      payment = {
        id: `pay_${nanoid2(10)}`,
        claimId: claim.id,
        userId: claim.userId,
        recipientName: claim.submitterName,
        amount: claim.totalPayable,
        paidAt: timestamp,
        reference: `ASASU-${timestamp.slice(0, 10).replaceAll("-", "")}-${claim.reference.slice(-4)}`,
        recipientPhone: recipient.phone,
        paymentAccount: { ...recipient.paymentAccount }
      };
      data.payments.push(payment);
    }
    if (parsed.data.note) claim.messages.push({ id: `msg_${nanoid2(10)}`, senderId: request.user.id, senderName: request.user.name, body: parsed.data.note, createdAt: timestamp });
    claim.updatedAt = timestamp;
    updated = claim;
    const title = action === "paid" ? "Commission paid" : action === "request_info" ? "More information requested" : `Claim ${claim.status.toLowerCase().replaceAll("_", " ")}`;
    data.notifications.push(notify(claim.userId, title, parsed.data.note || `${claim.reference} is now ${claim.status.replaceAll("_", " ").toLowerCase()}.`));
    logAction(data, request, `CLAIM_${action.toUpperCase()}`, action === "paid" ? "PAYMENT" : "CLAIM", claim.id, `${claim.reference} \u2192 ${claim.status}.`);
  });
  if (invalidTransition) return void response.status(409).json({ message: invalidTransition });
  if (!updated) return void response.status(404).json({ message: "Claim not found" });
  response.json({ claim: updated, payment });
});
app.post("/api/claims/:claimId/messages", requireAuth, async (request, response) => {
  const parsed = z.object({ body: z.string().min(2).max(1e3) }).safeParse(request.body);
  if (!parsed.success) return void response.status(400).json({ message: "Message body is required" });
  let updated;
  await store.mutate((data) => {
    const claim = data.claims.find((item) => item.id === request.params.claimId);
    if (!claim || !isStaffRole(request.user.role) && claim.userId !== request.user.id) return;
    const message = { id: `msg_${nanoid2(10)}`, senderId: request.user.id, senderName: request.user.name, body: parsed.data.body, createdAt: nowIso() };
    claim.messages.push(message);
    claim.updatedAt = message.createdAt;
    updated = claim;
    const targetUserId = isStaffRole(request.user.role) ? claim.userId : data.users.find((item) => item.role === "ADMIN")?.id;
    if (targetUserId) data.notifications.push(notify(targetUserId, "New claim message", `${request.user.name}: ${message.body}`));
  });
  if (!updated) return void response.status(404).json({ message: "Claim not found or inaccessible" });
  response.status(201).json(updated);
});
app.post("/api/disputes", requireAuth, evidenceUpload.single("evidence"), async (request, response) => {
  if (!isAgentRole(request.user.role)) return void response.status(403).json({ message: "Only agents can file client ownership disputes" });
  const parsed = z.object({ scheduleEntryId: z.string().min(1), reason: z.string().min(10).max(1200), evidenceNote: z.string().max(1200).optional(), evidenceFileName: z.string().max(255).optional() }).safeParse(request.body);
  if (!parsed.success) return void response.status(400).json({ message: "Explain why this client belongs to you." });
  let dispute;
  let unavailable = false;
  await store.mutate(async (data) => {
    const schedule = data.schedules.find((item) => item.entries.some((entry2) => entry2.id === parsed.data.scheduleEntryId));
    const entry = schedule?.entries.find((item) => item.id === parsed.data.scheduleEntryId);
    const claim = activeClaimForEntry(parsed.data.scheduleEntryId, data.claims);
    if (!schedule || !entry || !claim || claim.userId === request.user.id) {
      unavailable = true;
      return;
    }
    const existing = data.disputes.find((item) => item.scheduleEntryId === entry.id && item.raisedById === request.user.id && ["OPEN", "UNDER_REVIEW"].includes(item.status));
    if (existing) {
      dispute = existing;
      return;
    }
    const timestamp = nowIso();
    let evidenceFileKey;
    if (request.file) {
      const extension = request.file.mimetype === "application/pdf" ? ".pdf" : request.file.mimetype === "image/png" ? ".png" : request.file.mimetype === "image/webp" ? ".webp" : ".jpg";
      evidenceFileKey = `evidence_${nanoid2(12)}${extension}`;
      await fsPromises.mkdir(uploadRoot, { recursive: true });
      await fsPromises.writeFile(path2.join(uploadRoot, evidenceFileKey), request.file.buffer, { flag: "wx" });
    }
    dispute = {
      id: `dsp_${nanoid2(10)}`,
      reference: `DSP-${timestamp.slice(0, 10).replaceAll("-", "")}-${String(data.disputes.length + 1).padStart(4, "0")}`,
      scheduleEntryId: entry.id,
      scheduleId: schedule.id,
      clientName: entry.clientName,
      raisedById: request.user.id,
      raisedByName: request.user.name,
      againstClaimId: claim.id,
      againstUserId: claim.userId,
      againstUserName: claim.submitterName,
      reason: parsed.data.reason,
      evidenceNote: parsed.data.evidenceNote,
      evidenceFileName: request.file?.originalname ?? parsed.data.evidenceFileName,
      evidenceFileKey,
      status: "OPEN",
      messages: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    data.disputes.push(dispute);
    for (const admin of data.users.filter((item) => disputeReviewers.includes(item.role))) {
      data.notifications.push(notify(admin.id, "New ownership dispute", `${request.user.name} disputed ${entry.clientName}.`));
    }
    data.notifications.push(notify(claim.userId, "Claim ownership disputed", `${entry.clientName} is now under review.`));
    logAction(data, request, "DISPUTE_FILED", "DISPUTE", dispute.id, `${dispute.reference} filed for ${entry.clientName}.`);
  });
  if (unavailable) return void response.status(409).json({ message: "This row is not currently claimable through a dispute." });
  response.status(dispute?.status === "OPEN" ? 201 : 200).json(dispute);
});
app.patch("/api/disputes/:disputeId", requireAuth, requireRole(...disputeReviewers), async (request, response) => {
  const parsed = z.object({ action: z.enum(["review", "reject", "resolve", "transfer"]), note: z.string().max(1200).optional() }).safeParse(request.body);
  if (!parsed.success) return void response.status(400).json({ message: "Invalid dispute action" });
  let updated;
  await store.mutate((data) => {
    const dispute = data.disputes.find((item) => item.id === request.params.disputeId);
    if (!dispute) return;
    if (parsed.data.action === "review") dispute.status = "UNDER_REVIEW";
    if (parsed.data.action === "reject") dispute.status = "REJECTED";
    if (parsed.data.action === "resolve") dispute.status = "RESOLVED";
    if (parsed.data.action === "transfer") {
      const originalClaim = data.claims.find((claim) => claim.id === dispute.againstClaimId);
      const originalItem = originalClaim?.items.find((item) => item.scheduleEntryId === dispute.scheduleEntryId);
      const schedule = data.schedules.find((item) => item.id === dispute.scheduleId);
      const entry = schedule?.entries.find((item) => item.id === dispute.scheduleEntryId);
      const newOwner = data.users.find((item) => item.id === dispute.raisedById);
      if (originalClaim && originalItem && schedule && entry && newOwner && isAgentRole(newOwner.role)) {
        originalItem.status = "REJECTED";
        claimRollupItems(originalClaim);
        originalClaim.status = originalClaim.items.some((item2) => item2.status !== "REJECTED") ? "PARTIALLY_APPROVED" : "REJECTED";
        originalClaim.updatedAt = nowIso();
        const rate = allowedCommissionRate(newOwner.role);
        const item = createDirectClaimItem(entry, rate);
        const timestamp = nowIso();
        const transferredClaim = {
          id: `clm_${nanoid2(10)}`,
          reference: `CLM-${timestamp.slice(0, 10).replaceAll("-", "")}-${String(data.claims.length + 1).padStart(4, "0")}`,
          userId: newOwner.id,
          submitterName: newOwner.name,
          submitterRole: newOwner.role,
          scheduleId: schedule.id,
          scheduleTitle: schedule.title,
          branch: schedule.branch,
          status: "PENDING_VERIFICATION",
          commissionRate: rate,
          ...getClaimRollups([item]),
          items: [item],
          messages: [{ id: `msg_${nanoid2(10)}`, senderId: request.user.id, senderName: request.user.name, body: parsed.data.note || "Ownership transferred after dispute review.", createdAt: timestamp }],
          createdAt: timestamp,
          updatedAt: timestamp
        };
        data.claims.push(transferredClaim);
        dispute.status = "RESOLVED";
        dispute.resolution = parsed.data.note || `Claim transferred to ${newOwner.name}.`;
        data.notifications.push(notify(newOwner.id, "Dispute resolved in your favour", `${entry.clientName} has been transferred to your claim queue.`));
        data.notifications.push(notify(originalClaim.userId, "Claim ownership transferred", `${entry.clientName} was removed from ${originalClaim.reference}.`));
      }
    }
    dispute.updatedAt = nowIso();
    if (parsed.data.note && parsed.data.action !== "transfer") dispute.resolution = parsed.data.note;
    updated = dispute;
    logAction(data, request, `DISPUTE_${parsed.data.action.toUpperCase()}`, "DISPUTE", dispute.id, `${dispute.reference} \u2192 ${dispute.status}.`);
  });
  if (!updated) return void response.status(404).json({ message: "Dispute not found" });
  response.json(updated);
});
app.patch("/api/notifications/:notificationId/read", requireAuth, async (request, response) => {
  let found = false;
  await store.mutate((data) => {
    const notification = data.notifications.find((item) => item.id === request.params.notificationId && item.userId === request.user.id);
    if (!notification) return;
    notification.read = true;
    found = true;
  });
  if (!found) return void response.status(404).json({ message: "Notification not found" });
  response.status(204).send();
});
app.get("/api/tickets", requireAuth, async (request, response) => {
  const data = await store.read();
  response.json(scopedTickets(request.user.role, request.user.id, data.tickets));
});
app.post("/api/tickets", requireAuth, async (request, response) => {
  const parsed = z.object({ subject: z.string().min(3), description: z.string().min(5), priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM") }).safeParse(request.body);
  if (!parsed.success) return void response.status(400).json({ message: "Subject, description, and priority are required" });
  let ticket;
  await store.mutate((data) => {
    ticket = { id: `tkt_${nanoid2(10)}`, userId: request.user.id, submitterName: request.user.name, ...parsed.data, status: "OPEN", replies: [], createdAt: nowIso(), updatedAt: nowIso() };
    data.tickets.push(ticket);
    const admin = data.users.find((item) => item.role === "SUPPORT" || item.role === "ADMIN");
    if (admin) data.notifications.push(notify(admin.id, "New support ticket", `${request.user.name}: ${ticket.subject}`));
  });
  response.status(201).json(ticket);
});
app.post("/api/tickets/:ticketId/replies", requireAuth, async (request, response) => {
  const parsed = z.object({ body: z.string().min(2), status: z.enum(["OPEN", "WAITING", "RESOLVED"]).optional() }).safeParse(request.body);
  if (!parsed.success) return void response.status(400).json({ message: "Reply body is required" });
  let ticket;
  await store.mutate((data) => {
    const current = data.tickets.find((item) => item.id === request.params.ticketId);
    if (!current || !isStaffRole(request.user.role) && current.userId !== request.user.id) return;
    current.replies.push({ id: `rep_${nanoid2(10)}`, authorId: request.user.id, authorName: request.user.name, body: parsed.data.body, createdAt: nowIso() });
    current.status = parsed.data.status ?? (isStaffRole(request.user.role) ? "WAITING" : "OPEN");
    current.updatedAt = nowIso();
    const recipientId = isStaffRole(request.user.role) ? current.userId : data.users.find((item) => item.active && (item.role === "SUPPORT" || item.role === "ADMIN"))?.id;
    if (recipientId) data.notifications.push(notify(recipientId, "Support ticket updated", `${request.user.name} replied to \u201C${current.subject}\u201D.`));
    ticket = current;
  });
  if (!ticket) return void response.status(404).json({ message: "Ticket not found or inaccessible" });
  response.status(201).json(ticket);
});
app.get("/api/payments/export.csv", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "FINANCE", "AUDITOR"), async (_request, response) => {
  const data = await store.read();
  const rows = [["Payment ID", "Claim ID", "Recipient", "Phone", "Bank", "Account Name", "Account Number", "Amount", "Reference", "Paid At"], ...data.payments.map((payment) => {
    const recipient = data.users.find((user) => user.id === payment.userId);
    const account = payment.paymentAccount ?? recipient?.paymentAccount;
    return [payment.id, payment.claimId, payment.recipientName, payment.recipientPhone ?? recipient?.phone ?? "", account?.bankName ?? "", account?.accountName ?? "", account?.accountNumber ?? "", payment.amount, payment.reference, payment.paidAt];
  })];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  response.header("Content-Type", "text/csv");
  response.attachment("asasu-payment-log.csv").send(csv);
});
app.use("/api", (_request, response) => {
  response.status(404).json({ message: "API endpoint not found" });
});
app.use(express.static(webDistRoot));
app.use("/uploads/payment_schedules", express.static(scheduleUploadRoot));
app.use((request, response, next) => {
  if (request.method !== "GET" || request.path.startsWith("/api/")) return next();
  response.sendFile(path2.join(webDistRoot, "index.html"), (error) => error ? next() : void 0);
});
app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError) {
    response.status(400).json({ message: error.code === "LIMIT_FILE_SIZE" ? "The uploaded file is larger than 10 MB." : error.message });
    return;
  }
  if (error instanceof Error && error.message.startsWith("Evidence must be")) {
    response.status(400).json({ message: error.message });
    return;
  }
  console.error(error);
  response.status(500).json({ message: "The operation could not be completed." });
});
server.listen(port, async () => {
  await store.read();
  console.log(`ASASU Commission OS API listening on http://localhost:${port}`);
});
//# sourceMappingURL=index.js.map