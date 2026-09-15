import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, Check, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DIAGNOSTIC_QUESTIONS,
  INITIAL_ANSWERS,
  calculateRecommendation,
  buildResultContent,
  getUrgencyText,
  isQuestionAnswered,
  toggleMultiAnswer,
  type Answers,
  type DiagnosticQuestion,
  type Recommendation,
} from "@/lib/resourceDiagnostic";

const TOTAL_STEPS = DIAGNOSTIC_QUESTIONS.length;

/** 單一選項的「小測驗感」按鈕：不用原生 radio/checkbox 外觀，選取狀態同時靠
 *  邊框顏色＋底色＋勾選圖示三種訊號呈現（不是只靠顏色）。 */
function OptionPill({
  label,
  selected,
  onClick,
  role,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  role: "radio" | "checkbox";
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left text-sm font-medium transition-all sm:text-base",
        "active:scale-[0.98]",
        selected
          ? "border-purple-500 bg-gradient-to-r from-purple-50 to-orange-50 text-purple-900 shadow-sm"
          : "border-slate-200 bg-white text-slate-700 hover:border-purple-200 hover:bg-purple-50/40",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
          selected ? "border-purple-600 bg-purple-600 text-white" : "border-slate-300 bg-white",
        )}
      >
        {selected && <Check className="h-3.5 w-3.5" />}
      </span>
      <span className="min-w-0 flex-1 break-words">{label}</span>
    </button>
  );
}

/** 逐題模式：一次只渲染目前這一題（不是全部 4 題），維持卡片高度相對穩定
 *  ——不同題目選項數不同會有自然高度差，但不會有「一次展開全部題目」造成
 *  的大幅度高度跳動（見任務要求 F）。 */
function QuestionStep({
  question,
  answers,
  showMissingHint,
  onSingleSelect,
  onMultiToggle,
}: {
  question: DiagnosticQuestion;
  answers: Answers;
  showMissingHint: boolean;
  onSingleSelect: (questionId: "q1" | "q3" | "q4", optionId: string) => void;
  onMultiToggle: (optionId: string) => void;
}) {
  return (
    <fieldset className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4 sm:p-5">
      <legend className="mb-3 text-base font-bold text-slate-900 sm:text-lg">{question.title}</legend>
      <div
        role={question.type === "single" ? "radiogroup" : "group"}
        aria-label={question.title}
        className="grid gap-2 sm:grid-cols-2"
      >
        {question.options.map(option => {
          const selected =
            question.type === "single"
              ? answers[question.id as "q1" | "q3" | "q4"] === option.id
              : answers.q2.includes(option.id);
          return (
            <OptionPill
              key={option.id}
              label={option.label}
              selected={selected}
              role={question.type === "single" ? "radio" : "checkbox"}
              onClick={() =>
                question.type === "single"
                  ? onSingleSelect(question.id as "q1" | "q3" | "q4", option.id)
                  : onMultiToggle(option.id)
              }
            />
          );
        })}
      </div>
      {showMissingHint && (
        <p className="mt-2 text-xs font-medium text-rose-600">
          {question.type === "multi" ? "請至少選擇一項" : "請選擇一個選項"}
        </p>
      )}
    </fieldset>
  );
}

