/**
 * 去識別化匯出：組裝七個檔案。
 *
 * 【只出 participant code，不出 participant_id】
 * code（S-07）本身就是研究用的假名，那是設計好要出現在資料裡的。
 * participants.id 是內部主鍵，帶出去只會多一組可以回連資料庫的鍵，
 * 對分析毫無幫助。session_id 則保留——七個檔案要靠它 join，
 * 而它是隨機 uuid，不含任何個人資訊。
 *
 * 【pin_hash 永遠不查】不是「不輸出」，是連 select 都不寫。
 */
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { toCsv, withBom, type CsvRow } from "./csv";
import { scanPii, type PiiFinding } from "./pii";
import { dnaThresholds } from "@/lib/dna/config";
import { DNA_ALGORITHM_VERSION } from "@/lib/dna/service";
import { METRICS_VERSION } from "@/lib/metrics/quadrant";
import { QUESTION_RULE_VERSION } from "@/lib/metrics/questions";
import { CURRENT_SCHEME_VERSION } from "@/lib/coding/scheme";
import type { DnaResult } from "@/lib/dna/attribute";

export type ExportFile = { name: string; content: string };

export type ExportManifest = {
  exported_at: string;
  exported_by: string;
  /** 產生這批資料的研究參數。三期凍結，寫進來供日後查核。 */
  parameters: {
    dna_theta: { high: number; low: number };
    dna_algorithm_version: string;
    metrics_version: string;
    question_rule_version: string;
    coding_scheme_version: string;
    models: { class_label: string; model: string; temperature: number; system_prompt_version: string }[];
    reflection_prompt_versions: string[];
  };
  /** 每個檔案的資料列數（不含表頭）。與資料庫的 count 對得起來。 */
  counts: Record<string, number>;
  /** 資料庫端的計數，用來與 counts 對照。 */
  db_counts: Record<string, number>;
  pii_scan: {
    note: string;
    findings: PiiFinding[];
  };
};

type SessionRow = {
  id: string;
  participant_id: string;
  assignment_id: string;
  started_at: string;
  submitted_at: string | null;
  status: string;
};

type Context = {
  sessions: SessionRow[];
  codeOf: Map<string, string>;
  orderOf: Map<string, number>;
  titleOf: Map<string, string>;
};

/** 每個場次共用的前四欄，七個檔案都一樣，方便 join。 */
function keyColumns(context: Context, session: SessionRow): (string | number)[] {
  return [
    session.id,
    context.codeOf.get(session.participant_id) ?? "?",
    context.orderOf.get(session.assignment_id) ?? 0,
    context.titleOf.get(session.assignment_id) ?? "",
  ];
}

const KEY_HEADER = ["session_id", "participant_code", "order_no", "assignment_title"] as const;

