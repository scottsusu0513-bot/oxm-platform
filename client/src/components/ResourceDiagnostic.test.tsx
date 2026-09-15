// @vitest-environment jsdom
/**
 * /resources 頁「企業需求診斷」互動工具的 regression test — 逐題切換版。
 *
 * 背景：原本是「收合卡片 → 點『開始 1 分鐘診斷』→ 一次展開全部 4 題 → 送出」
 * 的單頁表單模式；這次改成「一開始就直接顯示第 1 題 → 逐題按下一步/上一步
 * 切換 → 第 4 題按『查看適合我的資源』才計算結果」的逐題模式，同一張卡片內
 * 完成，不換頁、不 reload、不開 modal。
 *
 * 計分規則本身（單題各分類最高分、同分固定排序、次推薦門檻、Q4 只影響文案
 * 不影響分類）已經在 client/src/lib/resourceDiagnostic.test.ts 針對純函式
 * calculateRecommendation() 完整覆蓋、這次沒有修改，不重複測。這裡專注在
 * 逐題導覽本身：初始直接顯示第 1 題、不再有「開始」按鈕、每步驟只看到一題、
 * 未答不能下一步（輕量提示不是 alert）、上一步保留答案、Q2 複選與互斥維持、
 * 結果只在第 4 題送出後才計算、重新測一次回到第 1 題並清空、CTA href 不變。
 *
 * 選項本身是自訂的 role="radio"/"checkbox" 按鈕（不是原生 input），用文字
 * 內容定位再 .closest("button") 取得可點擊的元素。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ResourceDiagnostic from "./ResourceDiagnostic";

afterEach(() => {
  cleanup();
});

function optionButton(label: string): HTMLButtonElement {
  const el = screen.getByText(label).closest("button");
  if (!el) throw new Error(`option button not found for label: ${label}`);
  return el as HTMLButtonElement;
}

function clickNext() {
  fireEvent.click(screen.getByRole("button", { name: /下一步|查看適合我的資源/ }));
}

function clickPrev() {
  fireEvent.click(screen.getByRole("button", { name: /上一步/ }));
}

/** 走完 Q1~Q3（用固定、彼此不衝突的答案），停在 Q4，方便測試在需要「已到
 *  最後一題」的情境時重複使用。 */
function advanceToQ4() {
  fireEvent.click(optionButton("想申請政府補助，降低投資成本"));
  clickNext();
  fireEvent.click(optionButton("購買設備／擴廠"));
  clickNext();
  fireEvent.click(optionButton("不知道有哪些補助可以申請"));
  clickNext();
}

describe("初始狀態：直接顯示第 1 題", () => {
  it("(1)(3) 一開始就直接看到第 1 題，看不到第 2～4 題", () => {
    render(<ResourceDiagnostic />);
    expect(screen.getByText("目前最想解決的問題是？")).toBeTruthy();
    expect(screen.queryByText("公司最近是否準備進行下列事情？")).toBeNull();
    expect(screen.queryByText("目前最讓你困擾的是？")).toBeNull();
    expect(screen.queryByText("你目前希望在多久內處理？")).toBeNull();
  });

  it("(2) 不再出現「開始 1 分鐘診斷」按鈕", () => {
    render(<ResourceDiagnostic />);
    expect(screen.queryByRole("button", { name: /開始 1 分鐘診斷/ })).toBeNull();
  });

  it("第 1 題不顯示「上一步」", () => {
    render(<ResourceDiagnostic />);
    expect(screen.queryByRole("button", { name: /上一步/ })).toBeNull();
  });
});

