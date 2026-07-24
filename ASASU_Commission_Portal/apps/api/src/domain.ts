import type {
  AgentRole,
  AuditLogEntry,
  Claim,
  ClaimItem,
  ClaimStatus,
  DashboardMetrics,
  Dispute,
  Notification,
  PaymentLogEntry,
  PaymentSchedule,
  PaymentScheduleEntry,
  QuarterlyLeaderboard,
  Role,
  Ticket,
  TrendPoint,
  User
} from "@asasu/shared";

export interface StoredUser extends User {
  passwordHash: string;
}

export interface DatabaseShape {
  users: StoredUser[];
  schedules: PaymentSchedule[];
  claims: Claim[];
  disputes: Dispute[];
  tickets: Ticket[];
  notifications: Notification[];
  payments: PaymentLogEntry[];
  auditLog: AuditLogEntry[];
}

export const COMMISSION_RATES: Record<AgentRole, number> = {
  AGENT: 0.01,
  SUB_DEVELOPER: 0.02
};

export const SUB_DEVELOPER_RATES = [0.015, 0.02] as const;
export const PROCESSING_FEE = 0;

const STAFF_ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "FINANCE", "OPERATIONS", "AUDITOR", "SUPPORT", "BRANCH_ADMIN"];

export function isStaffRole(role: Role) {
  return STAFF_ROLES.includes(role);
}

export function isAgentRole(role: Role): role is AgentRole {
  return role === "AGENT" || role === "SUB_DEVELOPER";
}

export function nowIso() {
  return new Date().toISOString();
}

