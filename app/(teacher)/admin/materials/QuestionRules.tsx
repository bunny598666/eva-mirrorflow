/**
 * 高階提問的用語清單。
 *
 * 從 lib/metrics/questions.ts 取出實際生效的樣態，攤開給指導教授看——
 * 這是本研究少數「規則寫死在程式碼裡」的測量，不攤開來就沒人審得動。
 */
import {
  COMPARE,
  CRITIQUE,
  GENERATION_ONLY,
  HOW,
  PROBE,
  WHY,
} from "@/lib/metrics/questions";

const GROUPS: { label: string; patterns: readonly string[]; counts: boolean }[] = [
  { label: "要求解釋原因", patterns: WHY, counts: true },
  { label: "要求比較、區辨", patterns: COMPARE, counts: true },
  { label: "要求評價自己寫的東西", patterns: CRITIQUE, counts: true },
  { label: "要求方法而非成品", patterns: HOW, counts: true },
  { label: "追問、深化", patterns: PROBE, counts: true },
  { label: "純代寫要求（不計入）", patterns: GENERATION_ONLY, counts: false },
];

export default function QuestionRules() {
  return (
    <div className="mt-2 flex flex-col gap-2">
      {GROUPS.map((group) => (
        <div
          key={group.label}
          className={`rounded-lg px-3 py-2 text-sm ${
            group.counts ? "bg-neutral-50" : "bg-orange-50"
          }`}
        >
          <p className="font-medium text-neutral-900">
            {group.counts ? "✓" : "✗"} {group.label}
          </p>
          <p className="mt-1 font-mono text-xs leading-relaxed text-neutral-700">
            {group.patterns.join("、")}
          </p>
        </div>
      ))}
    </div>
  );
}
