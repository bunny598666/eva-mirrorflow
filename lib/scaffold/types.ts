/**
 * 鷹架按鈕。存在 assignments.scaffold_buttons（jsonb）。
 *
 * 本系統的鷹架**全程開啟**，不是實驗變項而是常備支持（CLAUDE.md §4.6）；
 * scaffold_click 事件與 chat_messages.scaffold_id 照常記錄，供論文附屬分析使用。
 */
export type ScaffoldButton = {
  id: string;
  label: string;
  template: string;
};

export function parseScaffoldButtons(value: unknown): ScaffoldButton[] {
  if (!Array.isArray(value)) return [];
  const out: ScaffoldButton[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const b = raw as Record<string, unknown>;
    const id = typeof b.id === "string" ? b.id.trim() : "";
    const label = typeof b.label === "string" ? b.label.trim() : "";
    const template = typeof b.template === "string" ? b.template.trim() : "";
    if (!id || !label || !template || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label, template });
  }
  return out;
}