function ResultBlock({
  recommendation,
  answers,
  onRestart,
}: {
  recommendation: Recommendation;
  answers: Answers;
  onRestart: () => void;
}) {
  const urgencyText = getUrgencyText(answers.q4);
  const primary = buildResultContent(recommendation.primary);
  const secondary = recommendation.secondary ? buildResultContent(recommendation.secondary) : null;

  return (
    <div key="result" className="animate-in fade-in-0 slide-in-from-right-2 duration-200">
      <div className="rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50 via-white to-orange-50 p-5 sm:p-7">
        <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-purple-600 px-3 py-1 text-xs font-bold text-white">
          <Sparkles className="h-3.5 w-3.5" />最建議先了解
        </span>
        <h3 className="mb-2 text-xl font-black text-slate-900 sm:text-2xl">{primary.title}</h3>
        <p className="mb-1 text-sm leading-relaxed text-slate-600 sm:text-base">{primary.description}</p>
        {urgencyText && <p className="mb-5 text-sm font-semibold text-purple-700">{urgencyText}</p>}
        <Link
          href={primary.href}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-purple-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition-all hover:shadow-md active:scale-[0.98]"
        >
          查看{primary.title}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {secondary && (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <span className="mb-2 inline-block rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
            也可以參考
          </span>
          <h4 className="mb-3 text-base font-bold text-slate-900 sm:text-lg">{secondary.title}</h4>
          <Link
            href={secondary.href}
            className="inline-flex items-center gap-2 text-sm font-bold text-purple-700 hover:text-purple-800"
          >
            查看{secondary.title}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      <button
        type="button"
        onClick={onRestart}
        className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-700"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        重新測一次
      </button>
    </div>
  );
}

export default function ResourceDiagnostic() {
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Answers>(INITIAL_ANSWERS);
  const [attemptedNext, setAttemptedNext] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);

  const currentQuestion = DIAGNOSTIC_QUESTIONS[stepIndex];
  const isLastStep = stepIndex === TOTAL_STEPS - 1;
  const currentAnswered = isQuestionAnswered(currentQuestion, answers);

  const handleSingleSelect = (questionId: "q1" | "q3" | "q4", optionId: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: optionId }));
  };

  const handleMultiToggle = (optionId: string) => {
    setAnswers(prev => ({ ...prev, q2: toggleMultiAnswer("q2", prev.q2, optionId) }));
  };

  const handleNext = () => {
    if (!currentAnswered) {
      setAttemptedNext(true);
      return;
    }
    if (isLastStep) {
      setRecommendation(calculateRecommendation(answers));
      setShowResult(true);
      return;
    }
    setAttemptedNext(false);
    setStepIndex(i => i + 1);
  };

  const handlePrev = () => {
    setAttemptedNext(false);
    setStepIndex(i => Math.max(0, i - 1));
  };

  const handleRestart = () => {
    setAnswers(INITIAL_ANSWERS);
    setAttemptedNext(false);
    setRecommendation(null);
    setShowResult(false);
    setStepIndex(0);
  };

  return (
    <section className="px-4 py-4 sm:py-6" aria-label="企業需求診斷">
      <div className="container max-w-6xl">
        <div className="overflow-hidden rounded-[2rem] border border-purple-100 bg-gradient-to-br from-blue-50 via-white to-purple-50 shadow-sm">
          <div className="p-6 sm:p-9">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <span className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-purple-100 bg-white/80 px-3 py-1.5 text-xs font-semibold tracking-[0.1em] text-purple-700 shadow-sm">
                  <Wand2 className="h-3.5 w-3.5 text-orange-500" />不知道怎麼選？
                </span>
                <h2 className="mb-2 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
                  不知道該從哪一項開始？
                </h2>
                <p className="max-w-xl text-sm leading-relaxed text-slate-600 sm:text-base">
                  回答幾個簡單問題，快速找到目前較適合您的企業資源。
                </p>
              </div>

              {/* 進度提示：取代原本「開始 1 分鐘診斷」按鈕的位置，只在題目
                  階段顯示，結果畫面不需要（見任務要求 B）。 */}
              {!showResult && (
                <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                  <span className="text-xs font-semibold text-slate-500">
                    第 {stepIndex + 1} 題 / 共 {TOTAL_STEPS} 題
                  </span>
                  <div className="flex gap-1.5" aria-hidden="true">
                    {DIAGNOSTIC_QUESTIONS.map((question, index) => (
                      <span
                        key={question.id}
                        className={cn(
                          "h-1.5 w-6 rounded-full transition-colors",
                          index < stepIndex || (index === stepIndex && currentAnswered)
                            ? "bg-purple-600"
                            : index === stepIndex
                              ? "bg-purple-300"
                              : "bg-slate-200",
                        )}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6">
              {!showResult ? (
                <div key={currentQuestion.id} className="animate-in fade-in-0 slide-in-from-right-2 duration-200">
                  <QuestionStep
                    question={currentQuestion}
                    answers={answers}
                    showMissingHint={attemptedNext && !currentAnswered}
                    onSingleSelect={handleSingleSelect}
                    onMultiToggle={handleMultiToggle}
                  />

                  <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                    {stepIndex > 0 && (
                      <button
                        type="button"
                        onClick={handlePrev}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-6 py-3.5 text-sm font-bold text-slate-600 transition-all hover:bg-slate-50 active:scale-[0.98] sm:w-auto"
                      >
                        <ArrowLeft className="h-4 w-4" />
                        上一步
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleNext}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-orange-500 to-purple-600 px-6 py-3.5 text-sm font-bold text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98] sm:w-auto"
                    >
                      {isLastStep ? "查看適合我的資源" : "下一步"}
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : (
                recommendation && <ResultBlock recommendation={recommendation} answers={answers} onRestart={handleRestart} />
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
