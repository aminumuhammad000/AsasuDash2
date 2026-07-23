import type { AgentRole, ClaimComparison, PaymentScheduleEntry } from "@asasu/shared";
import { normalizeName, roundCurrency } from "./domain.js";
import type { UploadedClaimRow } from "./parser.js";

function tokenScore(left: string, right: string) {
  const leftTokens = new Set(normalizeName(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeName(right).split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function roleAmount(entry: PaymentScheduleEntry, role: AgentRole) {
  if (role === "SUB_DEVELOPER") {
    return entry.twoPercentServiceCharge ?? entry.rsaAmount * 0.02;
  }
  return entry.onePercentServiceCharge ?? entry.serviceCharge ?? entry.rsaAmount * 0.01;
}

function amountScore(uploadedAmount: number, officialAmount: number) {
  const delta = Math.abs(uploadedAmount - officialAmount);
  const base = Math.max(Math.abs(uploadedAmount), Math.abs(officialAmount), 1);
  return Math.max(0, 1 - delta / base);
}

export function matchUploadedRow(
  row: Pick<UploadedClaimRow, "clientName" | "serviceCharge">,
  role: AgentRole,
  scheduleEntries: PaymentScheduleEntry[]
): ClaimComparison {
  const candidates = scheduleEntries
    .map((entry) => {
      const officialAmount = roleAmount(entry, role);
      const name = tokenScore(row.clientName, entry.clientName);
      const amount = amountScore(row.serviceCharge, officialAmount);
      const score = Math.round((name * 0.7 + amount * 0.3) * 100);
      return { entry, officialAmount, name, amount, score };
    })
    .sort((a, b) => b.score - a.score);

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
  const notes: string[] = [];

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