describe("逐步推進：未答不能下一步，答了才能推進到下一題", () => {
  it("(4) 第 1 題未作答時點下一步，仍停在第 1 題並顯示輕量提示（不是 alert）", () => {
    const originalAlert = window.alert;
    let alertCalled = false;
    window.alert = () => { alertCalled = true; };
    try {
      render(<ResourceDiagnostic />);
      clickNext();
      expect(alertCalled).toBe(false);
      expect(screen.getByText("目前最想解決的問題是？")).toBeTruthy();
      expect(screen.getByText("請選擇一個選項")).toBeTruthy();
    } finally {
      window.alert = originalAlert;
    }
  });

  it("(5) 第 1 題作答後點下一步，進入第 2 題", () => {
    render(<ResourceDiagnostic />);
    fireEvent.click(optionButton("想申請政府補助，降低投資成本"));
    clickNext();
    expect(screen.getByText("公司最近是否準備進行下列事情？")).toBeTruthy();
    expect(screen.queryByText("目前最想解決的問題是？")).toBeNull();
  });

  it("(6) 第 2 題（複選）未選任何選項不能下一步，選一個後可以進入第 3 題", () => {
    render(<ResourceDiagnostic />);
    fireEvent.click(optionButton("想申請政府補助，降低投資成本"));
    clickNext();

    clickNext(); // Q2 尚未作答
    expect(screen.getByText("公司最近是否準備進行下列事情？")).toBeTruthy();
    expect(screen.getByText("請至少選擇一項")).toBeTruthy();

    fireEvent.click(optionButton("購買設備／擴廠"));
    clickNext();
    expect(screen.getByText("目前最讓你困擾的是？")).toBeTruthy();
  });

  it("(7) 第 3 題作答後點下一步，進入第 4 題", () => {
    render(<ResourceDiagnostic />);
    fireEvent.click(optionButton("想申請政府補助，降低投資成本"));
    clickNext();
    fireEvent.click(optionButton("購買設備／擴廠"));
    clickNext();
    fireEvent.click(optionButton("不知道有哪些補助可以申請"));
    clickNext();
    expect(screen.getByText("你目前希望在多久內處理？")).toBeTruthy();
  });

  it("第 4 題按鈕文字是「查看適合我的資源」，不是「下一步」", () => {
    render(<ResourceDiagnostic />);
    advanceToQ4();
    expect(screen.getByRole("button", { name: "查看適合我的資源" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "下一步" })).toBeNull();
  });
});

describe("上一步：保留答案、進度同步更新", () => {
  it("(8) 第 2～4 題都有「上一步」按鈕", () => {
    render(<ResourceDiagnostic />);
    fireEvent.click(optionButton("想申請政府補助，降低投資成本"));
    clickNext();
    expect(screen.getByRole("button", { name: /上一步/ })).toBeTruthy();

    fireEvent.click(optionButton("購買設備／擴廠"));
    clickNext();
    expect(screen.getByRole("button", { name: /上一步/ })).toBeTruthy();

    fireEvent.click(optionButton("不知道有哪些補助可以申請"));
    clickNext();
    expect(screen.getByRole("button", { name: /上一步/ })).toBeTruthy();
  });

  it("(9) 從第 2 題按上一步回到第 1 題，原本選的答案仍保留（不是清空）", () => {
    render(<ResourceDiagnostic />);
    const optA = optionButton("想申請政府補助，降低投資成本");
    fireEvent.click(optA);
    clickNext();
    clickPrev();
    expect(screen.getByText("目前最想解決的問題是？")).toBeTruthy();
    expect(optionButton("想申請政府補助，降低投資成本").getAttribute("aria-checked")).toBe("true");
  });

  it("上一步回去後再按下一步，Q2 的複選答案也保留（不是清空）", () => {
    render(<ResourceDiagnostic />);
    fireEvent.click(optionButton("想申請政府補助，降低投資成本"));
    clickNext();
    fireEvent.click(optionButton("購買設備／擴廠"));
    fireEvent.click(optionButton("數位轉型／導入系統"));
    clickNext(); // → Q3
    clickPrev(); // → Q2
    expect(optionButton("購買設備／擴廠").getAttribute("aria-checked")).toBe("true");
    expect(optionButton("數位轉型／導入系統").getAttribute("aria-checked")).toBe("true");
  });
});

