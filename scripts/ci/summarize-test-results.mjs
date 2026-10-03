// CI only: turn the Vitest JSON report into ONE GitHub annotation that lists
// every failed test (GitHub shows at most 10 per-test failure annotations).
import fs from "node:fs";

const reportPath = process.argv[2];
if (!reportPath || !fs.existsSync(reportPath)) {
  console.log("no test report found");
  process.exit(0);
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const firstLine = (text) => String(text ?? "").split("\n")[0].slice(0, 200);
const failures = [];
for (const file of report.testResults) {
  const name = file.name.replace(`${process.cwd()}/`, "");
  const failed = file.assertionResults.filter((a) => a.status === "failed");
  if (failed.length === 0 && file.status === "failed") failures.push(`${name} :: (file-level) ${firstLine(file.message)}`);
  for (const a of failed) failures.push(`${name} :: ${a.fullName.slice(0, 140)} :: ${firstLine(a.failureMessages[0])}`);
}

const failedFiles = report.testResults.filter((f) => f.status === "failed").length;
const skipped = (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0);
const head = `files ${report.testResults.length} (failed ${failedFiles}) | tests ${report.numTotalTests}: passed ${report.numPassedTests}, failed ${report.numFailedTests}, skipped ${skipped}`;
console.log(head);
for (const line of failures) console.log(line);

const escape = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const level = failures.length > 0 ? "error" : "notice";
console.log(`::${level} title=full-test summary::${escape([head, ...failures].join("\n"))}`);
