import type { TaskAction, TaskMode } from "../domain/types";

/**
 * Trusted, deterministic multilingual risk interpretation.
 *
 * The owner may write in Traditional/Simplified Chinese, English, or a mix
 * ("幫我把 production 的使用者全部清掉"). Text is normalized (NFKC, case,
 * whitespace) and matched against CONCEPT groups (environment, data store,
 * destructive verb, deploy, secret, exposure, security boundary, disable,
 * force push, protected branch, migration). Risk comes from COMBINATIONS of
 * concepts, not from single keywords, and every hit is typed and auditable
 * (signal kind, rule id, matched evidence, source).
 *
 * Signals only ever ADD typed domain actions (prod_db_write, prod_deploy,
 * force_push, secret_exposure, ...), and domain/risk takes the maximum, so
 * no signal source (lexicon or planner observation) can lower a risk level.
 */

export const RISK_SIGNAL_KINDS = [
  "prod_data_write",
  "destructive_data_delete",
  "prod_deploy",
  "secret_exposure",
  "secret_change",
  "security_control_disable",
  "force_push",
  "protected_branch_write",
  "destructive_migration",
  /** Production / secret / destructive indicator in a mutation request without a more specific rule: conservative red. */
  "sensitive_operation_unresolved",
  /** Authentication / security boundary touched by a change (yellow; red only with a disable concept). */
  "security_boundary_change",
] as const;
export type RiskSignalKind = (typeof RISK_SIGNAL_KINDS)[number];

export interface RiskSignal {
  kind: RiskSignalKind;
  level: "red" | "yellow";
  /** Rule that raised the signal (stable id, auditable). */
  rule: string;
  /** Matched concept terms (normalized), bounded. */
  evidence: string[];
  source: "multilingual_lexicon" | "planner_observation";
}

type Concept =
  | "prod"
  | "datastore"
  | "modify"
  | "destruct"
  | "deploy"
  | "secret"
  | "expose"
  | "authBoundary"
  | "disable"
  | "force"
  | "mainBranch"
  | "merge"
  | "migration"
  | "destructiveAdj";

/**
 * Concept lexicon. CJK terms match the whitespace-free text; latin terms
 * match on word boundaries. Traditional and Simplified forms are both listed.
 */