export async function buildExport(researcherCode: string, now: Date): Promise<{
  files: ExportFile[];
  manifest: ExportManifest;
}> {
  const db = supabaseAdmin();
  const context = await loadContext();

  const [events, chat, dna, quadrant, reflections, metrics] = await Promise.all([
    buildEvents(context),
    buildChat(context),
    buildDna(context),
    buildQuadrant(context),
    buildReflections(context),
    buildMetrics(context),
  ]);

  const dataFiles: ExportFile[] = [
    { name: "events.csv", content: withBom(events.csv) },
    { name: "chat.csv", content: withBom(chat.csv) },
    { name: "dna.json", content: dna.json },
    { name: "quadrant.csv", content: withBom(quadrant.csv) },
    { name: "reflections.csv", content: withBom(reflections.csv) },
    { name: "metrics.csv", content: withBom(metrics.csv) },
  ];

  const counts: Record<string, number> = {
    "events.csv": events.count,
    "chat.csv": chat.count,
    "dna.json": dna.count,
    "quadrant.csv": quadrant.count,
    "reflections.csv": reflections.count,
    "metrics.csv": metrics.count,
  };

  // 與資料庫直接 count 對照。兩邊不一致就是匯出漏了東西——
  // 這正是驗收條件「manifest 與 DB count 一致」要抓的。
  const dbCounts = await loadDbCounts();

  const manifest: ExportManifest = {
    exported_at: now.toISOString(),
    exported_by: researcherCode,
    parameters: {
      dna_theta: dnaThresholds(),
      dna_algorithm_version: DNA_ALGORITHM_VERSION,
      metrics_version: METRICS_VERSION,
      question_rule_version: QUESTION_RULE_VERSION,
      coding_scheme_version: CURRENT_SCHEME_VERSION,
      models: await loadClassParameters(),
      reflection_prompt_versions: await loadUsedPromptVersions(),
    },
    counts,
    db_counts: dbCounts,
    pii_scan: {
      note:
        "本掃描只找得到機械樣態（身分證字號、Email、手機、長數字）。" +
        "學生在文章或反思裡自己打的姓名、綽號、學校名稱一律掃不出來——" +
        "釋出資料前務必人工通讀 chat.csv 與 reflections.csv。",
      // 只掃學生自己打的欄位。掃整份 CSV 的話，uuid 裡的數字串與三色比例的
      // 小數都會被當成學號誤報——實測時先後踩到這兩種，誤報多到報告失去意義。
      findings: scanPii([
        { name: "chat.csv（學生訊息）", content: chat.freeText.join("\n") },
        { name: "reflections.csv（反思答案）", content: reflections.freeText.join("\n") },
      ]),
    },
  };

  void db; // 上面各 build* 各自取用連線

  return {
    files: [
      ...dataFiles,
      { name: "manifest.json", content: `${JSON.stringify(manifest, null, 2)}\n` },
    ],
    manifest,
  };
}

async function loadContext(): Promise<Context> {
  const db = supabaseAdmin();

  const { data: sessions, error } = await db
    .from("sessions")
    .select("id, participant_id, assignment_id, started_at, submitted_at, status")
    .order("started_at", { ascending: true });
  if (error) throw new Error(error.message);

  // 刻意不 select pin_hash。它不該離開資料庫，連讀出來放在記憶體都不必。
  const { data: participants, error: pErr } = await db
    .from("participants")
    .select("id, code");
  if (pErr) throw new Error(pErr.message);

  const { data: assignments, error: aErr } = await db
    .from("assignments")
    .select("id, title, order_no");
  if (aErr) throw new Error(aErr.message);

  return {
    sessions: (sessions ?? []) as SessionRow[],
    codeOf: new Map(
      ((participants ?? []) as { id: string; code: string }[]).map((r) => [r.id, r.code]),
    ),
    orderOf: new Map(
      ((assignments ?? []) as { id: string; order_no: number }[]).map((r) => [r.id, r.order_no]),
    ),
    titleOf: new Map(
      ((assignments ?? []) as { id: string; title: string }[]).map((r) => [r.id, r.title]),
    ),
  };
}

async function buildEvents(context: Context): Promise<{ csv: string; count: number }> {
  const { data, error } = await supabaseAdmin()
    .from("events")
    .select("session_id, client_seq, type, payload, ts")
    .order("session_id", { ascending: true })
    .order("client_seq", { ascending: true });
  if (error) throw new Error(error.message);

  const bySession = new Map(context.sessions.map((s) => [s.id, s]));
  const rows: CsvRow[] = [];
  for (const row of (data ?? []) as {
    session_id: string;
    client_seq: number;
    type: string;
    payload: unknown;
    ts: string;
  }[]) {
    const session = bySession.get(row.session_id);
    if (!session) continue;
    rows.push([
      ...keyColumns(context, session),
      row.client_seq,
      row.type,
      row.ts,
      JSON.stringify(row.payload),
    ]);
  }

  return {
    csv: toCsv([...KEY_HEADER, "client_seq", "type", "ts", "payload_json"], rows),
    count: rows.length,
  };
}

