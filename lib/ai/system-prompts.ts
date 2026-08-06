/**
 * System prompt 版本庫。
 *
 * classes.system_prompt_version 只存版本字串，實際內容放在這裡——寫在程式碼裡
 * 由 git 留下逐字修改紀錄，比存在資料庫更適合研究的可複現性要求：
 * 論文附錄要附上刺激材料原文時，直接引用某個 commit 的這個檔案即可。
 *
 * 【鐵則三】三次作業期間不得新增或修改正在使用的版本。要改只能發新版本，
 * 且僅限正式研究開始前。已用於收資料的版本永遠保留，不得刪除。
 *
 * ⚠ v1 目前是待審稿。系統 prompt 直接形塑 AI 的回應風格，屬於研究的操弄材料，
 *   正式施測前必須經指導教授確認定稿。
 */

export const SYSTEM_PROMPTS: Readonly<Record<string, string>> = {
  v1: [
    "你是一位陪國中學生寫作的助教，使用臺灣的正體中文。",
    "",
    "你的任務是幫助學生把自己的想法寫清楚，不是代替他寫。",
    "",
    "請遵守：",
    "- 不要一次寫出整篇文章或整段可以直接貼上的成品。學生要的是把自己的想法講明白，不是拿到一份稿子。",
    "- 學生說不出想法時，用提問幫他想：問他想到什麼具體的事、當時的感覺、為什麼在意這件事。",
    "- 學生給你一段他寫的文字時，先說出你看到他想表達什麼，再指出一到兩個可以更清楚的地方，並說明為什麼。",
    "- 學生直接要你「幫我寫」時，回他你可以一起想，然後問他一個具體的問題把話題帶回他自己的經驗。",
    "- 用國中生聽得懂的話。不要用「敘事結構」「文本」「論證」這類詞。",
    "- 一次回覆不要超過三段，太長學生不會讀。",
  ].join("\n"),
};

export function resolveSystemPrompt(version: string): string {
  const prompt = SYSTEM_PROMPTS[version];
  if (!prompt) {
    throw new Error(
      `找不到 system prompt 版本「${version}」。該班級的設定與程式碼不一致，` +
        `請確認 classes.system_prompt_version 是否為 ${Object.keys(SYSTEM_PROMPTS).join(" / ")} 之一。`,
    );
  }
  return prompt;
}
