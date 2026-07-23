import bcrypt from "bcryptjs";
import type { Claim, ClaimItem, PaymentSchedule, PaymentScheduleEntry, Ticket } from "@asasu/shared";
import { calculateCommission, getClaimRollups, roundCurrency, scheduleTotals } from "./domain.js";
import type { DatabaseShape, StoredUser } from "./domain.js";

const createdAt = "2026-07-20T08:30:00.000Z";

function hash(password: string) {
  return bcrypt.hashSync(password, 10);
}

const sourceRows = [
  ["001282273061", "OWOYALUMO, STEPHEN-MUSA", 22_811_592.83],
  ["001281595211", "YAKUBU, JAMILA ADAMU", 17_656_916.98],
  ["001282104992", "ALIYU, AHMAD MOHAMMED", 15_168_533.04],
  ["001282326511", "AGWU, COMFORT ONYE", 15_105_759.24],
  ["001282257941", "ISTIFANUS, BULUS", 11_876_523.5],
  ["001281810581", "IGBINOSA, IKPONMWEN BENS", 10_687_514.67],
  ["001282295451", "DANBATTA, ABUBAKAR SULE", 10_469_744.11],
  ["001282326481", "TANIMU, ISMAIL MAIDOKI", 10_177_623.39],
  ["001282249451", "MUSA, IBRAHIM GULANI", 10_120_696.77],
  ["001282041631", "ADIEZE, CHIEMEKA KELECHI", 9_388_996.59],
  ["001282309831", "DADA, OLUWADARE EMMANUE", 9_046_226.11],
  ["001282261211", "ABALI, IBRAHIM BABA", 8_595_199.11]
] as const;

function scheduleEntry(index: number, row: (typeof sourceRows)[number]): PaymentScheduleEntry {
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
    netAmount: roundCurrency(rsaAmount - calculateCommission(rsaAmount, 0.031) - 20_000)
  };
}

function claimItem(entry: PaymentScheduleEntry, rate: number, id: string): ClaimItem {
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

export function createSeedData(): DatabaseShape {
  const users: StoredUser[] = [
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
  const schedule: PaymentSchedule = {
    id: "sch_20jul2026",
    title: "25% RSA Transactions · Abuja",
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

  const agentItems = [claimItem(entries[0]!, 0.01, "itm_seed_agent_1")];
  const agentRollups = getClaimRollups(agentItems);
  const developerItems = [claimItem(entries[4]!, 0.02, "itm_seed_dev_1"), claimItem(entries[5]!, 0.02, "itm_seed_dev_2")];
  developerItems.forEach((item) => (item.status = "APPROVED"));
  const developerRollups = getClaimRollups(developerItems);

  const claims: Claim[] = [
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

  const tickets: Ticket[] = [
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
        body: "Abuja · 20 July 2026 is ready. Search your clients and claim in seconds.",
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