export function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function normalizeName(value: string) {
  return value
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function publicUser(user: StoredUser): User {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

export function allowedCommissionRate(role: AgentRole, requestedRate?: number) {
  if (role === "AGENT") return COMMISSION_RATES.AGENT;
  return SUB_DEVELOPER_RATES.includes(requestedRate as (typeof SUB_DEVELOPER_RATES)[number]) ? requestedRate! : COMMISSION_RATES.SUB_DEVELOPER;
}

export function calculateCommission(rsaAmount: number, rate: number) {
  return roundCurrency(rsaAmount * rate);
}

export function getClaimRollups(items: ClaimItem[]) {
  const totalRsaAmount = roundCurrency(items.reduce((sum, item) => sum + item.rsaAmount, 0));
  const totalServiceCharge = roundCurrency(items.reduce((sum, item) => sum + item.serviceCharge, 0));
  const commissionAmount = roundCurrency(items.reduce((sum, item) => sum + item.commissionAmount, 0));
  const processingFeeAmount = roundCurrency(items.reduce((sum, item) => sum + item.processingFeeAmount, 0));
  const totalPayable = roundCurrency(commissionAmount + processingFeeAmount);
  const matchScore = Math.round(items.reduce((sum, item) => sum + item.comparison.matchScore, 0) / Math.max(items.length, 1));
  return { totalRsaAmount, totalServiceCharge, commissionAmount, processingFeeAmount, totalPayable, matchScore };
}

export function initialClaimStatus(items: ClaimItem[]): ClaimStatus {
  return items.every((item) => item.comparison.status === "MATCHED") ? "PENDING_VERIFICATION" : "NEEDS_REVIEW";
}

export function latestSchedule(schedules: PaymentSchedule[]) {
  return [...schedules]
    .filter((schedule) => schedule.status === "PUBLISHED")
    .sort((a, b) => (b.publishedAt ?? b.uploadedAt).localeCompare(a.publishedAt ?? a.uploadedAt))[0];
}

export function calculateDashboardMetrics(
  user: User,
  users: User[],
  claims: Claim[],
  payments: PaymentLogEntry[],
  schedules: PaymentSchedule[],
  disputes: Dispute[]
): DashboardMetrics {
  const admin = isStaffRole(user.role);
  const scopedClaims = admin ? claims : claims.filter((claim) => claim.userId === user.id);
  const earnedClaims = admin ? scopedClaims : scopedClaims.filter((claim) => ["APPROVED", "PARTIALLY_APPROVED", "PAID"].includes(claim.status));
  const pendingStatuses: ClaimStatus[] = ["PENDING_VERIFICATION", "NEEDS_REVIEW", "INFO_REQUESTED", "PARTIALLY_APPROVED"];
  const thisMonth = nowIso().slice(0, 7);
  const today = nowIso().slice(0, 10);
  const activeEntryIds = new Set(
    claims
      .filter((claim) => claim.status !== "REJECTED")
      .flatMap((claim) => claim.items.filter((item) => item.status !== "REJECTED").map((item) => item.scheduleEntryId))
  );

  const approvalDurations = claims
    .filter((claim) => ["APPROVED", "PAID", "PARTIALLY_APPROVED"].includes(claim.status))
    .map((claim) => (new Date(claim.updatedAt).getTime() - new Date(claim.createdAt).getTime()) / 3_600_000)
    .filter((duration) => Number.isFinite(duration) && duration >= 0);

  const metrics: DashboardMetrics = {
    totalCommissionEarned: roundCurrency(earnedClaims.reduce((sum, claim) => sum + claim.commissionAmount, 0)),
    pendingClaims: scopedClaims.filter((claim) => pendingStatuses.includes(claim.status)).length,
    approvedClaims: scopedClaims.filter((claim) => ["APPROVED", "PAID", "PARTIALLY_APPROVED"].includes(claim.status)).length,
    totalPaid: roundCurrency(scopedClaims.filter((claim) => claim.status === "PAID").reduce((sum, claim) => sum + claim.totalPayable, 0)),
    totalProcessingFeesEarned: roundCurrency(scopedClaims.reduce((sum, claim) => sum + claim.processingFeeAmount, 0)),
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
    metrics.averageApprovalHours = approvalDurations.length
      ? roundCurrency(approvalDurations.reduce((sum, duration) => sum + duration, 0) / approvalDurations.length)
      : 0;
    metrics.paidToday = roundCurrency(payments.filter((payment) => payment.paidAt.startsWith(today)).reduce((sum, payment) => sum + payment.amount, 0));
  }

  return metrics;
}

export function buildTrends(user: User, claims: Claim[]): TrendPoint[] {
  const monthKeys = Array.from({ length: 6 }, (_, index) => {
    const date = new Date();
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

export function scheduleTotals(entries: PaymentScheduleEntry[]) {
  return {
    totalRsaAmount: roundCurrency(entries.reduce((sum, entry) => sum + entry.rsaAmount, 0)),
    totalServiceCharge: roundCurrency(entries.reduce((sum, entry) => sum + (entry.onePercentServiceCharge ?? entry.serviceCharge ?? 0), 0))
  };
}

export function buildQuarterlyLeaderboards(
  users: User[],
  claims: Claim[],
  payments: PaymentLogEntry[],
  periodCount = 8
): QuarterlyLeaderboard[] {
  const now = new Date();
  const currentQuarterIndex = now.getUTCFullYear() * 4 + Math.floor(now.getUTCMonth() / 3);
  const eligibleUsers = users.filter((user) => user.active && isAgentRole(user.role));
  const qualifiedStatuses: ClaimStatus[] = ["APPROVED", "PARTIALLY_APPROVED", "PAID"];

  return Array.from({ length: periodCount }, (_, offset) => {
    const quarterIndex = currentQuarterIndex - offset;
    const year = Math.floor(quarterIndex / 4);
    const quarter = (quarterIndex % 4) + 1;
    const startsAt = new Date(Date.UTC(year, (quarter - 1) * 3, 1));
    const endsAt = new Date(Date.UTC(year, quarter * 3, 1));
    const inPeriod = (value: string) => {
      const time = new Date(value).getTime();
      return time >= startsAt.getTime() && time < endsAt.getTime();
    };

    const entries = eligibleUsers.map((partner) => {
      const partnerClaims = claims.filter((claim) => {
        const performanceDate = claim.paidAt ?? claim.updatedAt ?? claim.createdAt;
        return claim.userId === partner.id && qualifiedStatuses.includes(claim.status) && inPeriod(performanceDate);
      });
      const approvedItems = partnerClaims.flatMap((claim) =>
        claim.items.filter((item) => item.status === "APPROVED" || (claim.status === "PAID" && item.status !== "REJECTED"))
      );
      const commissionPaid = payments
        .filter((payment) => payment.userId === partner.id && inPeriod(payment.paidAt))
        .reduce((sum, payment) => sum + payment.amount, 0);

      return {
        rank: 0,
        userId: partner.id,
        name: partner.name,
        role: partner.role as AgentRole,
        agency: partner.agency,
        branch: partner.branch,
        verifiedSalesVolume: roundCurrency(approvedItems.reduce((sum, item) => sum + item.rsaAmount, 0)),
        commissionEarned: roundCurrency(approvedItems.reduce((sum, item) => sum + item.commissionAmount + item.processingFeeAmount, 0)),
        commissionPaid: roundCurrency(commissionPaid),
        approvedClients: approvedItems.length,
        approvedClaims: partnerClaims.length
      };
    });

    const ranked = (role: AgentRole) =>
      entries
        .filter((entry) => entry.role === role)
        .sort((a, b) =>
          b.verifiedSalesVolume - a.verifiedSalesVolume ||
          b.approvedClients - a.approvedClients ||
          b.commissionPaid - a.commissionPaid ||
          a.name.localeCompare(b.name)
        )
        .map((entry, index) => ({ ...entry, rank: index + 1 }));

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
