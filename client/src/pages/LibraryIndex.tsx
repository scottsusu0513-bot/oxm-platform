import { useState } from "react";
import { Helmet } from "react-helmet-async";
import {
  ArrowUpRight,
  BookOpenText,
  Factory,
  FileText,
  Network,
  Sparkles,
} from "lucide-react";
import { Link } from "wouter";
import Navbar from "@/components/Navbar";
import {
  buildLibraryIndexContent,
  buildLibraryIndexBreadcrumbJsonLd,
} from "@shared/seo/libraryPages";
import { toSafeJsonLdString } from "@shared/seo/schema";
import {
  LIBRARY_ARTICLES,
  LIBRARY_CATEGORIES,
  estimateReadingMinutes,
  type LibraryCategory,
} from "@shared/content/library";
import "./library.css";

type CategoryFilter = "全部" | LibraryCategory;
const categories: CategoryFilter[] = ["全部", ...LIBRARY_CATEGORIES];

const shelfSpineColors = [
  "#e9a776",
  "#b99ad1",
  "#f5c8a4",
  "#d5b9e4",
  "#e9b5a9",
  "#c5aedc",
  "#f0b992",
];
const shelfLabels = ["代工", "製程", "材料", "設備", "採購", "品質", "工廠"];

function LibraryHeroShelves() {
  const rows = [122, 252, 382];
  return (
    <svg
      className="library-hero-shelves"
      viewBox="0 0 1440 390"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="library-shelf-frame" x1="0" x2="1" y1="0" y2="0">
          <stop stopColor="#e9b48e" />
          <stop offset=".52" stopColor="#c9a4d8" />
          <stop offset="1" stopColor="#e7af8c" />
        </linearGradient>
      </defs>
      {rows.map((baseline, row) => {
        let position = 14;
        return (
          <g key={baseline}>
            {Array.from({ length: 83 }, (_, index) => {
              const width = 12 + ((index * 11 + row * 7) % 12);
              const height = 68 + ((index * 17 + row * 29) % 42);
              const x = position;
              position += width + 4;
              const label = index % 12 === 4;
              return (
                <g key={`${row}-${index}`}>
                  <rect
                    x={x}
                    y={baseline - height}
                    width={width}
                    height={height}
                    rx="1.5"
                    fill={
                      shelfSpineColors[
                        (index + row * 2) % shelfSpineColors.length
                      ]
                    }
                    stroke="#a58ab9"
                    strokeWidth=".8"
                  />
                  <path
                    d={`M${x + 2} ${baseline - 12}h${width - 4}M${x + 2} ${baseline - height + 10}h${width - 4}`}
                    stroke="#fffaf7"
                    strokeWidth="1.5"
                  />
                  {label && (
                    <text
                      transform={`translate(${x + width / 2 + 3} ${baseline - height + 19}) rotate(90)`}
                      fill="#76518d"
                      fontSize="8"
                      fontWeight="700"
                      letterSpacing="1"
                    >
                      {
                        shelfLabels[
                          (Math.floor(index / 12) + row) % shelfLabels.length
                        ]
                      }
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
      <g fill="url(#library-shelf-frame)">
        <path d="M0 120h1440v13H0zM0 250h1440v13H0zM0 380h1440v10H0z" />
        <path d="M0 0h16v390H0zM468 0h17v390h-17zM950 0h17v390h-17zM1424 0h16v390h-16z" />
      </g>
      <g fill="none" stroke="#fff8f3" strokeWidth="2">
        <path d="M0 123h1440M0 253h1440M16 0v390M485 0v390M967 0v390" />
      </g>
    </svg>
  );
}

export default function LibraryIndex() {
  const [filter, setFilter] = useState<CategoryFilter>("全部");
  const content = buildLibraryIndexContent();
  const breadcrumbJsonLd = buildLibraryIndexBreadcrumbJsonLd();
  // 排序一律讀 article.learningOrder（入門閱讀順序），不依賴陣列宣告順序、
  // libraryId 或 publishedAt——這三者都只反映「什麼時候寫的／上架的」，不
  // 是「應該先讀哪一篇」（見任務定案「傳產圖書館新增文章 + 入門閱讀順序
  // 重整」）。
  const visibleArticles = (
    filter === "全部"
      ? LIBRARY_ARTICLES
      : LIBRARY_ARTICLES.filter(article => article.category === filter)
  )
    .slice()
    .sort((a, b) => a.learningOrder - b.learningOrder);

  function selectWithKeyboard(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ) {
    const next =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? (index + 1) % categories.length
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? (index - 1 + categories.length) % categories.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? categories.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    setFilter(categories[next]);
    document.getElementById(`library-category-${next}`)?.focus();
  }

  return (
    <div className="library-page">
      <Helmet>
        <title>{content.title}</title>
        <meta name="description" content={content.description} />
        <link rel="canonical" href={content.canonical} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="OXM" />
        <meta property="og:url" content={content.canonical} />
        <meta property="og:title" content={content.title} />
        <meta property="og:description" content={content.description} />
        <script type="application/ld+json">
          {toSafeJsonLdString(breadcrumbJsonLd)}
        </script>
      </Helmet>
      <Navbar />
      <main>
        <div className="library-wrap">
          <nav aria-label="breadcrumb" className="library-breadcrumb">
            <Link href="/">OXM 首頁</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">傳產圖書館</span>
          </nav>
        </div>
        <header className="library-index-hero">
          <LibraryHeroShelves />
          <div className="library-wrap library-index-hero-inner">
            <div className="library-hero-copy">
              <div className="library-kicker">
                <Sparkles size={15} /> OXM KNOWLEDGE LIBRARY
              </div>
              <p className="library-hero-overline">
                把製造業知識，變成每一步都用得上的指南。
              </p>
              <h1>{content.h1}</h1>
              <p className="library-hero-description">
                讓製造業採購、品牌與工廠快速查找代工、製程、材料與採購知識。
              </p>
              <div className="library-hero-footer">
                <span>製造業知識資料庫</span>
                <span>
                  現有館藏 {String(LIBRARY_ARTICLES.length).padStart(2, "0")} 份
                </span>
              </div>
            </div>
            <div className="library-hero-artwork" aria-hidden="true">
              <div className="library-hero-artwork-orbit" />
              <div className="library-hero-artwork-book">
                <span>OXM KNOWLEDGE</span>
                <BookOpenText size={66} strokeWidth={1.3} />
                <small>製造知識，從這裡展開</small>
              </div>
              <span className="library-hero-artwork-node node-factory">
                <Factory size={21} />
                製造
              </span>
              <span className="library-hero-artwork-node node-file">
                <FileText size={21} />
                知識
              </span>
              <span className="library-hero-artwork-node node-network">
                <Network size={21} />
                連結
              </span>
            </div>
          </div>
        </header>
        <div className="library-wrap library-index-layout">
          <aside className="library-category-sidebar" aria-label="館藏索引">
            <div className="library-section-label">
              <span>依主題探索</span>
              <span>館藏分類</span>
            </div>
            <div
              role="tablist"
              aria-label="館藏分類"
              className="library-category-list"
            >
              {categories.map((category, index) => {
                const count =
                  category === "全部"
                    ? LIBRARY_ARTICLES.length
                    : LIBRARY_ARTICLES.filter(a => a.category === category)
                        .length;
                return (
                  <button
                    id={`library-category-${index}`}
                    key={category}
                    type="button"
                    role="tab"
                    aria-selected={filter === category}
                    aria-label={category === "全部" ? "全部館藏" : category}
                    aria-controls="library-category-panel"
                    tabIndex={filter === category ? 0 : -1}
                    onClick={() => setFilter(category)}
                    onKeyDown={event => selectWithKeyboard(event, index)}
                    className={`library-category-item ${filter === category ? "is-active" : ""}`}
                  >
                    <span className="library-category-name">
                      <span className="library-category-index">
                        {String(index).padStart(2, "0")}
                      </span>
                      {category === "全部" ? "全部館藏" : category}
                    </span>
                    <span className="library-category-count">
                      {String(count).padStart(2, "0")}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="library-sidebar-note">
              OXM KNOWLEDGE
              <br />
              製造業資料持續整理中
            </p>
          </aside>
          <section
            id="library-category-panel"
            role="tabpanel"
            aria-labelledby={`library-category-${categories.indexOf(filter)}`}
            className="library-index-results"
          >
            <div className="library-results-head">
              <div>
                <div className="library-section-label">
                  <span>OXM / GUIDES</span>
                  <span>館藏指南</span>
                </div>
                <h2>{filter === "全部" ? "全部館藏" : filter}</h2>
              </div>
              <span className="library-results-count">
                {visibleArticles.length} 篇指南
              </span>
            </div>
            {visibleArticles.length === 0 ? (
              <div className="library-empty">
                <span>— 暫無資料 —</span>
                <p>此分類目前尚無館藏資料。</p>
              </div>
            ) : (
              <ul
                className="library-record-list"
                data-testid="library-card-list"
              >
                {visibleArticles.map((article, index) => (
                  <li
                    key={article.slug}
                    className="library-record"
                    data-testid="library-card"
                  >
                    <span className="library-record-icon" aria-hidden="true">
                      {index % 3 === 0 ? (
                        <BookOpenText size={24} />
                      ) : index % 3 === 1 ? (
                        <Network size={24} />
                      ) : (
                        <Factory size={24} />
                      )}
                    </span>
                    <div className="library-record-content">
                      <div className="library-record-top">
                        <span className="library-record-id">
                          {article.libraryId}
                        </span>
                        <span className="library-record-divider" />
                        <span>{article.category}</span>
                      </div>
                      <h3>
                        <Link href={`/library/${article.slug}`}>
                          {article.title}
                        </Link>
                      </h3>
                      <p className="library-record-excerpt">
                        {article.excerpt}
                      </p>
                      <div className="library-record-bottom">
                        <span>最後更新 {article.updatedAt}</span>
                        <span>
                          閱讀時間 {estimateReadingMinutes(article)} 分鐘
                        </span>
                      </div>
                    </div>
                    <Link
                      href={`/library/${article.slug}`}
                      className="library-record-action"
                      aria-label={`查閱資料：${article.title}`}
                    >
                      <span>查閱資料</span>
                      <ArrowUpRight size={17} strokeWidth={1.7} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <div className="library-index-footnote">
              <span>OXM / 傳產圖書館</span>
              <span>製造知識，持續整理中</span>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
