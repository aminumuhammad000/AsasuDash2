import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { Server } from "socket.io";
import { nanoid } from "nanoid";
import { z } from "zod";
import type {
  AgentRole,
  Claim,
  ClaimItem,
  Dispute,
  PaymentLogEntry,
  PaymentSchedule,
  PaymentScheduleEntry,
  Role,
  Ticket
} from "@asasu/shared";
import {
  allowedCommissionRate,
  buildQuarterlyLeaderboards,
  buildTrends,
  calculateCommission,
  calculateDashboardMetrics,
  getClaimRollups,
  initialClaimStatus,
  isAgentRole,
  isStaffRole,
  latestSchedule,
  nowIso,
  publicUser,
  roundCurrency
} from "./domain.js";
import type { DatabaseShape } from "./domain.js";
import { authMiddleware, authResponse, requireRole, verifyPassword } from "./auth.js";
import { createPreviewRows, parseClaimWorkbook, parseScheduleWorkbook } from "./parser.js";
import { openApiSpec } from "./openapi.js";
import { JsonStore } from "./store.js";

const app = express();
const server = http.createServer(app);
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4300);
const corsOrigin = process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(",").map((origin) => origin.trim()) : true;
const store = new JsonStore();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const allowed = [".xlsx", ".xls", ".csv"];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf("."));
    callback(null, allowed.includes(ext));
  }
});
const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
    if (allowedTypes.has(file.mimetype)) callback(null, true);
    else callback(new Error("Evidence must be a PNG, JPG, WEBP, or PDF file."));
  }
});
const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
const uploadRoot = path.resolve(moduleRoot, "../uploads/disputes");
const webDistRoot = path.resolve(moduleRoot, "../../web/dist");

const io = new Server(server, { cors: { origin: corsOrigin, credentials: true } });
io.on("connection", (socket) => {
  const userId = String(socket.handshake.auth.userId ?? "");
  if (userId) socket.join(userId);
});

app.use(helmet());
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false }));

const requireAuth = authMiddleware(store);
const scheduleManagers: Role[] = ["SUPER_ADMIN", "ADMIN", "OPERATIONS", "BRANCH_ADMIN"];
const claimReviewers: Role[] = ["SUPER_ADMIN", "ADMIN", "OPERATIONS", "BRANCH_ADMIN", "FINANCE"];
const disputeReviewers: Role[] = ["SUPER_ADMIN", "ADMIN", "OPERATIONS", "SUPPORT", "BRANCH_ADMIN"];
const paymentAccountViewers: Role[] = ["SUPER_ADMIN", "ADMIN", "FINANCE", "AUDITOR"];

function notify(userId: string, title: string, body: string) {
  const notification = { id: `ntf_${nanoid(10)}`, userId, title, body, read: false, createdAt: nowIso() };
  io.to(userId).emit("notification", notification);
  return notification;
}