async function buildChat(
  context: Context,
): Promise<{ csv: string; count: number; freeText: string[] }> {
  const { data, error } = await supabaseAdmin()
    .from("chat_messages")
    .select("id, session_id, role, content, scaffold_id, input_tokens, output_tokens, ts")
    .order("session_id", { ascending: true })
    .order("ts", { ascending: true });
  if (error) throw new Error(error.message);

  const bySession = new Map(context.sessions.map((s) => [s.id, s]));
  const rows: CsvRow[] = [];
  const freeText: string[] = [];
  const seenPerSession = new Map<string, number>();

  for (const row of (data ?? []) as {
    id: string;
    session_id: string;
    role: string;
    content: string;
    scaffold_id: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
    ts: string;
  }[]) {
    const session = bySession.get(row.session_id);
    if (!session) continue;
    const index = (seenPerSession.get(row.session_id) ?? 0) + 1;
    seenPerSession.set(row.session_id, index);
    // 只有學生打的字可能含 PII。AI 的回覆是模型產生的，不會有學生的個資。
    if (row.role === "user") freeText.push(row.content);
    rows.push([
      ...keyColumns(context, session),
      row.id,
      index,
      row.role,
      row.content,
      row.scaffold_id,
      row.input_tokens,
      row.output_tokens,
      row.ts,
    ]);
  }

  return {
    csv: toCsv(
      [
        ...KEY_HEADER,
        "message_id",
        "message_index",
        "role",
        "content",
        "scaffold_id",
        "input_tokens",
        "output_tokens",
        "ts",
      ],
      rows,
    ),
    count: rows.length,
    freeText,
  };
}

async function buildDna(context: Context): Promise<{ json: string; count: number }> {
  const { data, error } = await supabaseAdmin()
    .from("analyses")
    .select("session_id, result, rubric_version, analyzed_at")
    .eq("kind", "dna");
  if (error) throw new Error(error.message);

  const bySession = new Map(context.sessions.map((s) => [s.id, s]));
  const records = [];
  for (const row of (data ?? []) as {
    session_id: string;
    result: DnaResult;
    rubric_version: string | null;
    analyzed_at: string;
  }[]) {
    const session = bySession.get(row.session_id);
    if (!session) continue;
    records.push({
      session_id: row.session_id,
      participant_code: context.codeOf.get(session.participant_id) ?? "?",
      order_no: context.orderOf.get(session.assignment_id) ?? 0,
      assignment_title: context.titleOf.get(session.assignment_id) ?? "",
      algorithm_version: row.rubric_version,
      analyzed_at: row.analyzed_at,
      ...row.result,
    });
  }

  records.sort(
    (a, b) => a.participant_code.localeCompare(b.participant_code) || a.order_no - b.order_no,
  );

  return { json: `${JSON.stringify(records, null, 2)}\n`, count: records.length };
}

async function buildQuadrant(context: Context): Promise<{ csv: string; count: number }> {
  const { data, error } = await supabaseAdmin()
    .from("analyses")
    .select("session_id, result, rubric_version, analyzed_at")
    .eq("kind", "quadrant");
  if (error) throw new Error(error.message);

  const bySession = new Map(context.sessions.map((s) => [s.id, s]));
  const rows: CsvRow[] = [];
  for (const row of (data ?? []) as {
    session_id: string;
    result: Record<string, unknown>;
    rubric_version: string | null;
    analyzed_at: string;
  }[]) {
    const session = bySession.get(row.session_id);
    if (!session) continue;
    const z = (row.result.z ?? {}) as Record<string, number>;
    const raw = (row.result.raw ?? {}) as Record<string, number>;
    rows.push([
      ...keyColumns(context, session),
      num(row.result.x),
      num(row.result.y),
      str(row.result.quadrant),
      num(z.turns),
      num(z.promptChars),
      num(z.highOrder),
      num(raw.turns),
      num(raw.promptChars),
      num(raw.highOrder),
      num(raw.orangeRatio),
      num(raw.greenRatio),
      num(row.result.cohort_n),
      row.rubric_version,
      row.analyzed_at,
    ]);
  }

  rows.sort((a, b) => String(a[1]).localeCompare(String(b[1])) || Number(a[2]) - Number(b[2]));

  return {
    csv: toCsv(
      [
        ...KEY_HEADER,
        "x_interaction_depth",
        "y_originality",
        "quadrant",
        "z_turns",
        "z_prompt_chars",
        "z_high_order",
        "raw_turns",
        "raw_prompt_chars",
        "raw_high_order",
        "raw_orange_ratio",
        "raw_green_ratio",
        "cohort_n",
        "metrics_version",
        "analyzed_at",
      ],
      rows,
    ),
    count: rows.length,
  };
}

