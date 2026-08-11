/**
 * 研究材料一覽（給指導教授審閱用）。
 *
 * 四份材料散在不同地方：system prompt 在程式碼、反思題目在資料庫、
 * 高階提問規則與編碼架構在程式碼。要拿給指導教授看，總不能請他自己
 * 開四個檔案。這一頁把它們的**當前生效版本**併在一起，可直接列印。
 *
 * 【為什麼這件事重要】這四份材料一旦開始收資料就凍結（CLAUDE.md 鐵則三）。
 * 沒有人一次看完全部，就很難發現它們之間的矛盾——例如反思題目要學生
 * 「找一段綠色」，而 θ 設定卻讓綠色幾乎不會出現。
 */
import { requireRole } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SYSTEM_PROMPTS } from "@/lib/ai/system-prompts";
import { reflectionPromptVersion } from "@/lib/reflection/config";
import { dnaThresholds } from "@/lib/dna/config";
import { getScheme, CURRENT_SCHEME_VERSION } from "@/lib/coding/scheme";
import { QUESTION_RULE_VERSION } from "@/lib/metrics/questions";
import { METRICS_VERSION } from "@/lib/metrics/quadrant";
import { DNA_ALGORITHM_VERSION } from "@/lib/dna/service";
import QuestionRules from "./QuestionRules";

