export type Role =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "FINANCE"
  | "OPERATIONS"
  | "AUDITOR"
  | "SUPPORT"
  | "BRANCH_ADMIN"
  | "AGENT"
  | "SUB_DEVELOPER";

export type AgentRole = "AGENT" | "SUB_DEVELOPER";
export type StaffRole = Exclude<Role, AgentRole>;

export type ClaimStatus =
  | "PENDING_VERIFICATION"
  | "NEEDS_REVIEW"
  | "INFO_REQUESTED"
  | "PARTIALLY_APPROVED"
  | "APPROVED"
  | "REJECTED"
  | "PAID";

export type ScheduleStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type EntryClaimState = "AVAILABLE" | "CLAIMED_BY_YOU" | "CLAIMED_BY_ANOTHER";
export type DisputeStatus = "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "REJECTED";
export type TicketStatus = "OPEN" | "WAITING" | "RESOLVED";
export type TicketPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type MatchStatus = "MATCHED" | "NEEDS_REVIEW" | "NO_MATCH";

export interface PaymentAccount {
  bankName: string;
  accountName: string;
  accountNumber: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  agency: string;
  branch?: string;
  phone?: string;
  paymentAccount?: PaymentAccount;
  active: boolean;
  createdAt: string;
}

export interface AuthUser extends User {
  token: string;
}

export interface PaymentScheduleEntry {
  id: string;
  scheduleId: string;
  sourceSheet: string;
  rowNumber: number;
  serialNumber?: string;
  accountNo?: string;
  applicationNumber?: string;
  clientName: string;
  rsaAmount: number;
  paymentDate?: string;
  serviceCharge?: number;
  threePercentServiceCharge?: number;
  onePercentServiceCharge?: number;
  twoPercentServiceCharge?: number;
  netAmount?: number;
  claimState?: EntryClaimState;
  claimId?: string;
  claimedByName?: string;
}

export interface PaymentSchedule {
  id: string;
  title: string;
  scheduleNumber: string;
  branch: string;
  bankName: string;
  paymentDate: string;
  sourceFileName?: string;
  status: ScheduleStatus;
  uploadedBy: string;
  uploadedAt: string;
  publishedAt?: string;
  entryCount: number;
  totalRsaAmount: number;
  totalServiceCharge: number;
  importWarnings: string[];
  entries: PaymentScheduleEntry[];
}

export interface ScheduleImportPreview {
  schedule: PaymentSchedule;
  detectedColumns: string[];
  warnings: string[];
  duplicateAccountNumbers: string[];
}

export interface ClaimComparison {
  scheduleEntryId?: string;
  officialClientName?: string;
  officialAmount?: number;
  amountDelta?: number;
  matchScore: number;
  status: MatchStatus;
  notes: string[];
}

export interface ClaimItem {
  id: string;
  scheduleEntryId: string;
  clientName: string;
  applicationNumber?: string;
  rsaAmount: number;
  serviceCharge: number;
  commissionRate: number;
  commissionAmount: number;
  processingFeeApplied: boolean;
  processingFeeAmount: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  comparison: ClaimComparison;
}

export interface ClaimMessage {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
}

export interface Claim {
  id: string;
  reference: string;
  userId: string;
  submitterName: string;
  submitterRole: AgentRole;
  scheduleId: string;
  scheduleTitle: string;
  branch: string;
  status: ClaimStatus;
  matchScore: number;
  totalRsaAmount: number;
  totalServiceCharge: number;
  commissionRate: number;
  commissionAmount: number;
  processingFeeAmount: number;
  totalPayable: number;
  items: ClaimItem[];
  messages: ClaimMessage[];
  createdAt: string;
  updatedAt: string;
  paidAt?: string;
}

export interface DisputeMessage {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
}

export interface Dispute {
  id: string;
  reference: string;
  scheduleEntryId: string;
  scheduleId: string;
  clientName: string;
  raisedById: string;
  raisedByName: string;
  againstClaimId: string;
  againstUserId: string;
  againstUserName: string;
  reason: string;
  evidenceNote?: string;
  evidenceFileName?: string;
  evidenceFileKey?: string;
  status: DisputeStatus;
  resolution?: string;
  messages: DisputeMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  entityType: "SCHEDULE" | "CLAIM" | "DISPUTE" | "PAYMENT" | "USER" | "AUTH";
  entityId: string;
  detail: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
}

export interface TicketReply {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface Ticket {
  id: string;
  userId: string;
  submitterName: string;
  subject: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  replies: TicketReply[];
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface PaymentLogEntry {
  id: string;
  claimId: string;
  userId: string;
  recipientName: string;
  amount: number;
  paidAt: string;
  reference: string;
  recipientPhone?: string;
  paymentAccount?: PaymentAccount;
}

export interface DashboardMetrics {
  totalCommissionEarned: number;
  pendingClaims: number;
  approvedClaims: number;
  totalPaid: number;
  totalProcessingFeesEarned: number;
  availableClients: number;
  totalAgents?: number;
  totalSubDevelopers?: number;
  totalClaimsPending?: number;
  totalCommissionsPaidThisMonth?: number;
  totalProcessingFeesCollected?: number;
  schedulesUploaded?: number;
  openDisputes?: number;
  averageApprovalHours?: number;
  paidToday?: number;
}

export interface TrendPoint {
  month: string;
  commission: number;
  processingFees: number;
  paid: number;
}

export interface UploadPreviewRow {
  id: string;
  clientName: string;
  serviceCharge: number;
  processingFeeApplied: boolean;
  commissionRate: number;
  commissionAmount: number;
  processingFeeAmount: number;
  comparison: ClaimComparison;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  role: AgentRole;
  agency: string;
  branch?: string;
  verifiedSalesVolume: number;
  commissionEarned: number;
  commissionPaid: number;
  approvedClients: number;
  approvedClaims: number;
}

export interface QuarterlyLeaderboard {
  key: string;
  label: string;
  year: number;
  quarter: number;
  startsAt: string;
  endsAt: string;
  agents: LeaderboardEntry[];
  subDevelopers: LeaderboardEntry[];
}

export interface DashboardPayload {
  user: User;
  metrics: DashboardMetrics;
  trends: TrendPoint[];
  leaderboards: QuarterlyLeaderboard[];
  claims: Claim[];
  tickets: Ticket[];
  disputes: Dispute[];
  notifications: Notification[];
  schedule?: PaymentSchedule;
  schedules: PaymentSchedule[];
  users?: User[];
  payments?: PaymentLogEntry[];
  auditLog?: AuditLogEntry[];
}