/**
 * 反思走長格式（一題一列）而不是寬格式。
 * 質性編碼與統計軟體都比較好處理，題數改變時欄位也不必跟著變。
 */
async function buildReflections(
  context: Context,
): Promise<{ csv: string; count: number; freeText: string[] }> {
  const db = supabaseAdmin();

  const { data, error } = await db
    .from("reflections")
    .select("session_id, prompt_version, answers, viewed_dna_at, viewed_replay_at, ts");
  if (error) throw new Error(error.message);

  const { data: prompts, error: pErr } = await db
    .from("reflection_prompts")
    .select("version, questions");
  if (pErr) throw new Error(pErr.message);

  const questionText = new Map<string, string>();
  for (const prompt of (prompts ?? []) as {
    version: string;
    questions: { id: string; text: string }[];
  }[]) {
    for (const question of prompt.questions ?? []) {
      questionText.set(`${prompt.version}::${question.id}`, question.text);
    }
  }

  const bySession = new Map(context.sessions.map((s) => [s.id, s]));
  const rows: CsvRow[] = [];
  const freeText: string[] = [];
  for (const row of (data ?? []) as {
    session_id: string;
    prompt_version: string;
    answers: { question_id: string; text: string }[];
    viewed_dna_at: string;
    viewed_replay_at: string | null;
    ts: string;
  }[]) {
    const session = bySession.get(row.session_id);
    if (!session) continue;
    (row.answers ?? []).forEach((answer, index) => {
      freeText.push(answer.text);
      rows.push([
        ...keyColumns(context, session),
        row.prompt_version,
        index + 1,
        answer.question_id,
        questionText.get(`${row.prompt_version}::${answer.question_id}`) ?? "",
        answer.text,
        Array.from(answer.text.trim()).length,
        row.viewed_dna_at,
        row.viewed_replay_at,
        row.ts,
      ]);
    });
  }

  rows.sort(
    (a, b) =>
      String(a[1]).localeCompare(String(b[1])) ||
      Number(a[2]) - Number(b[2]) ||
      Number(a[5]) - Number(b[5]),
  );

  return {
    csv: toCsv(
      [
        ...KEY_HEADER,
        "prompt_version",
        "question_index",
        "question_id",
        "question_text",
        "answer",
        "answer_chars",
        "viewed_dna_at",
        "viewed_replay_at",
        "submitted_ts",
      ],
      rows,
    ),
    count: rows.length,
    freeText,
  };
}

