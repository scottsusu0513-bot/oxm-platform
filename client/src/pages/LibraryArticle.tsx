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
} from "@shared/content/library";
import "./library.css";

function BodyBlockView({ block }: { block: LibraryBodyBlock }) {
  switch (block.type) {
    case "heading":
      return <h2 className="library-body-heading">{block.text}</h2>;
    case "paragraph":
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
    case "relatedLink": {
      const target = getLibraryArticle(block.slug);
      if (!target) return null;
      return (
        <p className="library-context-link">
          <span aria-hidden="true">↗</span>
          <Link href={`/library/${block.slug}`}>{block.text}</Link>
        </p>
      );
    }
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
  "what-is-moq": "第一次聽到 MOQ，該從哪裡開始？",
  "oem-vs-odm": "OEM 和 ODM，怎麼快速理解？",
  "first-time-factory-guide": "第一次找代工廠，該從哪裡開始？",
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
      <FloatingBackButton
        fallbackHref="/library"
        label="返回圖書館"
        deterministic
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
                          {openingQuestions[article.slug] ??
                            "這份指南從哪裡開始？"}
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
                  {article.cta.secondaryLabel && article.cta.secondaryHref && (
                    <Link
                      href={article.cta.secondaryHref}
                      className="library-cta-secondary"
                    >
                      {article.cta.secondaryLabel}
                      <ArrowUpRight size={18} />
                    </Link>
                  )}
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
