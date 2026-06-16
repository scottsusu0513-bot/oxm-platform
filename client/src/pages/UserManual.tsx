import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Search, X, ChevronRight, HelpCircle,
  BookOpen, CheckCircle, Clock, AlertCircle, ArrowLeft,
} from "lucide-react";
import { ManualAnnotatedImage } from "@/components/ManualAnnotatedImage";
import {
  MANUAL_CATEGORIES,
  MANUAL_ARTICLES,
  MANUAL_ENTRY_ENABLED,
  getArticlesByCategory,
  getPopularArticles,
  searchArticles,
  type ManualArticle,
} from "@/lib/manual";

// ── 單篇教學展開內容 ─────────────────────────────────────────────────────────

function ArticleContent({ article }: { article: ManualArticle }) {
  if (article.steps.length === 0) {
    return (
      <div className="px-4 pb-4 text-sm text-muted-foreground flex items-center gap-2">
        <Clock className="w-4 h-4 shrink-0" />
        <span>教學內容準備中，敬請期待。</span>
      </div>
    );
  }

  return (
    <div className="px-4 pb-4 space-y-5">
      {article.steps.map((step, idx) => (
        <div key={step.id} className="space-y-2">
          <div className="flex items-start gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-orange-500 text-white text-xs font-bold flex items-center justify-center mt-0.5">
              {idx + 1}
            </span>
            <div className="flex-1 min-w-0">
              {step.title && (
                <p className="font-medium text-sm mb-1">{step.title}</p>
              )}
              <p className="text-sm text-muted-foreground leading-relaxed">
                {step.description}
              </p>
            </div>
          </div>

          {/* 橘色提醒框（重要注意事項；支援字串或字串陣列） */}
          {step.note && (
            <div className="ml-9 flex items-start gap-2 rounded-lg bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 px-3 py-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-orange-500 mt-0.5" aria-hidden="true" />
              <div className="space-y-1">
                {(Array.isArray(step.note) ? step.note : [step.note]).map((line, i) => (
                  <p key={i} className="text-xs text-orange-700 dark:text-orange-300 leading-relaxed">
                    {line}
                  </p>
                ))}
              </div>
            </div>
          )}

          {step.image ? (
            <div className="ml-9">
              <ManualAnnotatedImage
                src={step.image}
                alt={step.imageAlt ?? step.title ?? `步驟 ${idx + 1}`}
                caption={step.imageCaption}
                annotations={step.annotations}
              />
            </div>
          ) : article.status === 'draft' ? (
            <div className="ml-9 flex items-center gap-2 text-xs text-muted-foreground px-3 py-2 rounded-lg bg-muted/30 border border-dashed border-border">
              <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              教學圖片準備中
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ── 單篇教學列項（可展開）────────────────────────────────────────────────────

function ArticleItem({
  article,
  isOpen,
  onToggle,
}: {
  article: ManualArticle;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
      >
        <ChevronRight
          className={`w-4 h-4 shrink-0 mt-0.5 text-muted-foreground transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm leading-snug">{article.title}</span>
            {article.status === 'ready' ? (
              <CheckCircle className="w-3.5 h-3.5 shrink-0 text-green-500" aria-label="已完成" />
            ) : article.status === 'draft' ? (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 text-orange-500 border-orange-300">
                圖片準備中
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 text-muted-foreground">
                準備中
              </Badge>
            )}
          </div>
          {!isOpen && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
              {article.summary}
            </p>
          )}
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-border">
          <p className="px-4 pt-3 pb-2 text-sm text-muted-foreground leading-relaxed">
            {article.summary}
          </p>
          <ArticleContent article={article} />
        </div>
      )}
    </div>
  );
}

// ── 熱門問題按鈕 ──────────────────────────────────────────────────────────────

function PopularQuestionButton({
  article,
  onSelect,
}: {
  article: ManualArticle;
  onSelect: (id: string, categoryId: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(article.id, article.categoryId)}
      className="flex items-center gap-2 w-full text-left px-3 py-2.5 rounded-lg border border-border bg-background hover:bg-muted/60 hover:border-orange-300 transition-all text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
      aria-label={`查看教學：${article.title}`}
    >
      <HelpCircle className="w-4 h-4 shrink-0 text-orange-500" aria-hidden="true" />
      <span className="font-medium leading-snug">{article.title}</span>
    </button>
  );
}

// ── 搜尋結果列表 ──────────────────────────────────────────────────────────────

function SearchResults({
  query,
  openArticle,
  onToggleArticle,
}: {
  query: string;
  openArticle: string | null;
  onToggleArticle: (id: string) => void;
}) {
  const results = useMemo(() => searchArticles(query), [query]);

  if (results.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground space-y-2">
        <Search className="w-8 h-8 mx-auto opacity-30" aria-hidden="true" />
        <p className="text-sm">找不到相關教學，請嘗試其他關鍵字。</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground mb-3">
        找到 {results.length} 筆結果
      </p>
      {results.map(article => (
        <ArticleItem
          key={article.id}
          article={article}
          isOpen={openArticle === article.id}
          onToggle={() => onToggleArticle(article.id)}
        />
      ))}
    </div>
  );
}

// ── 主頁面 ────────────────────────────────────────────────────────────────────

export default function UserManual() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!loading && (!user || user.role !== "admin")) {
      navigate("/", { replace: true });
    }
  }, [loading, user, navigate]);

  const [searchQuery, setSearchQuery] = useState('');
  const [openArticle, setOpenArticle] = useState<string | null>(null);
  // accordion value 支援多個分類同時展開
  const [openCategories, setOpenCategories] = useState<string[]>(['getting-started']);

  const popularArticles = useMemo(() => getPopularArticles(), []);
  const isSearching = searchQuery.trim().length > 0;

  if (loading || !user || user.role !== "admin") return <AppLoading />;

  function toggleArticle(id: string) {
    setOpenArticle(prev => prev === id ? null : id);
  }

  // 點熱門問題：展開對應分類並滾動到教學
  function handlePopularSelect(articleId: string, categoryId: string) {
    setSearchQuery('');
    setOpenArticle(articleId);
    setOpenCategories(prev =>
      prev.includes(categoryId) ? prev : [...prev, categoryId]
    );
    // 等 DOM 更新後滾動
    setTimeout(() => {
      document.getElementById(`article-${articleId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 150);
  }

  return (
    <div className="min-h-screen bg-background">
      {/* ── 頁首 ────────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-br from-orange-500 to-purple-600 text-white">
        <div className="max-w-3xl mx-auto px-4 py-10 sm:py-14">
          <button
            onClick={() => window.history.back()}
            className="flex items-center gap-1.5 text-white/80 hover:text-white transition-colors mb-5 text-sm"
            aria-label="回上一頁"
          >
            <ArrowLeft className="w-4 h-4" />
            回上一頁
          </button>
          <div className="flex items-center gap-3 mb-3">
            <BookOpen className="w-7 h-7 shrink-0" aria-hidden="true" />
            <h1 className="text-2xl sm:text-3xl font-bold">使用手冊</h1>
          </div>
          <p className="text-white/80 text-sm sm:text-base mb-6">
            快速找到你需要的操作教學
          </p>

          {/* 搜尋欄 */}
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
              aria-hidden="true"
            />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder='搜尋問題，例如「PDF」、「上架」、「合作確認單」'
              className="pl-9 pr-9 bg-white/95 border-0 text-foreground placeholder:text-muted-foreground rounded-xl h-11 focus-visible:ring-2 focus-visible:ring-white/50"
              aria-label="搜尋使用手冊"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="清除搜尋"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 pb-16 pt-6 space-y-8">

        {/* ── 製作中提示（MANUAL_ENTRY_ENABLED = false 時顯示）──────── */}
        {!MANUAL_ENTRY_ENABLED && (
          <div className="flex items-start gap-3 rounded-xl border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/30 px-4 py-3.5">
            <Clock className="w-4 h-4 shrink-0 text-orange-500 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-orange-700 dark:text-orange-300">使用手冊製作中</p>
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">
                此頁面目前正在逐步完善，部分教學內容尚未完成。
              </p>
            </div>
          </div>
        )}

        {/* ── 搜尋結果 ─────────────────────────────────────────────── */}
        {isSearching && (
          <section aria-label="搜尋結果">
            <SearchResults
              query={searchQuery.trim()}
              openArticle={openArticle}
              onToggleArticle={toggleArticle}
            />
          </section>
        )}

        {/* ── 熱門問題（搜尋時隱藏）──────────────────────────────────── */}
        {!isSearching && (
          <section aria-label="熱門問題">
            <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-orange-500" aria-hidden="true" />
              熱門問題
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {popularArticles.map(article => (
                <PopularQuestionButton
                  key={article.id}
                  article={article}
                  onSelect={handlePopularSelect}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── 分類教學（搜尋時隱藏）──────────────────────────────────── */}
        {!isSearching && (
          <section aria-label="分類教學">
            <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-orange-500" aria-hidden="true" />
              所有教學
            </h2>

            <Accordion
              type="multiple"
              value={openCategories}
              onValueChange={setOpenCategories}
              className="space-y-2"
            >
              {MANUAL_CATEGORIES.sort((a, b) => a.order - b.order).map(category => {
                const articles = getArticlesByCategory(category.id);
                const readyCount = articles.filter(a => a.status === 'ready').length;

                return (
                  <AccordionItem
                    key={category.id}
                    value={category.id}
                    className="border border-border rounded-xl overflow-hidden px-0"
                  >
                    <AccordionTrigger className="px-4 py-3.5 hover:no-underline hover:bg-muted/40 font-medium text-sm [&[data-state=open]]:bg-muted/40">
                      <div className="flex items-center gap-2 flex-1 min-w-0 text-left">
                        <span>{category.title}</span>
                        <span className="text-xs text-muted-foreground font-normal">
                          {articles.length} 篇
                          {readyCount > 0 && ` · ${readyCount} 篇已完成`}
                        </span>
                      </div>
                    </AccordionTrigger>

                    <AccordionContent className="px-3 pb-3 pt-1">
                      <div className="space-y-2">
                        {articles.map(article => (
                          <div key={article.id} id={`article-${article.id}`}>
                            <ArticleItem
                              article={article}
                              isOpen={openArticle === article.id}
                              onToggle={() => toggleArticle(article.id)}
                            />
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </section>
        )}

        {/* ── 底部提示 ────────────────────────────────────────────── */}
        {!isSearching && (
          <div className="rounded-xl border border-border bg-muted/30 px-5 py-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-1">找不到你要的答案？</p>
            <p>歡迎透過工廠後台的「聯繫客服」功能回報問題，我們會盡快協助。</p>
          </div>
        )}
      </div>
    </div>
  );
}
