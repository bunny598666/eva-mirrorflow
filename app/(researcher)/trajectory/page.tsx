// ★三期軌跡圖：四象限散佈圖 + 同人三期連線帶箭頭 + 出版級 SVG 匯出（STEP 10）
import { requireRole } from "@/lib/auth/session";
import { loadTrajectories } from "@/lib/metrics/queries";
import { METRICS_VERSION } from "@/lib/metrics/quadrant";
import { QUESTION_RULE_VERSION } from "@/lib/metrics/questions";
import TrajectoryChart from "./TrajectoryChart";

export default async function TrajectoryPage() {
  await requireRole("researcher");
  const trajectories = await loadTrajectories();

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-5 p-6">
      <header>
        <h1 className="text-2xl font-bold">三期軌跡圖</h1>
        <p className="mt-1 text-neutral-600">
          每位學生三期的象限座標連成帶箭頭的折線。點形狀區分期別：○ 第 1 次、
          △ 第 2 次、□ 第 3 次。
        </p>
      </header>

      <TrajectoryChart trajectories={trajectories} />

      {/*
        這段警語是給讀圖的人看的，不是裝飾。X 軸是 z 分數，全班一起進步時
        每個人的相對位置幾乎不動，圖上會看不出來——不寫清楚就會誤讀成
        「介入沒有效果」。
      */}
      <section className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
        <h2 className="font-semibold text-neutral-800">讀圖須知</h2>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
          <li>
            <strong>X 軸是相對的。</strong>三個成分都以「該期全班」為基準取 z
            分數，量的是在這個班裡的相對位置。全班一起變好時，圖上不會有橫向移動——
            要看絕對變化請用逐人數值表裡的輪次／平均字數／高階提問原始值。
          </li>
          <li>
            <strong>Y 軸是絕對的</strong>（橘 + 0.5 × 綠），0–1，分界固定在 0.50，
            所以縱向移動可以跨期直接比較。
          </li>
          <li>
            期中查看時座標仍會變動：全班交完之前，z 分數的基準還在移動。
            表格的「基準人數」欄顯示每一筆是幾個人算出來的。
          </li>
          <li>
            演算法版本 <code>{METRICS_VERSION}</code>、高階提問規則{" "}
            <code>{QUESTION_RULE_VERSION}</code>。三期之間不得變動。
          </li>
        </ul>
      </section>
    </main>
  );
}
