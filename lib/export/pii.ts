/**
 * PII 掃描。
 *
 * 【這支程式不能保證匯出檔沒有 PII，而且不該假裝可以】
 * 系統本身不存 PII（CLAUDE.md 鐵則二）：沒有姓名、Email、學號、IP。
 * 但**學生自己打的字**是自由文本——他可能在文章裡寫「我叫王小明」，
 * 或在反思裡打了自己的電話。那種東西沒有任何程式攔得住。
 *
 * 所以這裡做的是：把**機械上抓得到**的樣態掃出來、算出筆數、寫進 manifest，
 * 讓研究者知道有幾處需要人工過目。掃描結果是「要看哪裡」的線索，
 * 不是「已經乾淨了」的保證——manifest 裡也是這樣寫的。
 *
 * 純函式，可單元測試。
 */

export type PiiPattern = { id: string; label: string; regex: RegExp };

/**
 * 樣態清單。刻意保守（寧可少報也不要把正常內容標成 PII）——
 * 誤報太多的話研究者會直接略過整份報告，那就等於沒有掃描。
 */
export const PII_PATTERNS: readonly PiiPattern[] = [
  {
    id: "tw_id",
    label: "身分證字號",
    // 一個英文字母 + 1/2 + 八位數字。開頭與結尾用邊界避免夾在長字串中間誤判。
    regex: /\b[A-Za-z][12]\d{8}\b/g,
  },
  {
    id: "email",
    label: "Email",
    regex: /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/g,
  },
  {
    id: "tw_mobile",
    label: "手機號碼",
    regex: /\b09\d{2}[-\s]?\d{3}[-\s]?\d{3}\b/g,
  },
  {
    id: "long_digits",
    label: "連續 8 位以上數字（可能是學號）",
    // 前後不可接小數點：三色比例那種 0.3719008264462810 是機器算出來的數字，
    // 不是學號。實測時這一條在 metrics.csv 誤報了 27 次——誤報多到這種程度，
    // 研究者就會整份略過，等於沒有掃描。
    regex: /(?<![\d.])\d{8,}(?![\d.])/g,
  },
];

/**
 * 掃描的對象是**學生自己打的那些欄位**，不是整份 CSV。
 *
 * 一開始我掃整個檔案，結果誤報連連：先是 metrics.csv 裡的三色比例
 * （0.3719008264462810）被當成學號，擋掉小數之後，換成 uuid 裡的數字串
 * （…bf58-72788420d9ff）繼續誤報。根本原因是掃錯東西——session_id、
 * message_id、時間戳、token 數都是機器產生的，它們不可能含 PII。
 *
 * PII 只可能從一個地方進來：學生打的字。所以呼叫端只把那些欄位交進來。
 */

export type PiiFinding = {
  patternId: string;
  label: string;
  /** 命中次數。 */
  count: number;
  /** 出現在哪些檔案。 */
  files: string[];
  /** 前幾個樣本，遮蔽中段供人工判斷。 */
  samples: string[];
};

/** 只留頭尾，中間遮掉——manifest 會被存下來，不該把疑似 PII 原文寫進去。 */
export function mask(value: string): string {
  if (value.length <= 4) return "*".repeat(value.length);
  return `${value.slice(0, 2)}${"*".repeat(Math.max(1, value.length - 4))}${value.slice(-2)}`;
}

const MAX_SAMPLES = 3;

export function scanPii(
  files: readonly { name: string; content: string }[],
): PiiFinding[] {
  const findings = new Map<string, PiiFinding>();

  for (const file of files) {
    for (const pattern of PII_PATTERNS) {
      // regex 帶 g 旗標會保留 lastIndex，跨檔案重用同一個物件會漏掉開頭的命中。
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      const matches = file.content.match(regex);
      if (!matches || matches.length === 0) continue;

      const existing = findings.get(pattern.id) ?? {
        patternId: pattern.id,
        label: pattern.label,
        count: 0,
        files: [],
        samples: [],
      };
      existing.count += matches.length;
      if (!existing.files.includes(file.name)) existing.files.push(file.name);
      for (const match of matches) {
        if (existing.samples.length >= MAX_SAMPLES) break;
        const masked = mask(match);
        if (!existing.samples.includes(masked)) existing.samples.push(masked);
      }
      findings.set(pattern.id, existing);
    }
  }

  return [...findings.values()].sort((a, b) => b.count - a.count);
}