describe("Q2 複選與互斥邏輯維持", () => {
  it("(10) 可同時複選多個一般選項", () => {
    render(<ResourceDiagnostic />);
    fireEvent.click(optionButton("想申請政府補助，降低投資成本"));
    clickNext();
    const equip = optionButton("購買設備／擴廠");
    const digital = optionButton("數位轉型／導入系統");
    fireEvent.click(equip);
    fireEvent.click(digital);
    expect(equip.getAttribute("aria-checked")).toBe("true");
    expect(digital.getAttribute("aria-checked")).toBe("true");
  });

  it("(10) 「都沒有／還在評估」與其他選項互斥", () => {
    render(<ResourceDiagnostic />);
    fireEvent.click(optionButton("想申請政府補助，降低投資成本"));
    clickNext();
    const equip = optionButton("購買設備／擴廠");
    const none = optionButton("都沒有／還在評估");
    fireEvent.click(equip);
    fireEvent.click(none);
    expect(none.getAttribute("aria-checked")).toBe("true");
    expect(equip.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(equip);
    expect(equip.getAttribute("aria-checked")).toBe("true");
    expect(none.getAttribute("aria-checked")).toBe("false");
  });
});

describe("結果：只在第 4 題送出後才計算，維持原 scoring 邏輯", () => {
  it("(11) 前 3 題完成、停在第 4 題時，結果尚未出現", () => {
    render(<ResourceDiagnostic />);
    advanceToQ4();
    expect(screen.queryByText("最建議先了解")).toBeNull();
  });

  it("(11)(12) 第 4 題送出後才計算並顯示結果（subsidy 高分 → 政府補助）", () => {
    render(<ResourceDiagnostic />);
    advanceToQ4();
    fireEvent.click(optionButton("先了解、之後再規劃"));
    clickNext();
    expect(screen.getByText("最建議先了解")).toBeTruthy();
    expect(screen.getByText("政府補助")).toBeTruthy();
    expect(screen.getByText("可先了解服務內容與適用情境。")).toBeTruthy();
  });

  it("次推薦規則正確：同分時顯示「也可以參考」與正確項目", () => {
    render(<ResourceDiagnostic />);
    fireEvent.click(optionButton("想申請政府補助，降低投資成本"));
    clickNext();
    fireEvent.click(optionButton("都沒有／還在評估"));
    clickNext();
    fireEvent.click(optionButton("資金壓力或財務結構"));
    clickNext();
    fireEvent.click(optionButton("近期就要處理"));
    clickNext();
    expect(screen.getByText("也可以參考")).toBeTruthy();
    expect(screen.getByText("企業財務優化")).toBeTruthy();
    expect(screen.getByText("建議優先了解。")).toBeTruthy();
  });
});

describe("重新測一次、不換頁、CTA route", () => {
  it("(13) 送出結果不換頁（沒有觸發任何導覽）", () => {
    const pathnameBefore = window.location.pathname;
    render(<ResourceDiagnostic />);
    advanceToQ4();
    fireEvent.click(optionButton("先了解、之後再規劃"));
    clickNext();
    expect(window.location.pathname).toBe(pathnameBefore);
  });

  it("(14) 「重新測一次」回到第 1 題並清空所有答案", () => {
    render(<ResourceDiagnostic />);
    advanceToQ4();
    fireEvent.click(optionButton("先了解、之後再規劃"));
    clickNext();
    fireEvent.click(screen.getByText("重新測一次"));

    expect(screen.getByText("目前最想解決的問題是？")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /上一步/ })).toBeNull();
    expect(optionButton("想申請政府補助，降低投資成本").getAttribute("aria-checked")).toBe("false");
  });

  it("(15) 結果 CTA 使用 /resources 現有服務入口的 href，不是新路由", () => {
    render(<ResourceDiagnostic />);
    advanceToQ4();
    fireEvent.click(optionButton("先了解、之後再規劃"));
    clickNext();
    const primaryCta = screen.getByText("查看政府補助").closest("a");
    expect(primaryCta?.getAttribute("href")).toBe("/upgrade-center");
  });
});
