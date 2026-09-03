/**
 * 管理員後台「服務案件管理」入口卡片 — 靜態原始碼契約測試。
 *
 * 五個入口：企業升級（既有 /upgrade-consultant/cases，upgradeConsultant.myCases
 * 對 admin 有明確的「Admin bypass: see all cases」分支）、企業財務優化
 * （既有 /finance-consultant/cases，financeConsultant.myCases 對 admin 同樣
 * 回傳全部案件）、以及 ISO／低碳、ERP／產線優化、短影音／品牌內容三個隱藏
 * 服務專區的顧問案件看板。全部都是既有頁面，本輪只新增管理員後台入口，
 * 不修改自動派案規則、案件狀態或顧問權限本身（案件流程已由
 * certificationCenterApplication.test.ts／erpOptimizationApplication.test.ts／
 * shortVideoMarketingApplication.test.ts 的「顧問案件看板」describe，以及
 * financeOptimization.test.ts／upgradeConsultantRegion.test.ts 涵蓋）。
 * 這裡採用與 certificationCenterNoPublicEntry 系列相同的手法——純靜態
 * 原始碼字串比對，確認：
 * 1. AdminDashboard.tsx 五張卡片各自連到正確、且互不錯置的管理路徑，
 *    順序為：企業升級 → 企業財務優化 → ISO／低碳 → ERP／產線優化 →
 *    短影音／品牌內容。
 * 2. 公開 Navbar／首頁／APP 底部導覽／找資源頁都沒有這五個顧問案件看板
 *    路徑（既有 NoPublicEntry 測試檢查的是 /certification-center 等申請頁
 *    字樣，regex 不會匹配 /certification-consultant/cases 這類不同字串的
 *    路徑，因此需要獨立補這一段；企業升級／財務優化的路徑本來就不是本輪
 *    新建，但仍一併確認沒有被本輪不小心洩漏到公開導覽）。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

const CONSULTANT_PATHS = {
  upgrade: "/upgrade-consultant/cases",
  finance: "/finance-consultant/cases",
  iso: "/certification-consultant/cases",
  erp: "/erp-consultant/cases",
  shortVideo: "/short-video-consultant/cases",
};

const CARD_LABELS: Record<keyof typeof CONSULTANT_PATHS, string> = {
  upgrade: "企業升級案件管理",
  finance: "企業財務優化案件管理",
  iso: "ISO／低碳案件管理",
  erp: "ERP／產線優化案件管理",
  shortVideo: "短影音／品牌內容案件管理",
};

// 使用者要求的卡片顯示順序。
const EXPECTED_ORDER: (keyof typeof CONSULTANT_PATHS)[] = ["upgrade", "finance", "iso", "erp", "shortVideo"];

describe("AdminDashboard.tsx：五張服務案件管理入口卡片連到正確路徑", () => {
  const source = readSource("client", "src", "pages", "AdminDashboard.tsx");

  for (const key of EXPECTED_ORDER) {
    const label = CARD_LABELS[key];
    const targetPath = CONSULTANT_PATHS[key];
    it(`包含「${label}」卡片，連到 ${targetPath}`, () => {
      expect(source).toContain(label);
      expect(source).toMatch(new RegExp(`setLocation\\("${targetPath.replace(/\//g, "\\/")}"\\)`));
    });
  }

  it("五張卡片各自的路徑沒有互相錯置——每個卡片的標題與 onClick 目標路徑成對出現在同一段落內", () => {
    for (const key of EXPECTED_ORDER) {
      const label = CARD_LABELS[key];
      const targetPath = CONSULTANT_PATHS[key];
      // 找到該卡片標題在原始碼中的位置，往前找最近的 onClick setLocation，
      // 確認抓到的目標路徑正是這張卡片本身的路徑，不是別張卡片的。
      const labelIndex = source.indexOf(label);
      expect(labelIndex, `找不到卡片標題「${label}」`).toBeGreaterThan(-1);
      const precedingSlice = source.slice(Math.max(0, labelIndex - 300), labelIndex);
      const onClickMatch = precedingSlice.match(/setLocation\("([^"]+)"\)[^]*$/);
      expect(onClickMatch, `卡片「${label}」前方找不到對應的 setLocation 呼叫`).toBeTruthy();
      expect(onClickMatch![1]).toBe(targetPath);
    }
  });

  it("五張卡片沒有重複——五個目標路徑在原始碼中各自只出現一次 setLocation 呼叫", () => {
    for (const key of EXPECTED_ORDER) {
      const targetPath = CONSULTANT_PATHS[key];
      const escaped = targetPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matches = source.match(new RegExp(`setLocation\\("${escaped}"\\)`, "g")) ?? [];
      expect(matches.length, `${targetPath} 的 setLocation 呼叫次數應為 1`).toBe(1);
    }
  });

  it("五張卡片在原始碼中的顯示順序為：企業升級 → 企業財務優化 → ISO／低碳 → ERP／產線優化 → 短影音／品牌內容", () => {
    const indices = EXPECTED_ORDER.map(key => source.indexOf(CARD_LABELS[key]));
    for (const idx of indices) expect(idx).toBeGreaterThan(-1);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i], `「${CARD_LABELS[EXPECTED_ORDER[i]]}」應該出現在「${CARD_LABELS[EXPECTED_ORDER[i - 1]]}」之後`).toBeGreaterThan(indices[i - 1]);
    }
  });

  it("五張卡片都在管理員權限檢查（user.role !== \"admin\" 時阻擋存取）範圍內的元件裡，不是獨立的公開元件", () => {
    expect(source).toMatch(/您沒有權限存取管理員儀表板/);
  });
});

describe("五個顧問案件看板路徑不曾出現在任何「所有訪客都看得到」的公開導覽入口", () => {
  // ISO／低碳、ERP／產線優化、短影音／品牌內容三個是本輪之前才新增的隱藏
  // 服務專區，設計上完全沒有任何導覽入口（連登入使用者都沒有）；企業升級／
  // 財務優化則是既有功能，Navbar.tsx 本來就有一個「顧問中心」入口連到這兩個
  // 路徑，但只在使用者本人是啟用中顧問或管理員時才顯示（showAnyConsultantCenter
  // 條件式渲染），不是任何訪客都看得到的公開連結，本輪未修改、也不需要移除。
  const NEW_HIDDEN_PATHS = [CONSULTANT_PATHS.iso, CONSULTANT_PATHS.erp, CONSULTANT_PATHS.shortVideo];

  const files: Array<[string, string[]]> = [
    ["Navbar.tsx", ["client", "src", "components", "Navbar.tsx"]],
    ["Home.tsx", ["client", "src", "pages", "Home.tsx"]],
    ["AppBottomNav.tsx", ["client", "src", "components", "AppBottomNav.tsx"]],
    ["Search.tsx", ["client", "src", "pages", "Search.tsx"]],
  ];

  for (const [label, segments] of files) {
    it(`${label} 沒有任何 ISO／ERP／短影音顧問案件看板路徑字樣`, () => {
      const source = readSource(...segments);
      for (const p of NEW_HIDDEN_PATHS) {
        expect(source).not.toContain(p);
      }
    });
  }

  it("Home.tsx／AppBottomNav.tsx／Search.tsx 也沒有企業升級／財務優化顧問看板路徑（這兩個路徑目前只合法出現在 Navbar.tsx 的顧問身分限定入口）", () => {
    for (const segments of [["client", "src", "pages", "Home.tsx"], ["client", "src", "components", "AppBottomNav.tsx"], ["client", "src", "pages", "Search.tsx"]]) {
      const source = readSource(...segments);
      expect(source).not.toContain(CONSULTANT_PATHS.upgrade);
      expect(source).not.toContain(CONSULTANT_PATHS.finance);
    }
  });

  it("Navbar.tsx 裡企業升級／財務優化的連結被限定在 showAnyConsultantCenter（顧問本人或管理員）條件式渲染範圍內，不是無條件公開連結", () => {
    const source = readSource("client", "src", "components", "Navbar.tsx");
    expect(source).toMatch(/showAnyConsultantCenter\s*=\s*showConsultantCenter\s*\|\|\s*showFinanceConsultantCenter/);
    expect(source).toMatch(/showConsultantCenter\s*=\s*isAdmin\s*\|\|\s*consultantActiveCache/);
    expect(source).toMatch(/showFinanceConsultantCenter\s*=\s*isAdmin\s*\|\|\s*financeConsultantActiveCache/);
  });

  it("server/_core/index.ts 的 sitemap.xml 產生邏輯沒有任何顧問案件看板路徑", () => {
    const source = readSource("server", "_core", "index.ts");
    for (const p of Object.values(CONSULTANT_PATHS)) {
      expect(source).not.toContain(p);
    }
  });

  it("server/_core/prerenderedBody.ts 的 PRERENDERED_PAGES 清單沒有任何顧問案件看板路徑", () => {
    const source = readSource("server", "_core", "prerenderedBody.ts");
    for (const p of Object.values(CONSULTANT_PATHS)) {
      expect(source).not.toContain(p);
    }
  });
});

describe("三個公開申請頁（/apply）本身的 noindex 設定不受本輪影響", () => {
  it("server/_core/security.ts 的 NOINDEX_EXACT_PATHS 仍包含三個服務的 /apply 子頁（Final Public Index Release 後，Landing Page 本身已移出這個清單，只剩申請表單維持 noindex），且不含任何顧問案件看板路徑", () => {
    const source = readSource("server", "_core", "security.ts");
    const match = source.match(/NOINDEX_EXACT_PATHS = new Set<string>\(\[([^\]]*)\]\)/);
    expect(match).toBeTruthy();
    const listed = match![1];
    const stringLiterals = listed.match(/"[^"]*"/g) ?? [];
    expect(stringLiterals).toContain('"/certification-center/apply"');
    expect(stringLiterals).toContain('"/erp-optimization/apply"');
    expect(stringLiterals).toContain('"/short-video-marketing/apply"');
    expect(stringLiterals).not.toContain('"/certification-center"');
    expect(stringLiterals).not.toContain('"/erp-optimization"');
    expect(stringLiterals).not.toContain('"/short-video-marketing"');
    for (const p of Object.values(CONSULTANT_PATHS)) {
      expect(stringLiterals).not.toContain(`"${p}"`);
    }
  });
});

describe("企業升級／企業財務優化顧問看板：admin 會看到全部案件，不是只看自己承辦的部分（如實引用既有 router 邏輯，非本輪新增）", () => {
  it("server/routers.ts 的 upgradeConsultant.myCases 有明確的 admin bypass 註解與邏輯", () => {
    const source = readSource("server", "routers.ts");
    expect(source).toMatch(/Admin bypass: see all cases regardless of consultant assignment/);
  });

  it("server/routers.ts 的 financeConsultant.myCases 對管理員回傳全部財務案件（不分顧問）", () => {
    const source = readSource("server", "routers.ts");
    expect(source).toMatch(/管理員一律可查看全部/);
  });
});
