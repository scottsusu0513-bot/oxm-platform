import { isDangerousValue, REDACTED } from "../store/sanitize";
import type { SmokeReport } from "./types";

const safe = (value: string | null): string | null => {
  if (value === null) return null;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  return isDangerousValue(normalized) ? REDACTED : normalized;
};

/** A final allow-list copy: raw process output, prompts, source and credentials cannot enter it. */
export function sanitizeSmokeReport(report: SmokeReport): SmokeReport {
  return {
    ...structuredClone(report),
    filesChanged: report.filesChanged.map((p) => safe(p) ?? "").filter(Boolean),
    validations: report.validations.map((v) => ({
      name: safe(v.name) ?? "unknown",
      requested: v.requested,
      executed: v.executed,
      status: v.status,
      trusted: v.trusted,
      ...(v.summary ? { summary: safe(v.summary) ?? REDACTED } : {}),
    })),
    failureReason: safe(report.failureReason),
  };
}

export function formatSmokeReport(report: SmokeReport): string {
  return JSON.stringify(sanitizeSmokeReport(report), null, 2);
}