function logAction(data: DatabaseShape, request: Request, action: string, entityType: "SCHEDULE" | "CLAIM" | "DISPUTE" | "PAYMENT" | "USER" | "AUTH", entityId: string, detail: string) {
  const actor = request.user;
  data.auditLog.push({
    id: `aud_${nanoid(10)}`,
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

function scopedClaims(role: Role, userId: string, claims: Claim[]) {
  return isStaffRole(role) ? claims : claims.filter((claim) => claim.userId === userId);
}

function scopedTickets(role: Role, userId: string, tickets: Ticket[]) {
  return isStaffRole(role) ? tickets : tickets.filter((ticket) => ticket.userId === userId);
}

function agentRole(role: Role): AgentRole {
  if (!isAgentRole(role)) throw new Error("Only agents can submit commission claims");
  return role;
}

function activeClaimForEntry(entryId: string, claims: Claim[]) {
  return claims.find(
    (claim) =>
      claim.status !== "REJECTED" &&
      claim.items.some((item) => item.scheduleEntryId === entryId && item.status !== "REJECTED")
  );
}

function decorateSchedule(schedule: PaymentSchedule, userId: string, role: Role, claims: Claim[]): PaymentSchedule {
  return {
    ...schedule,
    entries: schedule.entries.map((entry) => {
      const claim = activeClaimForEntry(entry.id, claims);
      if (!claim) return { ...entry, claimState: "AVAILABLE" };
      return {
        ...entry,
        claimState: claim.userId === userId ? "CLAIMED_BY_YOU" : "CLAIMED_BY_ANOTHER",
        claimId: claim.id,
        claimedByName: isStaffRole(role) ? claim.submitterName : undefined
      };
    })
  };
}

function claimRollupItems(claim: Claim) {
  const active = claim.items.filter((item) => item.status !== "REJECTED");
  Object.assign(claim, getClaimRollups(active));
}

function createDirectClaimItem(entry: PaymentScheduleEntry, rate: number): ClaimItem {
  return {
    id: `itm_${nanoid(10)}`,
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

app.post("/api/auth/login", async (request, response) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(request.body);
  if (!parsed.success) return void response.status(400).json({ message: "A valid email and password are required" });
  const data = await store.read();
  const user = data.users.find((item) => item.email.toLowerCase() === parsed.data.email.toLowerCase() && item.active);
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return void response.status(401).json({ message: "Invalid login credentials" });
  }
  response.json(authResponse(user));
});

app.get("/api/me", requireAuth, (request, response) => response.json(publicUser(request.user!)));

app.patch("/api/me/payment-account", requireAuth, async (request, response) => {
  if (!isAgentRole(request.user!.role)) {
    return void response.status(403).json({ message: "Only agents and sub-developers can update a payment account" });
  }
  const parsed = z
    .object({
      bankName: z.string().trim().min(2).max(80),
      accountName: z.string().trim().min(2).max(100),
      accountNumber: z.string().regex(/^\d{10}$/, "Enter a valid 10-digit account number"),
      phone: z.string().trim().min(7).max(24).regex(/^\+?[0-9()\-\s]+$/, "Enter a valid phone number")
    })
    .safeParse(request.body);
  if (!parsed.success) {
    return void response.status(400).json({ message: parsed.error.issues[0]?.message ?? "Enter valid payment account details" });
  }

  let updatedUser: typeof request.user;
  await store.mutate((data) => {
    const user = data.users.find((item) => item.id === request.user!.id);
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
  const user = request.user!;
  const safeUsers = data.users.map(publicUser);
  const canViewPaymentAccounts = paymentAccountViewers.includes(user.role);
  const claims = scopedClaims(user.role, user.id, data.claims).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const disputes = (isStaffRole(user.role) ? data.disputes : data.disputes.filter((item) => item.raisedById === user.id || item.againstUserId === user.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const published = latestSchedule(data.schedules);
  const schedule = published ? decorateSchedule(published, user.id, user.role, data.claims) : undefined;

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
    schedules: [...data.schedules]
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
      .map((item) => (item.id === schedule?.id ? schedule : { ...item, entries: [] })),
    users: isStaffRole(user.role) ? safeUsers.map((item) => canViewPaymentAccounts ? item : { ...item, paymentAccount: undefined }) : undefined,
    payments: isStaffRole(user.role) ? data.payments.map((item) => canViewPaymentAccounts ? item : { ...item, paymentAccount: undefined }) : data.payments.filter((payment) => payment.userId === user.id),
    auditLog: isStaffRole(user.role) ? [...data.auditLog].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100) : undefined
  });
});

app.get("/api/payment-schedules/:scheduleId/entries", requireAuth, async (request, response) => {
  const data = await store.read();
  const schedule = data.schedules.find((item) => item.id === request.params.scheduleId);
  if (!schedule || (schedule.status !== "PUBLISHED" && !isStaffRole(request.user!.role))) {
    return void response.status(404).json({ message: "Schedule not found" });
  }
  const decorated = decorateSchedule(schedule, request.user!.id, request.user!.role, data.claims);
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
  const schedule = await parseScheduleWorkbook(request.file.buffer, request.user!, request.body.title, request.file.originalname);
  if (!schedule.entries.length) return void response.status(422).json({ message: "No schedule rows found. Expected account name and RSA amount columns." });
  response.json({
    schedule,
    detectedColumns: ["Account number", "Client name", "RSA amount", "1% service charge", "2% service charge"],
    warnings: schedule.importWarnings,
    duplicateAccountNumbers: []
  });
});

app.post("/api/payment-schedules/upload", requireAuth, requireRole(...scheduleManagers), upload.single("file"), async (request, response) => {
  if (!request.file) return void response.status(400).json({ message: "Upload an Excel or CSV file" });
  const schedule = await parseScheduleWorkbook(request.file.buffer, request.user!, request.body.title, request.file.originalname);
  if (!schedule.entries.length) return void response.status(422).json({ message: "No schedule rows found. Expected account name and RSA amount columns." });

  let duplicate = false;
  await store.mutate((data) => {
    duplicate = data.schedules.some((item) => item.scheduleNumber === schedule.scheduleNumber && item.entryCount === schedule.entryCount);
    if (duplicate) return;
    data.schedules.push(schedule);
    for (const user of data.users.filter((item) => item.active && isAgentRole(item.role))) {
      data.notifications.push(notify(user.id, "New payment schedule published", `${schedule.branch} · ${schedule.paymentDate} is ready. Search your clients and claim in seconds.`));
    }
    data.notifications.push(notify(request.user!.id, "Schedule published", `${schedule.entryCount} clients imported with ${schedule.importWarnings.length} warning${schedule.importWarnings.length === 1 ? "" : "s"}.`));
    logAction(data, request, "SCHEDULE_PUBLISHED", "SCHEDULE", schedule.id, `${schedule.scheduleNumber} published with ${schedule.entryCount} rows.`);
  });
  if (duplicate) return void response.status(409).json({ message: "This schedule appears to have already been published." });
  response.status(201).json(schedule);
});

app.patch("/api/payment-schedules/:scheduleId/status", requireAuth, requireRole(...scheduleManagers), async (request, response) => {
  const parsed = z.object({ status: z.enum(["PUBLISHED", "ARCHIVED"]) }).safeParse(request.body);
  if (!parsed.success) return void response.status(400).json({ message: "Invalid schedule status" });
  let updated: PaymentSchedule | undefined;
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

// Legacy claim workbooks remain available only as a migration preview. New claims use schedule row IDs.
app.post("/api/uploads/claims/preview", requireAuth, upload.single("file"), async (request, response) => {
  if (!request.file) return void response.status(400).json({ message: "Upload an Excel or CSV file" });
  if (!isAgentRole(request.user!.role)) return void response.status(403).json({ message: "Only agents can submit claims" });
  const data = await store.read();
  const schedule = latestSchedule(data.schedules);
  const rows = await parseClaimWorkbook(request.file.buffer, request.file.originalname, request.user!.role);
  if (!rows.length) return void response.status(422).json({ message: "No legacy claim rows found." });
  response.json({ uploadId: `upl_${nanoid(10)}`, rows: createPreviewRows(rows, request.user!.role, schedule?.entries ?? []) });
});

app.post("/api/claims", requireAuth, async (request, response) => {
  if (!isAgentRole(request.user!.role)) return void response.status(403).json({ message: "Only agents and sub-developers can submit claims" });
  const parsed = z
    .object({
      scheduleId: z.string().min(1),
      scheduleEntryIds: z.array(z.string().min(1)).min(1).max(250),
      commissionRate: z.number().optional()
    })
    .safeParse(request.body);
  if (!parsed.success) return void response.status(400).json({ message: "Select at least one valid schedule row" });

  const user = request.user!;
  const role = agentRole(user.role);
  const rate = allowedCommissionRate(role, parsed.data.commissionRate);
  let createdClaim: Claim | undefined;
  let conflictClient: string | undefined;
  let invalidSelection = false;

  await store.mutate((data) => {
    const schedule = data.schedules.find((item) => item.id === parsed.data.scheduleId && item.status === "PUBLISHED");
    if (!schedule) {
      invalidSelection = true;
      return;
    }
    const uniqueIds = [...new Set(parsed.data.scheduleEntryIds)];
    const entries = uniqueIds.map((id) => schedule.entries.find((entry) => entry.id === id)).filter((entry): entry is PaymentScheduleEntry => Boolean(entry));
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
      id: `clm_${nanoid(10)}`,
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
      data.notifications.push(notify(admin.id, "New claim submitted", `${user.name} submitted ${items.length} client${items.length === 1 ? "" : "s"} for ₦${createdClaim.totalPayable.toLocaleString("en-NG")}.`));
    }
    logAction(data, request, "CLAIM_SUBMITTED", "CLAIM", createdClaim.id, `${createdClaim.reference}: ${items.length} rows at ${rate * 100}%.`);
  });

  if (invalidSelection) return void response.status(422).json({ message: "One or more selected rows are invalid or the schedule is no longer published." });
  if (conflictClient) return void response.status(409).json({ message: `${conflictClient} has already been claimed. Refresh the schedule to see its current status.` });
  response.status(201).json(createdClaim);
});

app.patch("/api/claims/:claimId/status", requireAuth, requireRole(...claimReviewers), async (request, response) => {
  const parsed = z
    .object({
      action: z.enum(["approve", "partial_approve", "reject", "request_info", "paid"]),
      approvedItemIds: z.array(z.string()).optional(),
      note: z.string().max(1000).optional()
    })
    .safeParse(request.body);
  if (!parsed.success) return void response.status(400).json({ message: "Invalid claim action" });
  if (parsed.data.action === "paid" && !["SUPER_ADMIN", "ADMIN", "FINANCE"].includes(request.user!.role)) {
    return void response.status(403).json({ message: "Only Finance or an administrator can mark claims as paid" });
  }

  let updated: Claim | undefined;
  let payment: PaymentLogEntry | undefined;
  let invalidTransition: string | undefined;
  await store.mutate((data) => {
    const claim = data.claims.find((item) => item.id === request.params.claimId);
    if (!claim) return;
    const timestamp = nowIso();
    const action = parsed.data.action;

    if (action === "approve") {
      claim.items.forEach((item) => (item.status = "APPROVED"));
      claim.status = "APPROVED";
    } else if (action === "partial_approve") {
      const approved = new Set(parsed.data.approvedItemIds ?? []);
      if (!approved.size) {
        invalidTransition = "Choose at least one client row for partial approval.";
        return;
      }
      claim.items.forEach((item) => (item.status = approved.has(item.id) ? "APPROVED" : "REJECTED"));
      claim.status = claim.items.every((item) => item.status === "APPROVED") ? "APPROVED" : "PARTIALLY_APPROVED";
      claimRollupItems(claim);
    } else if (action === "reject") {
      claim.items.forEach((item) => (item.status = "REJECTED"));
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
        id: `pay_${nanoid(10)}`,
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

    if (parsed.data.note) claim.messages.push({ id: `msg_${nanoid(10)}`, senderId: request.user!.id, senderName: request.user!.name, body: parsed.data.note, createdAt: timestamp });
    claim.updatedAt = timestamp;
    updated = claim;
    const title = action === "paid" ? "Commission paid" : action === "request_info" ? "More information requested" : `Claim ${claim.status.toLowerCase().replaceAll("_", " ")}`;
    data.notifications.push(notify(claim.userId, title, parsed.data.note || `${claim.reference} is now ${claim.status.replaceAll("_", " ").toLowerCase()}.`));
    logAction(data, request, `CLAIM_${action.toUpperCase()}`, action === "paid" ? "PAYMENT" : "CLAIM", claim.id, `${claim.reference} → ${claim.status}.`);
  });
  if (invalidTransition) return void response.status(409).json({ message: invalidTransition });
  if (!updated) return void response.status(404).json({ message: "Claim not found" });
  response.json({ claim: updated, payment });
});

app.post("/api/claims/:claimId/messages", requireAuth, async (request, response) => {
  const parsed = z.object({ body: z.string().min(2).max(1000) }).safeParse(request.body);
  if (!parsed.success) return void response.status(400).json({ message: "Message body is required" });
  let updated: Claim | undefined;
  await store.mutate((data) => {
    const claim = data.claims.find((item) => item.id === request.params.claimId);
    if (!claim || (!isStaffRole(request.user!.role) && claim.userId !== request.user!.id)) return;
    const message = { id: `msg_${nanoid(10)}`, senderId: request.user!.id, senderName: request.user!.name, body: parsed.data.body, createdAt: nowIso() };
    claim.messages.push(message);
    claim.updatedAt = message.createdAt;
    updated = claim;
    const targetUserId = isStaffRole(request.user!.role) ? claim.userId : data.users.find((item) => item.role === "ADMIN")?.id;
    if (targetUserId) data.notifications.push(notify(targetUserId, "New claim message", `${request.user!.name}: ${message.body}`));
  });
  if (!updated) return void response.status(404).json({ message: "Claim not found or inaccessible" });
  response.status(201).json(updated);
});

app.post("/api/disputes", requireAuth, evidenceUpload.single("evidence"), async (request, response) => {
  if (!isAgentRole(request.user!.role)) return void response.status(403).json({ message: "Only agents can file client ownership disputes" });
  const parsed = z
    .object({ scheduleEntryId: z.string().min(1), reason: z.string().min(10).max(1200), evidenceNote: z.string().max(1200).optional(), evidenceFileName: z.string().max(255).optional() })
    .safeParse(request.body);
  if (!parsed.success) return void response.status(400).json({ message: "Explain why this client belongs to you." });
  let dispute: Dispute | undefined;
  let unavailable = false;
  await store.mutate(async (data) => {
    const schedule = data.schedules.find((item) => item.entries.some((entry) => entry.id === parsed.data.scheduleEntryId));
    const entry = schedule?.entries.find((item) => item.id === parsed.data.scheduleEntryId);
    const claim = activeClaimForEntry(parsed.data.scheduleEntryId, data.claims);
    if (!schedule || !entry || !claim || claim.userId === request.user!.id) {
      unavailable = true;
      return;
    }
    const existing = data.disputes.find((item) => item.scheduleEntryId === entry.id && item.raisedById === request.user!.id && ["OPEN", "UNDER_REVIEW"].includes(item.status));
    if (existing) {
      dispute = existing;
      return;
    }
    const timestamp = nowIso();
    let evidenceFileKey: string | undefined;
    if (request.file) {
      const extension = request.file.mimetype === "application/pdf" ? ".pdf" : request.file.mimetype === "image/png" ? ".png" : request.file.mimetype === "image/webp" ? ".webp" : ".jpg";
      evidenceFileKey = `evidence_${nanoid(12)}${extension}`;
      await fs.mkdir(uploadRoot, { recursive: true });
      await fs.writeFile(path.join(uploadRoot, evidenceFileKey), request.file.buffer, { flag: "wx" });
    }
    dispute = {
      id: `dsp_${nanoid(10)}`,
      reference: `DSP-${timestamp.slice(0, 10).replaceAll("-", "")}-${String(data.disputes.length + 1).padStart(4, "0")}`,
      scheduleEntryId: entry.id,
      scheduleId: schedule.id,
      clientName: entry.clientName,
      raisedById: request.user!.id,
      raisedByName: request.user!.name,
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
      data.notifications.push(notify(admin.id, "New ownership dispute", `${request.user!.name} disputed ${entry.clientName}.`));
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
  let updated: Dispute | undefined;
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
        originalClaim.status = originalClaim.items.some((item) => item.status !== "REJECTED") ? "PARTIALLY_APPROVED" : "REJECTED";
        originalClaim.updatedAt = nowIso();
        const rate = allowedCommissionRate(newOwner.role);
        const item = createDirectClaimItem(entry, rate);
        const timestamp = nowIso();
        const transferredClaim: Claim = {
          id: `clm_${nanoid(10)}`,
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
          messages: [{ id: `msg_${nanoid(10)}`, senderId: request.user!.id, senderName: request.user!.name, body: parsed.data.note || "Ownership transferred after dispute review.", createdAt: timestamp }],
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
    logAction(data, request, `DISPUTE_${parsed.data.action.toUpperCase()}`, "DISPUTE", dispute.id, `${dispute.reference} → ${dispute.status}.`);
  });
  if (!updated) return void response.status(404).json({ message: "Dispute not found" });
  response.json(updated);
});

app.patch("/api/notifications/:notificationId/read", requireAuth, async (request, response) => {
  let found = false;
  await store.mutate((data) => {
    const notification = data.notifications.find((item) => item.id === request.params.notificationId && item.userId === request.user!.id);
    if (!notification) return;
    notification.read = true;
    found = true;
  });
  if (!found) return void response.status(404).json({ message: "Notification not found" });
  response.status(204).send();
});

app.get("/api/tickets", requireAuth, async (request, response) => {
  const data = await store.read();
  response.json(scopedTickets(request.user!.role, request.user!.id, data.tickets));
});

app.post("/api/tickets", requireAuth, async (request, response) => {
  const parsed = z.object({ subject: z.string().min(3), description: z.string().min(5), priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM") }).safeParse(request.body);
  if (!parsed.success) return void response.status(400).json({ message: "Subject, description, and priority are required" });
  let ticket: Ticket | undefined;
  await store.mutate((data) => {
    ticket = { id: `tkt_${nanoid(10)}`, userId: request.user!.id, submitterName: request.user!.name, ...parsed.data, status: "OPEN", replies: [], createdAt: nowIso(), updatedAt: nowIso() };
    data.tickets.push(ticket);
    const admin = data.users.find((item) => item.role === "SUPPORT" || item.role === "ADMIN");
    if (admin) data.notifications.push(notify(admin.id, "New support ticket", `${request.user!.name}: ${ticket.subject}`));
  });
  response.status(201).json(ticket);
});

app.post("/api/tickets/:ticketId/replies", requireAuth, async (request, response) => {
  const parsed = z.object({ body: z.string().min(2), status: z.enum(["OPEN", "WAITING", "RESOLVED"]).optional() }).safeParse(request.body);
  if (!parsed.success) return void response.status(400).json({ message: "Reply body is required" });
  let ticket: Ticket | undefined;
  await store.mutate((data) => {
    const current = data.tickets.find((item) => item.id === request.params.ticketId);
    if (!current || (!isStaffRole(request.user!.role) && current.userId !== request.user!.id)) return;
    current.replies.push({ id: `rep_${nanoid(10)}`, authorId: request.user!.id, authorName: request.user!.name, body: parsed.data.body, createdAt: nowIso() });
    current.status = parsed.data.status ?? (isStaffRole(request.user!.role) ? "WAITING" : "OPEN");
    current.updatedAt = nowIso();
    const recipientId = isStaffRole(request.user!.role)
      ? current.userId
      : data.users.find((item) => item.active && (item.role === "SUPPORT" || item.role === "ADMIN"))?.id;
    if (recipientId) data.notifications.push(notify(recipientId, "Support ticket updated", `${request.user!.name} replied to “${current.subject}”.`));
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

// Fallback for unmatched API routes to ensure JSON is returned instead of static HTML fallback
app.use("/api", (_request, response) => {
  response.status(404).json({ message: "API endpoint not found" });
});

// A production build is served by the API process so the portal can deploy as one service.
app.use(express.static(webDistRoot));
app.use((request, response, next) => {
  if (request.method !== "GET" || request.path.startsWith("/api/")) return next();
  response.sendFile(path.join(webDistRoot, "index.html"), (error) => error ? next() : undefined);
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
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
