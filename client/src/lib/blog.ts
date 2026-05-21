export interface CompareRow {
  label: string;
  left: string;
  right: string;
}

export interface GuideQA {
  question: string;
  answer: string | string[];
  compareRows?: CompareRow[];
  compareLabels?: [string, string];
}

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string;
  content: string;
  qaBlocks?: GuideQA[];
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx !== -1) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, content: match[2] };
}

// 對話式問答資料，以 slug 為 key。
// 新增指南時，在此加入對應的 qaBlocks 即可。
const QA_MAP: Record<string, GuideQA[]> = {
  "oem-vs-odm": [
    {
      question: "第一次找代工，為什麼一定要先搞懂 OEM 和 ODM？",
      answer: "因為兩者代表完全不同的合作模式——誰負責設計、誰承擔開模成本、上市速度有多快。一開始選錯方向，可能浪費大量時間和金錢。",
    },
    {
      question: "OEM 是什麼？",
      answer: "OEM 是 Original Equipment Manufacturer（原廠委託製造）。簡單說：你提供完整設計，工廠負責製造。你給工廠規格書、模具、原料需求，工廠按圖生產，產品的設計、品牌、包裝全部由你控制。",
    },
    {
      question: "OEM 適合誰？",
      answer: [
        "已有成熟產品設計、只需要量產的品牌商",
        "有自己研發團隊的企業",
        "想完全掌控產品規格、品牌與包裝的買家",
      ],
    },
    {
      question: "ODM 是什麼？",
      answer: "ODM 是 Original Design Manufacturer（原廠設計製造）。簡單說：工廠已有現成設計，你可以貼牌或微調。你選一款工廠現有的產品，稍微調整顏色、Logo、包裝，就能以自己的品牌販售。",
    },
    {
      question: "ODM 適合誰？",
      answer: [
        "剛起步、沒有設計能力的新創品牌",
        "想快速推出產品、降低開發成本的賣家",
        "電商業者、代理商",
      ],
    },
    {
      question: "OEM 和 ODM 最大差異是什麼？",
      answer: "用以下幾個面向來比較：",
      compareLabels: ["OEM", "ODM"],
      compareRows: [
        { label: "誰提供設計", left: "買家", right: "工廠" },
        { label: "開模成本", left: "買家負擔", right: "通常較低或共用" },
        { label: "產品獨特性", left: "高", right: "較低（共用模具）" },
        { label: "上市速度", left: "較慢", right: "較快" },
        { label: "適合階段", left: "成熟品牌", right: "新創 / 小量測試" },
      ],
    },
    {
      question: "新手應該先選 OEM 還是 ODM？",
      answer: "如果你是第一次找代工、預算有限、想快速驗證市場，建議先從 ODM 開始——選工廠現有款式微調，降低風險。等你確定市場需求、想推出真正差異化的產品，再走 OEM，投入設計與模具開發。很多台灣工廠兩種都做，詢問時可以直接問。",
    },
  ],
  "first-time-factory-guide": [
    {
      question: "第一次找代工廠，最常犯的錯誤是什麼？",
      answer: [
        "一開口就問「最低多少？」，讓工廠覺得你只在意價格",
        "需求不清楚就詢價，浪費雙方時間",
        "跳過打樣直接下大訂單，風險極高",
        "只問一家，沒有比較基準",
      ],
    },
    {
      question: "詢價前，應該先準備哪些資訊？",
      answer: [
        "產品類型：你要做什麼？（T恤、塑膠零件、保健食品⋯）",
        "數量：第一批大概要多少？",
        "預算：單件或總預算是多少？",
        "時程：什麼時候要交貨？",
        "規格：有沒有設計稿、材質要求、尺寸圖？",
      ],
    },
    {
      question: "在 OXM 上怎麼找合適的工廠？",
      answer: [
        "先看評分和評價：真實買家的回饋，能幫你快速判斷廠商配合態度",
        "注意 OEM / ODM：確認工廠支援你需要的合作模式",
        "看產品頁：工廠有沒有展示過類似的產品？",
      ],
    },
    {
      question: "第一封詢價信怎麼寫比較有效？",
      answer: "簡短、具體、有禮貌，工廠回覆率更高。建議這樣寫：「您好，我是 [品牌名]，想詢問 [產品] 的代工報價。數量約 ___ 件，時程希望 ___ 前交貨，規格如附件。請問是否可以配合？方便提供初步報價嗎？」",
    },
    {
      question: "為什麼要比較至少 3 家工廠？",
      answer: [
        "有比較基準，才知道報價是否合理（太低可能暗示品質問題）",
        "溝通速度反映未來合作效率",
        "是否有打樣服務，影響你驗證品質的能力",
        "付款條件（訂金比例、尾款時間）也需要比較",
      ],
    },
    {
      question: "下訂前為什麼一定要先打樣？",
      answer: "打樣能幫你確認實際成品是否符合預期、測試材質和做工品質，並作為後續量產的標準樣。打樣費通常需要另付，但這筆錢很值得——跳過打樣直接下大訂單，風險極高。",
    },
    {
      question: "找代工廠，最重要的心態是什麼？",
      answer: "找代工廠本質上是建立長期合作關係。從第一次接觸開始，就以誠信、清晰的溝通建立信任——這樣後續的合作會順很多。",
    },
  ],
  "what-is-moq": [
    {
      question: "工廠說「MOQ 是 1000 件」，我是不是就沒辦法合作了？",
      answer: "不一定。MOQ 很多時候是可以談的，關鍵在於你怎麼理解它、怎麼跟工廠溝通。",
    },
    {
      question: "MOQ 是什麼？工廠為什麼要設定最低訂購量？",
      answer: "MOQ 是 Minimum Order Quantity（最低訂購量）的縮寫。工廠開一條生產線有固定成本：機器設定費、原料採購批量、工人排班等。為了讓這些成本攤平，工廠會設定最小接單量——低於這個數量，工廠的利潤可能是負的。",
    },
    {
      question: "台灣各產業的 MOQ 大概是多少？",
      answer: [
        "紡織 / 成衣：通常 300–1,000 件起",
        "塑膠射出：開模費另計，量產 500–2,000 件起",
        "金屬加工：依零件複雜度，100–500 件不等",
        "食品代工：通常以重量或箱數計，100–500 公斤起",
        "印刷包裝：1,000–5,000 份常見",
      ],
    },
    {
      question: "工廠和工作室有什麼不同？哪個 MOQ 比較低？",
      answer: "在 OXM 上可以同時找工廠和設計工作室。工作室通常接受更低的 MOQ，甚至 50 件、30 件都可以，代價是單價較高。如果你要測試市場、先打樣確認，工作室往往是更好的起點。",
    },
    {
      question: "怎麼跟工廠談比較低的 MOQ？",
      answer: [
        "坦誠說明情況：「我是新品牌，第一批想先下 300 件測市場，後續有量會繼續合作。」大多數工廠能理解",
        "接受單價補差：較低 MOQ 通常代表單價高一些，這是合理的交換",
        "選現有款式（ODM）：不需開新模，工廠成本低，MOQ 相對彈性",
        "先詢打樣費：讓工廠知道你認真，後續談 MOQ 更順",
      ],
    },
    {
      question: "談 MOQ 最重要的一件事是什麼？",
      answer: "讓工廠知道：你是認真的長期合作夥伴，不是一次性的小單。這一句話的重量，比任何談判技巧都有效。",
    },
  ],
};

const modules = import.meta.glob('../content/blog/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const allPosts: BlogPost[] = Object.entries(modules)
  .map(([path, raw]) => {
    const slug = path.match(/\/([^/]+)\.md$/)?.[1] ?? '';
    const { meta, content } = parseFrontmatter(raw);
    return {
      slug,
      title: meta.title ?? '',
      description: meta.description ?? '',
      date: meta.date ?? '',
      content,
      qaBlocks: QA_MAP[slug],
    };
  })
  .sort((a, b) => b.date.localeCompare(a.date));

export function getPost(slug: string): BlogPost | undefined {
  return allPosts.find((p) => p.slug === slug);
}
