/**
 * 人工編碼架構（版本庫）。
 *
 * 與 lib/ai/system-prompts.ts 同一套做法：架構寫在程式碼裡，由 git 留下逐字
 * 修改紀錄。論文附錄要附編碼手冊時，直接引用某個 commit 的這個檔案即可；
 * coder_annotations.scheme_version 只存版本字串。
 *
 * ⚠ **這一版尚未經指導教授確認。** 編碼架構是質性分析的量尺，正式編碼前
 *   必須與指導者逐條確認類目定義與範例，確認後才凍結。已用於正式編碼的
 *   版本永遠保留、不得修改——要調整只能發新版本，並重新計算信度。
 *
 * 【編碼對象含反思文本】這是本研究方向與方向一的差別：除了對話歷程，
 * 學生自己寫的反思也是分析材料（BUILD_PLAN §6 STEP 11）。
 */

export const CURRENT_SCHEME_VERSION = "scheme-v1";

export type CodeCategory = {
  id: string;
  label: string;
  /** 編碼者判斷時的依據。寫得夠具體，兩個人才可能編到一致。 */
  definition: string;
};

export type CodeDimension = {
  id: string;
  label: string;
  /** 這個向度看的是哪一份材料。 */
  material: "chat" | "reflection" | "both";
  categories: CodeCategory[];
};

export type CodingScheme = {
  version: string;
  dimensions: CodeDimension[];
};

const SCHEME_V1: CodingScheme = {
  version: CURRENT_SCHEME_VERSION,
  dimensions: [
    {
      id: "ai_use",
      label: "AI 使用模式",
      material: "chat",
      categories: [
        {
          id: "minimal",
          label: "幾乎未使用",
          definition: "全程沒有向 AI 提問，或只有一兩句無關寫作內容的試探。",
        },
        {
          id: "delegation",
          label: "委外",
          definition:
            "主要要求 AI 產出可直接使用的成品（整段、整篇、開頭結尾），拿到後未經實質修改即採用。",
        },
        {
          id: "refinement",
          label: "精修",
          definition:
            "要求 AI 產出後，自己動手改寫語句、調整內容再使用；對話仍以「要成品」為主。",
        },
        {
          id: "dialogue",
          label: "對話",
          definition:
            "以提問、追問、討論為主（問原因、比較做法、請 AI 評論自己寫的內容），文章主要由學生自己寫。",
        },
      ],
    },
    {
      id: "reflection_depth",
      label: "反思深度",
      material: "reflection",
      categories: [
        {
          id: "descriptive",
          label: "描述",
          definition: "只敘述做了什麼（「我貼了一段」「我改了幾個字」），沒有說明理由。",
        },
        {
          id: "explanatory",
          label: "解釋",
          definition: "說明了為什麼那樣做（「因為那句比較順」「因為我想不到怎麼開頭」）。",
        },
        {
          id: "critical",
          label: "批判",
          definition:
            "評估自己的選擇好不好、指出當時可以怎麼做更好，或看出自己的模式（「我發現我一卡住就去問 AI」）。",
        },
      ],
    },
    {
      id: "intention",
      label: "改變意圖的具體性",
      material: "reflection",
      categories: [
        {
          id: "none",
          label: "沒有意圖",
          definition: "沒有寫出下次想做的改變，或答非所問。",
        },
        {
          id: "vague",
          label: "籠統",
          definition: "有意圖但無法據以行動（「下次要更認真」「會少用一點 AI」）。",
        },
        {
          id: "specific",
          label: "具體",
          definition:
            "說得出可執行的做法與時機（「下次先自己寫完一段再問 AI 哪裡不清楚」）。",
        },
      ],
    },
  ],
};

const SCHEMES: Readonly<Record<string, CodingScheme>> = {
  [CURRENT_SCHEME_VERSION]: SCHEME_V1,
};

export function getScheme(version: string = CURRENT_SCHEME_VERSION): CodingScheme {
  const scheme = SCHEMES[version];
  if (!scheme) throw new Error(`未知的編碼架構版本：${version}`);
  return scheme;
}

export function listSchemeVersions(): string[] {
  return Object.keys(SCHEMES);
}

/** 一位編碼者對一個場次的判定：向度 id → 類目 id。 */
export type CodeAssignment = Record<string, string>;

/** 每個向度都要選，才算編完。 */
export function isComplete(scheme: CodingScheme, codes: CodeAssignment): boolean {
  return scheme.dimensions.every((dimension) => {
    const chosen = codes[dimension.id];
    return Boolean(chosen) && dimension.categories.some((c) => c.id === chosen);
  });
}

/** 濾掉不屬於這個架構的鍵值，避免髒資料進資料庫。 */
export function sanitize(scheme: CodingScheme, codes: unknown): CodeAssignment {
  const clean: CodeAssignment = {};
  if (typeof codes !== "object" || codes === null) return clean;
  const raw = codes as Record<string, unknown>;
  for (const dimension of scheme.dimensions) {
    const value = raw[dimension.id];
    if (typeof value !== "string") continue;
    if (dimension.categories.some((c) => c.id === value)) clean[dimension.id] = value;
  }
  return clean;
}