export default async function MaterialsPage() {
  await requireRole("teacher", "researcher");

  const promptVersion = reflectionPromptVersion();
  const theta = dnaThresholds();
  const scheme = getScheme();

  const { data: prompt } = await supabaseAdmin()
    .from("reflection_prompts")
    .select("version, questions")
    .eq("version", promptVersion)
    .maybeSingle<{ version: string; questions: { id: string; text: string; min_chars: number }[] }>();

  const { data: classes } = await supabaseAdmin()
    .from("classes")
    .select("label, model, temperature, system_prompt_version")
    .order("label");

  const systemPromptVersions = [
    ...new Set(
      ((classes ?? []) as { system_prompt_version: string }[]).map((c) => c.system_prompt_version),
    ),
  ];

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-8 print:max-w-none print:p-0">
      <header>
        <h1 className="text-2xl font-bold">研究材料一覽</h1>
        <p className="mt-1 text-neutral-600">
          以下四份材料構成本研究的操弄與測量工具。
          <strong>正式收資料前需經指導教授確認定稿</strong>，之後三期凍結不得變動。
        </p>
        <p className="mt-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          ⚠ 一旦開始收第一期資料，這四份的版本號就不能再改。要調整只能發新版本，
          且僅限下一個研究週期使用；已用於收資料的版本永遠保留。
        </p>
      </header>

      {/* 一、AI 的 system prompt */}
      <section className="break-inside-avoid">
        <h2 className="border-b border-neutral-300 pb-1 text-lg font-bold">
          一、AI 助教的 system prompt
          <span className="ml-3 font-mono text-sm font-normal text-neutral-500">
            {systemPromptVersions.join("、") || "（尚未設定班級）"}
          </span>
        </h2>
        <p className="mt-2 text-sm text-neutral-600">
          這段話決定 AI 對學生的回應風格，是本研究的**操弄材料**。
        </p>
        {systemPromptVersions.map((version) => (
          <div key={version} className="mt-3">
            <p className="text-sm font-medium text-neutral-700">版本 {version}</p>
            <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-neutral-50 px-4 py-3 text-sm leading-relaxed text-neutral-800">
              {SYSTEM_PROMPTS[version] ?? "（程式碼中找不到這個版本）"}
            </pre>
          </div>
        ))}
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-600">
              <th className="py-1 pr-4">班級</th>
              <th className="py-1 pr-4">模型</th>
              <th className="py-1 pr-4">temperature</th>
              <th className="py-1">prompt 版本</th>
            </tr>
          </thead>
          <tbody>
            {((classes ?? []) as {
              label: string;
              model: string;
              temperature: number;
              system_prompt_version: string;
            }[]).map((row) => (
              <tr key={row.label} className="border-b border-neutral-100">
                <td className="py-1 pr-4">{row.label}</td>
                <td className="py-1 pr-4 font-mono text-xs">{row.model}</td>
                <td className="py-1 pr-4 tabular-nums">{row.temperature}</td>
                <td className="py-1 font-mono text-xs">{row.system_prompt_version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* 二、反思題目 */}
      <section className="break-inside-avoid">
        <h2 className="border-b border-neutral-300 pb-1 text-lg font-bold">
          二、反思題目
          <span className="ml-3 font-mono text-sm font-normal text-neutral-500">
            {promptVersion}
          </span>
        </h2>
        <p className="mt-2 text-sm text-neutral-600">
          交件後強制作答。三題分別對應自我調整學習的自我觀察、自我判斷、自我反應；
          第三題的原文會在下一期開場的「上次的你」卡片上原樣呈現。
        </p>
        {prompt ? (
          <ol className="mt-3 flex flex-col gap-2">
            {prompt.questions.map((question, index) => (
              <li key={question.id} className="rounded-lg bg-neutral-50 px-4 py-3">
                <p className="text-base text-neutral-900">
                  {index + 1}. {question.text}
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  代號 {question.id}　最少 {question.min_chars} 字
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-orange-700">
            找不到版本「{promptVersion}」——請確認 migration 007 已套用。
          </p>
        )}
      </section>

      {/* 三、DNA 門檻與高階提問規則 */}
      <section className="break-inside-avoid">
        <h2 className="border-b border-neutral-300 pb-1 text-lg font-bold">
          三、量化測量的操作型定義
        </h2>

        <h3 className="mt-3 text-base font-semibold text-neutral-800">
          三色歸因門檻
          <span className="font-mono text-sm font-normal text-neutral-500">
            {DNA_ALGORITHM_VERSION}
          </span>
        </h3>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm text-neutral-700">
          <li>
            相似度 ≥ <strong>{theta.high}</strong> → 藍（AI 寫的、你沒改）
          </li>
          <li>
            <strong>{theta.low}</strong> ≤ 相似度 &lt; {theta.high} → 綠（AI 寫的、你改過）
          </li>
          <li>
            相似度 &lt; {theta.low}、或沒有來源標記 → 橘（你自己寫的）
          </li>
          <li>相似度＝正規化 Levenshtein（1 − 編輯距離 ÷ 較長者長度）</li>
          <li>
            外部貼上（Google／Word）歸橘，但另記 origin 供研究者拆分——
            學生只看得到三色。
          </li>
        </ul>

        <h3 className="mt-4 text-base font-semibold text-neutral-800">
          象限座標
          <span className="font-mono text-sm font-normal text-neutral-500">
            {METRICS_VERSION}
          </span>
        </h3>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm text-neutral-700">
          <li>X（互動深度）＝ z(對話輪次) + z(平均提問長度) + z(高階提問次數)，以該期全班為基準</li>
          <li>Y（原創性）＝ 橘比例 + 0.5 × 綠比例，值域 0–1，象限分界固定 0.5</li>
          <li>
            <strong>X 是相對的</strong>：全班一起進步時圖上不會有橫向移動。
            絕對變化請用匯出檔裡的原始值。
          </li>
        </ul>

        <h3 className="mt-4 text-base font-semibold text-neutral-800">
          高階提問的判定
          <span className="font-mono text-sm font-normal text-neutral-500">
            {QUESTION_RULE_VERSION}
          </span>
        </h3>
        <p className="mt-1 text-sm text-neutral-600">
          確定性規則，不經 AI 分類——用 LLM 會讓數值隨模型版本漂移，別人重跑
          你的資料得不到同一張圖。一則訊息只要出現任一高階線索就計 1。
        </p>
        <QuestionRules />
      </section>

      {/* 四、人工編碼架構 */}
      <section className="break-inside-avoid">
        <h2 className="border-b border-neutral-300 pb-1 text-lg font-bold">
          四、人工編碼架構
          <span className="ml-3 font-mono text-sm font-normal text-neutral-500">
            {CURRENT_SCHEME_VERSION}
          </span>
        </h2>
        <p className="mt-2 text-sm text-neutral-600">
          編碼對象含對話全文與反思全文。兩位編碼者獨立編碼後計算 Cohen&rsquo;s κ。
        </p>
        {scheme.dimensions.map((dimension) => (
          <div key={dimension.id} className="mt-3">
            <h3 className="text-base font-semibold text-neutral-800">
              {dimension.label}
              <span className="ml-2 text-xs font-normal text-neutral-500">
                （看
                {dimension.material === "chat"
                  ? "對話"
                  : dimension.material === "reflection"
                    ? "反思"
                    : "全部"}
                ）
              </span>
            </h3>
            <ul className="mt-1 flex flex-col gap-1">
              {dimension.categories.map((category) => (
                <li key={category.id} className="rounded bg-neutral-50 px-3 py-2 text-sm">
                  <span className="font-medium text-neutral-900">{category.label}</span>
                  <span className="text-neutral-700">：{category.definition}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <footer className="border-t border-neutral-300 pt-4 text-sm text-neutral-600">
        <p>
          指導教授確認後，請在 CLAUDE.md §8 註記確認日期。各材料的逐字修改紀錄
          由 git 保存，論文附錄可直接引用對應的 commit。
        </p>
        <p className="mt-2 print:hidden">要列印給指導教授：按 Ctrl+P（Mac 為 ⌘+P）。</p>
      </footer>
    </main>
  );
}
