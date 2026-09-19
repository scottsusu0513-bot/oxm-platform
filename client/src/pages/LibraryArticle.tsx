import { Helmet } from "react-helmet-async";
import { useRoute, Link } from "wouter";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import NotFound from "./NotFound";
import {
  resolveLibraryArticle,
  buildLibraryArticleContent,
  buildLibraryArticleAllJsonLd,
} from "@shared/seo/libraryPages";
import { toSafeJsonLdString } from "@shared/seo/schema";
import {
  getLibraryArticle,
  estimateReadingMinutes,
  type LibraryBodyBlock,
  type LibraryEmphasis,
} from "@shared/content/library";
import "./library.css";

const EMPHASIS_CLASS_NAME: Record<LibraryEmphasis, string> = {
  bold: "library-emphasis-bold",
  primary: "library-emphasis-primary",
  secondary: "library-emphasis-secondary",
};

function BodyBlockView({ block }: { block: LibraryBodyBlock }) {
  switch (block.type) {
    case "heading":
      return <h2 className="library-body-heading">{block.text}</h2>;
    case "paragraph":
      // segments（見任務定案「Library 重點文字標示」）：有提供時逐片段渲染，
      // 帶 emphasis 的片段用 <strong> 包（semantic emphasis，不是只有顏色
      // 沒有語意標籤），顏色透過 className 掛在 <strong> 上，不是額外做一套
      // highlight/badge 元件。沒有 segments 的段落（既有大多數文字）維持
      // 原樣輸出 text，完全不受影響。
      if (block.segments) {
        return (
          <p className="library-body-paragraph">
            {block.segments.map((segment, index) =>
              typeof segment === "string" ? (
                <span key={index}>{segment}</span>
              ) : (
                <strong key={index} className={EMPHASIS_CLASS_NAME[segment.emphasis]}>
                  {segment.text}
                </strong>
              )
            )}
          </p>
        );
      }
      return <p className="library-body-paragraph">{block.text}</p>;
    case "list":
      return (
        <ul className="library-body-list">
          {block.items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div className="library-table-section">
          <div className="library-table-caption" aria-hidden="true">
            <span>OXM 知識比較</span>
            <span>OEM / ODM</span>
          </div>
          <p className="library-table-hint">
            比較資料 <span aria-hidden="true">↔</span> 可左右捲動查看完整內容
          </p>
          <div
            className="library-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="OEM 與 ODM 比較表"
          >
            <table className="library-comparison-table">
              <thead>
                <tr>
                  <th scope="col">比較項目</th>
                  <th scope="col">{block.headers[0]}</th>
                  <th scope="col">{block.headers[1]}</th>
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, index) => (
                  <tr key={index}>
                    <th scope="row">{row.label}</th>
                    <td>{row.left}</td>
                    <td>{row.right}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    default:
      return null;
  }
}

type ConversationSection = {
  heading: Extract<LibraryBodyBlock, { type: "heading" }> | null;
  blocks: LibraryBodyBlock[];
};

function groupConversation(body: LibraryBodyBlock[]): ConversationSection[] {
  const sections: ConversationSection[] = [{ heading: null, blocks: [] }];
  for (const block of body) {
    if (block.type === "heading") sections.push({ heading: block, blocks: [] });
    else sections[sections.length - 1].blocks.push(block);
  }
  return sections.filter(section => section.heading || section.blocks.length);
}

const openingQuestions: Record<string, string> = {
  "what-is-contract-manufacturing": "「代工」到底是什麼意思？",
  "what-is-moq": "工廠說 MOQ 要 1000 件，真的沒有商量空間嗎？",
  "oem-vs-odm": "OEM 和 ODM，怎麼快速理解？",
  "first-time-factory-guide": "第一次找代工廠，最容易在哪裡走冤枉路？",
  "small-batch-manufacturing": "數量不多，真的找得到工廠嗎？",
  "how-to-read-factory-quotes": "同一個產品，為什麼報價差這麼多？",
  "how-to-choose-a-factory": "找到好幾家工廠，該怎麼選？",
  "what-is-rfq": "詢價到底要準備什麼資料？",
  "what-is-prototyping": "打樣到底是在做什麼？",
  "new-product-development-partners": "為什麼很多人開發新產品，第一步就卡住？",
  "what-is-cnc-machining": "CNC 加工常被提到，但它實際上是怎麼運作的？",
  "what-is-sheet-metal-fabrication": "鈑金加工、雷射切割、折床、焊接，是同一件事嗎？",
  "what-is-metal-stamping": "金屬沖壓跟鈑金加工，是同一種東西嗎？",
  "casting-forging-cnc-comparison": "鑄造、鍛造、CNC，做金屬零件該選哪一種？",
  "surface-finishing-comparison": "零件加工完，為什麼還要多一道表面處理？",
  "what-is-mold-making": "開模流程跟費用，第一次接觸該怎麼理解？",
  "what-is-plastic-injection-molding": "為什麼塑膠外殼、容器幾乎都靠射出成型做出來？",
  "plastic-molding-process-comparison": "射出、押出、吹塑、真空成型，差別在哪？",
  "what-is-smt": "產品裡只要有電路板，就一定會碰到 SMT 嗎？",
  "pcb-prototyping-process": "第一次做電路板，打樣跟量產差在哪？",
  "pcb-pcba-smt-comparison": "詢價時常常搞混的 PCB、PCBA、SMT，到底差在哪？",
  "what-is-wire-harness-assembly": "產品裡的配線，為什麼要特別做成「線束」？",
  "how-to-start-food-oem": "想做自己的食品品牌，第一步該怎麼開始？",
  "food-oem-odm-selection": "食品代工也要選 OEM 還是 ODM 嗎？",
  "cosmetic-oem-odm-collaboration": "化妝品代工，跟一般工業產品代工有什麼不一樣？",
  "how-to-choose-plastic-materials": "PP、PE、ABS、PC，這些塑膠代號到底怎麼分？",
  "rubber-silicone-pu-comparison": "橡膠、矽膠、PU，看起來都很像，差在哪？",
  "food-grade-vs-medical-grade-silicone": "「食品級」「醫療級」矽膠，是品質比較好的意思嗎？",
  "stainless-steel-aluminum-iron-comparison": "不鏽鋼、鋁、鐵，做產品該怎麼選？",
  "stainless-steel-304-vs-316": "304 跟 316 不鏽鋼，差別很大嗎？",
  "what-is-sustainable-materials": "常聽到「永續材料」，但具體包含哪些？",
  "what-is-bioplastics": "生質塑膠，是不是就是「會分解的環保塑膠」？",
  "what-is-recycled-materials": "PCR、PIR，都是再生材料嗎？",
  "biodegradable-vs-compostable": "可分解、可生物分解、可堆肥，是同一回事嗎？",
  "natural-fiber-and-biocomposite-materials": "天然纖維、生質複合材料，是最近才有的新材料嗎？",
  "how-to-find-packaging-manufacturer": "產品做好了，包裝該找誰處理？",
  "paper-box-bag-soft-packaging-comparison": "紙盒、紙袋、軟包裝，選錯會有什麼影響？",
  "packaging-printing-methods": "包裝印刷方式選錯，會有什麼問題？",
  "business-card-dm-catalog-printing": "名片、DM、型錄，印刷需求都一樣嗎？",
  "sticker-label-printing-guide": "貼紙跟標籤，材質選錯會怎樣？",
  "what-is-production-line-automation": "自動化產線，是不是就代表完全不用人力？",
  "factory-inspection-equipment-and-quality-control": "工廠品管，只靠肉眼檢查就夠了嗎？",
  "jig-fixture-mold-comparison": "治具、夾具、模具，聽起來很像，是同一件事嗎？",
  "what-is-tolerance": "報價單上常看到「公差」，它是什麼意思？",
  "what-is-yield-rate": "報價時常提到的「良率」，會怎麼影響成本？",
};

export default function LibraryArticle() {
  const [, params] = useRoute("/library/:slug");
  const resolved = resolveLibraryArticle(params?.slug ?? "");
  if (!resolved) return <NotFound />;

  const { article } = resolved;
  const content = buildLibraryArticleContent(resolved);
  const jsonLd = buildLibraryArticleAllJsonLd(resolved);
  const sections = groupConversation(article.body);

  return (
    <div className="library-page library-article-page">
      <Helmet>
        <title>{content.title}</title>
        <meta name="description" content={content.description} />
        <link rel="canonical" href={content.canonical} />
        <meta property="og:type" content="article" />
        <meta property="og:site_name" content="OXM" />
        <meta property="og:url" content={content.canonical} />
        <meta property="og:title" content={content.title} />
        <meta property="og:description" content={content.description} />
        <script type="application/ld+json">{toSafeJsonLdString(jsonLd)}</script>
      </Helmet>
      <Navbar />
      {/* 不用 deterministic（見任務定案「Library UX 修正」— 返回上一頁恢復原本
          位置）：Library 文章頁不像 IndustryPage／AdminMessages 有「同頁內部
          分類切換／固定層級」需要強制忽略瀏覽器 history 的理由，直接沿用
          FloatingBackButton 預設行為——有效的 sessionStorage previousPath 時走
          window.history.back()（真正的 popstate 導航，讓 App.tsx 既有的
          ScrollRestorationManager 自動保留捲動位置，不強制捲頂），沒有有效
          previousPath（例如直接進入 /library/:slug）時才 fallback 到
          /library。 */}
      <FloatingBackButton
        fallbackHref="/library"
        label="返回圖書館"
        className="library-floating-back"
      />
      <main className="library-wrap">
        <nav
          aria-label="breadcrumb"
          className="library-breadcrumb library-article-breadcrumb"
        >
          <Link href="/">OXM 首頁</Link>
          <span aria-hidden="true">/</span>
          <Link href="/library">傳產圖書館</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{article.h1}</span>
        </nav>
        <article className="library-document">
          <header className="library-document-header">
            <div className="library-document-eyebrow">
              <span className="library-kicker-mark" /> OXM 傳產圖書館
            </div>
            <h1>{article.h1}</h1>
            <p className="library-document-intro">{article.excerpt}</p>
            <div className="library-document-metadata">
              <div>
                <span>館藏編號</span>
                <strong>{article.libraryId}</strong>
              </div>
              <div>
                <span>資料分類</span>
                <strong>{article.category}</strong>
              </div>
              <div>
                <span>更新紀錄</span>
                <strong>最後更新 {article.updatedAt}</strong>
              </div>
              <div>
                <span>閱讀時間</span>
                <strong>{estimateReadingMinutes(article)} 分鐘</strong>
              </div>
            </div>
          </header>
          <div className="library-document-layout">
            <div className="library-document-content">
              <div className="library-body">
                {sections.map((section, sectionIndex) => (
                  <section
                    className="library-dialogue-section"
                    key={sectionIndex}
                  >
                    <div className="library-question">
                      <span className="library-dialogue-label">
                        <span className="library-dialogue-avatar">?</span>
                        你可能想問
                      </span>
                      {section.heading ? (
                        <BodyBlockView block={section.heading} />
                      ) : (
                        <h2 className="library-body-heading">
                          {openingQuestions[article.slug] ?? article.h1}
                        </h2>
                      )}
                    </div>
                    <div className="library-answer">
                      <span className="library-dialogue-label">
                        <span className="library-oxm-avatar">OXM</span>OXM
                        知識整理
                      </span>
                      <div className="library-answer-content">
                        {section.blocks.map((block, index) => (
                          <BodyBlockView key={index} block={block} />
                        ))}
                      </div>
                    </div>
                  </section>
                ))}
              </div>
              {article.faq && article.faq.length > 0 && (
                <section className="library-faq">
                  <div className="library-section-label">
                    <span>你可能還想問</span>
                    <span>OXM 知識整理</span>
                  </div>
                  <h2>常見問題</h2>
                  <dl>
                    {article.faq.map((qa, index) => (
                      <div className="library-faq-item" key={index}>
                        <dt>
                          <span aria-hidden="true">
                            Q{String(index + 1).padStart(2, "0")}
                          </span>
                          {qa.question}
                        </dt>
                        <dd>{qa.answer}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
              <section className="library-next-step" aria-label="下一步">
                <div className="library-section-label">
                  <span>從了解開始</span>
                  <span>NEXT STEP</span>
                </div>
                <h2>從資料走向實際合作</h2>
                <p>{article.cta.description}</p>
                <div className="library-cta-links">
                  <Link href={article.cta.href} className="library-cta-primary">
                    {article.cta.label}
                    <ArrowUpRight size={18} />
                  </Link>
                </div>
              </section>
              {article.relatedArticleSlugs.length > 0 && (
                <section className="library-related">
                  <div className="library-section-label">
                    <span>繼續探索</span>
                    <span>延伸查閱</span>
                  </div>
                  <h2>相關館藏</h2>
                  <ul data-testid="related-articles">
                    {article.relatedArticleSlugs.map(relSlug => {
                      const rel = getLibraryArticle(relSlug);
                      if (!rel) return null;
                      return (
                        <li key={relSlug}>
                          <span>{rel.libraryId}</span>
                          <Link href={`/library/${rel.slug}`}>
                            {rel.title}
                            <ArrowUpRight size={17} />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </div>
          </div>
          <div className="library-document-bottomline">
            <span>OXM / 傳產圖書館</span>
            <Link href="/library">
              <ArrowLeft size={15} />
              返回館藏索引
            </Link>
          </div>
        </article>
      </main>
    </div>
  );
}