const LEXICON: Record<Concept, readonly string[]> = {
  prod: [
    "production", "prod", "live environment", "live site", "live db", "prod env",
    "正式環境", "正式环境", "正式站", "正式機", "正式机", "正式區", "正式区", "正式資料", "正式数据", "正式服", "正式db", "正式庫", "正式库", "正式伺服器", "正式服务器", "正式網站", "正式网站",
    "線上環境", "线上环境", "線上資料庫", "线上数据库", "生產環境", "生产环境", "生產資料庫", "生产数据库", "正式上線", "正式上线",
  ],
  datastore: [
    "database", "db", "table", "tables", "records", "data", "users", "user data", "customer data", "rows",
    "資料庫", "数据库", "資料表", "数据表", "資料", "数据", "使用者", "用戶", "用户", "會員", "会员", "帳號", "账号", "帳戶", "账户", "紀錄", "记录", "訂單", "订单",
  ],
  modify: [
    "update", "modify", "change", "write", "alter", "edit", "insert", "set", "overwrite", "patch", "fix up",
    "修改", "更改", "改掉", "改成", "改", "更新", "寫入", "写入", "變更", "变更", "調整", "调整", "編輯", "编辑", "覆寫", "覆写", "替換", "替换",
  ],
  destruct: [
    "delete", "drop", "truncate", "purge", "wipe", "erase", "nuke", "clear all", "remove all", "destroy", "wipe out",
    "刪除", "删除", "刪掉", "删掉", "清掉", "清空", "清除", "清一清", "移除", "抹除", "砍掉", "銷毀", "销毁", "全刪", "全删", "重置", "抹掉",
  ],
  deploy: [
    "deploy", "deployment", "release to production", "ship to production", "go live", "publish to production", "roll out",
    "部署", "上線", "上线", "發布到正式", "发布到正式", "發佈", "推上正式", "推到正式", "布署",
  ],
  secret: [
    "secret", "secrets", "token", "tokens", "credential", "credentials", "api key", "apikey", "api keys", "password", "passwords", "private key", "env var", "env vars", ".env", "access key",
    "密鑰", "密钥", "金鑰", "金钥", "密碼", "密码", "憑證", "凭证", "私鑰", "私钥", "環境變數", "环境变量", "秘鑰", "秘钥", "令牌",
  ],
  expose: [
    "print", "show", "echo", "log", "expose", "dump", "reveal", "output", "display", "send me", "paste", "leak", "share",
    "印出", "打印", "印出來", "顯示", "显示", "輸出", "输出", "公開", "公开", "列出", "貼出", "贴出", "給我看", "给我看", "傳給我", "传给我", "告訴我", "告诉我", "外流",
  ],
  authBoundary: [
    "authentication", "auth check", "login verification", "login check", "2fa", "mfa", "two-factor", "captcha", "csrf", "cors", "rate limit", "rate limiting",
    "permission check", "access control", "security restriction", "security restrictions", "security check", "security checks", "firewall", "sandbox", "authorization check",
    "登入驗證", "登录验证", "登入檢查", "登录检查", "身分驗證", "身份驗證", "身份验证", "驗證機制", "验证机制", "雙重驗證", "双重验证", "二階段驗證", "两步验证", "驗證碼", "验证码",
    "認證機制", "认证机制", "權限檢查", "权限检查", "存取控制", "访问控制", "安全限制", "安全檢查", "安全检查", "安全機制", "安全机制", "防護", "防护", "防火牆", "防火墙", "限流",
  ],
  disable: [
    "disable", "turn off", "bypass", "skip", "remove", "lift", "relax", "comment out", "switch off", "get rid of",
    "關掉", "关掉", "關閉", "关闭", "停用", "解除", "繞過", "绕过", "跳過", "跳过", "拿掉", "取消", "移除", "放寬", "放宽", "拔掉", "去掉", "關了", "关了",
  ],
  force: ["force push", "force-push", "push --force", "push -f", "--force-with-lease", "強制推送", "强制推送", "強推", "强推", "強制push", "强制push", "強制 push"],
  mainBranch: ["main", "master", "main branch", "主分支", "主幹", "主干"],
  merge: ["merge", "push to", "push into", "合併", "合并", "推到", "推上", "併入", "并入"],
  migration: ["migration", "migrations", "migrate", "schema change", "schema", "遷移", "迁移", "資料庫結構", "数据库结构", "結構變更", "结构变更"],
  destructiveAdj: ["destructive", "drop column", "drop table", "irreversible", "破壞性", "破坏性", "不可逆", "刪欄位", "删字段", "刪表", "删表"],
};

const CJK = /[　-鿿豈-﫿]/;

export function normalizeRiskText(text: string): { spaced: string; compact: string } {
  const spaced = text.normalize("NFKC").toLowerCase().replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return { spaced, compact: spaced.replace(/\s+/g, "") };
}