/** 每個場次一列的彙總，直接餵給統計軟體。 */
async function buildMetrics(context: Context): Promise<{ csv: string; count: number }> {
  const db = supabaseAdmin();

  const { data: analyses, error } = await db
    .from("analyses")
    .select("session_id, kind, result")
    .in("kind", ["dna", "quadrant"]);
  if (error) throw new Error(error.message);

  const dnaOf = new Map<string, DnaResult>();
  const quadrantOf = new Map<string, Record<string, unknown>>();
  for (const row of (analyses ?? []) as {
    session_id: string;
    kind: string;
    result: Record<string, unknown>;
  }[]) {
    if (row.kind === "dna") dnaOf.set(row.session_id, row.result as unknown as DnaResult);
    else quadrantOf.set(row.session_id, row.result);
  }

  const { data: counts, error: cErr } = await db
    .from("events")
    .select("session_id, type");
  if (cErr) throw new Error(cErr.message);

  const eventCounts = new Map<string, Map<string, number>>();
  for (const row of (counts ?? []) as { session_id: string; type: string }[]) {
    const perSession = eventCounts.get(row.session_id) ?? new Map<string, number>();
    perSession.set(row.type, (perSession.get(row.type) ?? 0) + 1);
    eventCounts.set(row.session_id, perSession);
  }

  const { data: reflections, error: rErr } = await db
    .from("reflections")
    .select("session_id, answers");
  if (rErr) throw new Error(rErr.message);

  const reflectionChars = new Map<string, number>();
  for (const row of (reflections ?? []) as {
    session_id: string;
    answers: { text: string }[];
  }[]) {
    const total = (row.answers ?? []).reduce(
      (sum, answer) => sum + Array.from(answer.text.trim()).length,
      0,
    );
    reflectionChars.set(row.session_id, total);
  }

  const rows: CsvRow[] = [];
  for (const session of context.sessions) {
    const dna = dnaOf.get(session.id);
    const quadrant = quadrantOf.get(session.id);
    const events = eventCounts.get(session.id) ?? new Map<string, number>();
    const raw = (quadrant?.raw ?? {}) as Record<string, number>;

    rows.push([
      ...keyColumns(context, session),
      session.status,
      session.started_at,
      session.submitted_at,
      dna?.textLength ?? null,
      num(dna?.ratios?.blue),
      num(dna?.ratios?.green),
      num(dna?.ratios?.orange),
      dna?.originCounts?.ai ?? null,
      dna?.originCounts?.external ?? null,
      dna?.originCounts?.typed ?? null,
      num(quadrant?.x),
      num(quadrant?.y),
      str(quadrant?.quadrant),
      raw.turns ?? null,
      num(raw.promptChars),
      raw.highOrder ?? null,
      events.get("chat_send") ?? 0,
      events.get("paste") ?? 0,
      events.get("copy") ?? 0,
      events.get("delete_block") ?? 0,
      events.get("scaffold_click") ?? 0,
      events.get("idle") ?? 0,
      events.get("mirror_view") ?? 0,
      events.get("recap_view") ?? 0,
      reflectionChars.get(session.id) ?? null,
    ]);
  }

  rows.sort((a, b) => String(a[1]).localeCompare(String(b[1])) || Number(a[2]) - Number(b[2]));

  return {
    csv: toCsv(
      [
        ...KEY_HEADER,
        "status",
        "started_at",
        "submitted_at",
        "text_length",
        "dna_blue_ratio",
        "dna_green_ratio",
        "dna_orange_ratio",
        "chars_from_ai",
        "chars_from_external",
        "chars_typed",
        "x_interaction_depth",
        "y_originality",
        "quadrant",
        "chat_turns",
        "mean_prompt_chars",
        "high_order_questions",
        "n_chat_send",
        "n_paste",
        "n_copy",
        "n_delete_block",
        "n_scaffold_click",
        "n_idle",
        "n_mirror_view",
        "n_recap_view",
        "reflection_total_chars",
      ],
      rows,
    ),
    count: rows.length,
  };
}

/**
 * 數值欄位。算不出來的回 null 而不是空字串——見 lib/export/csv.ts 的說明：
 * null 在 R／pandas 讀成 NA，"" 讀成長度 0 的字串，兩者在缺失值分析裡不同。
 */
function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function loadDbCounts(): Promise<Record<string, number>> {
  const db = supabaseAdmin();
  const tables = [
    "events",
    "chat_messages",
    "reflections",
    "sessions",
    "snapshots",
    "analyses",
  ] as const;

  const entries = await Promise.all(
    tables.map(async (table) => {
      const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
      if (error) throw new Error(error.message);
      return [table, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries);
}

async function loadClassParameters(): Promise<
  { class_label: string; model: string; temperature: number; system_prompt_version: string }[]
> {
  const { data, error } = await supabaseAdmin()
    .from("classes")
    .select("label, model, temperature, system_prompt_version")
    .order("label");
  if (error) throw new Error(error.message);
  return ((data ?? []) as {
    label: string;
    model: string;
    temperature: number;
    system_prompt_version: string;
  }[]).map((row) => ({
    class_label: row.label,
    model: row.model,
    temperature: Number(row.temperature),
    system_prompt_version: row.system_prompt_version,
  }));
}

async function loadUsedPromptVersions(): Promise<string[]> {
  const { data, error } = await supabaseAdmin()
    .from("reflections")
    .select("prompt_version");
  if (error) throw new Error(error.message);
  return [
    ...new Set(((data ?? []) as { prompt_version: string }[]).map((r) => r.prompt_version)),
  ].sort();
}
