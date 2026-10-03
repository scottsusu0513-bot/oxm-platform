// CI only: turn the Vitest JSON report into ONE GitHub annotation that lists
// every failed test (GitHub shows at most 10 per-test failure annotations).
import fs from "node:fs";

const reportPath = process.argv[2];
if (!reportPath || !fs.existsSync(reportPath)) {
  console.log("no test report found");
  process.exit(0);
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
// First line plus the underlying "Caused by:" line (e.g. the MySQL error behind
// a drizzle "Failed query"), which is what actually explains DB failures.
const describe = (text) => {
  const lines = String(text ?? "").split("\n");
  const cause = lines.find((l) => /Caused by:/.test(l));
  return [lines[0].slice(0, 200), cause ? cause.trim().slice(0, 240) : ""].filter(Boolean).join(" <- ");
};
const failures = [];
const skippedTests = [];
for (const file of report.testResults) {
  const name = file.name.replace(`${process.cwd()}/`, "");
  const failed = file.assertionResults.filter((a) => a.status === "failed");
  if (failed.length === 0 && file.status === "failed") failures.push(`${name} :: (file-level) ${describe(file.message)}`);
  for (const a of failed) failures.push(`${name} :: ${a.fullName.slice(0, 140)} :: ${describe(a.failureMessages[0])}`);
  for (const a of file.assertionResults) {
    if (a.status === "pending" || a.status === "skipped" || a.status === "todo") skippedTests.push(`${name} :: ${a.fullName.slice(0, 140)}`);
  }
}

const failedFiles = report.testResults.filter((f) => f.status === "failed").length;
const skipped = (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0);
const head = `files ${report.testResults.length} (failed ${failedFiles}) | tests ${report.numTotalTests}: passed ${report.numPassedTests}, failed ${report.numFailedTests}, skipped ${skipped}`;
console.log(head);
for (const line of failures) console.log(line);

const escape = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const level = failures.length > 0 ? "error" : "notice";
console.log(`::${level} title=full-test summary::${escape([head, ...failures].join("\n"))}`);
if (skippedTests.length > 0) {
  console.log(`::notice title=full-test skipped::${escape([`skipped ${skippedTests.length}`, ...skippedTests].join("\n"))}`);
}