function matches(concept: Concept, t: { spaced: string; compact: string }): string[] {
  const hits: string[] = [];
  for (const term of LEXICON[concept]) {
    if (CJK.test(term)) {
      if (t.compact.includes(term.replace(/\s+/g, ""))) hits.push(term);
    } else {
      const re = new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}(?=$|[^a-z0-9])`);
      if (re.test(t.spaced)) hits.push(term);
    }
  }
  return hits;
}

/** Deterministic multilingual signals for one request. mode=change enables the conservative unresolved rules. */
export function detectRiskSignals(text: string, mode: TaskMode): RiskSignal[] {
  const t = normalizeRiskText(text);
  const c = Object.fromEntries((Object.keys(LEXICON) as Concept[]).map((k) => [k, matches(k, t)])) as Record<Concept, string[]>;
  const has = (k: Concept) => c[k].length > 0;
  const out: RiskSignal[] = [];
  const add = (kind: RiskSignalKind, level: "red" | "yellow", rule: string, concepts: Concept[]) =>
    out.push({ kind, level, rule, evidence: Array.from(new Set(concepts.flatMap((k) => c[k]))).slice(0, 8), source: "multilingual_lexicon" });

  if (has("force")) add("force_push", "red", "force_push.term", ["force"]);
  if (has("mainBranch") && (has("merge") || has("deploy") || has("force"))) add("protected_branch_write", "red", "protected_branch.merge_or_push", ["merge", "mainBranch"]);
  if (has("deploy")) add("prod_deploy", "red", "deploy.any", ["deploy", "prod"]);
  if (has("secret") && has("expose")) add("secret_exposure", "red", "secret.expose", ["secret", "expose"]);
  if (has("secret") && (has("modify") || has("destruct") || has("disable"))) add("secret_change", "red", "secret.modify", ["secret", "modify", "destruct"]);
  if (has("authBoundary") && has("disable")) add("security_control_disable", "red", "security_boundary.disable", ["authBoundary", "disable"]);
  if (has("migration") && (has("destruct") || has("destructiveAdj"))) add("destructive_migration", "red", "migration.destructive", ["migration", "destruct", "destructiveAdj"]);
  if (has("destruct") && (has("datastore") || has("prod"))) add("destructive_data_delete", "red", "data.destructive", ["destruct", "datastore", "prod"]);
  if (has("prod") && (has("modify") || has("datastore") && has("destruct"))) add("prod_data_write", "red", "production.modify", ["prod", "modify", "datastore"]);

  if (mode === "change") {
    const red = out.some((s) => s.level === "red");
    // Conservative floor: production or secret material in a mutation request is never green.
    if (!red && (has("prod") || has("secret") || (has("destruct") && has("migration"))))
      add("sensitive_operation_unresolved", "red", "mutation.sensitive_indicator", ["prod", "secret", "destruct", "migration"]);
    if (has("authBoundary") && !has("disable")) add("security_boundary_change", "yellow", "security_boundary.change", ["authBoundary"]);
  }
  return out;
}

/** Typed domain actions a signal adds (domain/risk then takes the maximum). */
export function signalActions(signal: RiskSignal): TaskAction[] {
  switch (signal.kind) {
    case "prod_data_write":
      return [{ kind: "prod_db_write" }];
    case "destructive_data_delete":
      return [{ kind: "destructive_data_delete" }];
    case "prod_deploy":
      return [{ kind: "prod_deploy" }];
    case "secret_exposure":
      return [{ kind: "secret_exposure", surface: "internet" }];
    case "force_push":
      return [{ kind: "force_push" }];
    case "protected_branch_write":
      return [{ kind: "push", branch: "main" }];
    case "destructive_migration":
      return [{ kind: "prod_schema_change" }, { kind: "destructive_data_delete" }];
    case "secret_change":
    case "security_control_disable":
    case "sensitive_operation_unresolved":
      return [{ kind: "irreversible_prod_op" }];
    case "security_boundary_change":
      return [{ kind: "auth_logic_change" }];
  }
}

/** Planner observations are validated into the same typed kinds; they can only add (never remove) signals. */
export function plannerSignals(observations: readonly string[] | undefined): RiskSignal[] {
  return Array.from(new Set(observations ?? []))
    .filter((o): o is RiskSignalKind => (RISK_SIGNAL_KINDS as readonly string[]).includes(o))
    .map((kind) => ({ kind, level: kind === "security_boundary_change" ? "yellow" : "red", rule: "planner.observation", evidence: [], source: "planner_observation" }));
}

export function describeSignal(s: RiskSignal): string {
  return `${s.kind} (${s.source}:${s.rule}${s.evidence.length ? `; ${s.evidence.join(", ")}` : ""})`.slice(0, 200);
}
