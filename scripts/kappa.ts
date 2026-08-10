/**
 * kappa.ts —— 兩位編碼者的 Cohen's κ 與分歧清單
 *
 *   npm run kappa -- --a R-01 --b R-02
 *   npm run kappa -- --a R-01 --b R-02 --scheme scheme-v1 --csv 分歧.csv
 *
 * 不帶 --a / --b 時列出資料庫裡有編碼的人，讓你知道能比誰跟誰。
 *
 * 【只算兩人都編過的場次】一個人編了、另一個還沒編，那不是不一致，
 * 是還沒編完。把它算進去會低估信度。
 */
import { writeFileSync } from "node:fs";
import { Client } from "pg";
import { buildReport, interpret } from "../lib/coding/kappa.ts";
import { CURRENT_SCHEME_VERSION, getScheme } from "../lib/coding/scheme.ts";

const GREEN = "[32m";
const RED = "[31m";
const DIM = "[2m";
const BOLD = "[1m";
const OFF = "[0m";

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

type Row = { session_id: string; coder_code: string; codes: Record<string, string> };

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("缺少 DATABASE_URL（.env.local）。");
    process.exit(1);
  }

  const schemeVersion = arg("scheme") ?? CURRENT_SCHEME_VERSION;
  const scheme = getScheme(schemeVersion);
  const coderA = arg("a");
  const coderB = arg("b");

  const db = new Client({ connectionString });
  await db.connect();

  try {
    const all = await db.query<Row>(
      "select session_id, coder_code, codes from coder_annotations where scheme_version = $1",
      [schemeVersion],
    );

    if (all.rowCount === 0) {
      console.log(`架構 ${schemeVersion} 底下還沒有任何編碼。`);
      return;
    }

    const byCoder = new Map<string, Row[]>();
    for (const row of all.rows) {
      const list = byCoder.get(row.coder_code) ?? [];
      list.push(row);
      byCoder.set(row.coder_code, list);
    }

    if (!coderA || !coderB) {
      console.log(`架構 ${schemeVersion} 目前有編碼的人：`);
      for (const [coder, rows] of [...byCoder].sort()) {
        console.log(`  ${coder}　${rows.length} 個場次`);
      }
      console.log("\n用法：npm run kappa -- --a <編碼者A> --b <編碼者B>");
      return;
    }

    const rowsA = byCoder.get(coderA) ?? [];
    const rowsB = byCoder.get(coderB) ?? [];
    if (rowsA.length === 0) throw new Error(`${coderA} 在這個架構底下沒有任何編碼。`);
    if (rowsB.length === 0) throw new Error(`${coderB} 在這個架構底下沒有任何編碼。`);

    const report = buildReport(
      coderA,
      coderB,
      scheme.dimensions.map((d) => d.id),
      rowsA.map((r) => ({ unitId: r.session_id, codes: r.codes })),
      rowsB.map((r) => ({ unitId: r.session_id, codes: r.codes })),
    );

    // 代號比 uuid 好讀太多，分歧清單要拿去跟編碼者討論。
    const labels = await loadSessionLabels(db, [
      ...new Set(report.dimensions.flatMap((d) => d.disagreements.map((x) => x.unitId))),
    ]);

    console.log(`\n${BOLD}Cohen's κ${OFF}　${coderA} × ${coderB}　架構 ${schemeVersion}`);
    console.log(
      `${DIM}${coderA} 編了 ${rowsA.length} 個場次，${coderB} 編了 ${rowsB.length} 個，兩人都編過的有 ${report.sharedUnits} 個${OFF}`,
    );
    console.log("─".repeat(64));

    for (const dimension of report.dimensions) {
      const meta = scheme.dimensions.find((d) => d.id === dimension.dimensionId);
      const kappaText =
        dimension.kappa === null ? "—" : dimension.kappa.toFixed(3).padStart(6);
      const color =
        dimension.kappa === null ? DIM : dimension.kappa >= 0.6 ? GREEN : RED;
      console.log(
        `${color}κ = ${kappaText}${OFF}  ${meta?.label ?? dimension.dimensionId}` +
          `${DIM}　n=${dimension.n}　一致 ${dimension.agreed}/${dimension.n}` +
          `　Po=${dimension.po.toFixed(3)}　Pe=${dimension.pe.toFixed(3)}` +
          `　${interpret(dimension.kappa)}${OFF}`,
      );
      if (dimension.kappa === null && dimension.n > 0) {
        console.log(
          `${DIM}       （兩人都只用了同一個類目，沒有變異，κ 在數學上未定義）${OFF}`,
        );
      }
    }

    console.log("─".repeat(64));
    console.log(
      report.meanKappa === null
        ? "各向度平均 κ：無法計算"
        : `各向度平均 κ：${report.meanKappa.toFixed(3)}（${interpret(report.meanKappa)}）`,
    );

    // ── 分歧清單 ──
    const rows: string[][] = [];
    console.log(`\n${BOLD}分歧清單${OFF}`);
    let total = 0;
    for (const dimension of report.dimensions) {
      if (dimension.disagreements.length === 0) continue;
      const meta = scheme.dimensions.find((d) => d.id === dimension.dimensionId);
      console.log(`\n  ${meta?.label ?? dimension.dimensionId}`);
      for (const item of dimension.disagreements) {
        total += 1;
        const label = labels.get(item.unitId) ?? item.unitId;
        const nameOf = (id: string): string =>
          meta?.categories.find((c) => c.id === id)?.label ?? id;
        console.log(
          `    ${label}　${coderA}: ${nameOf(item.a)}　→　${coderB}: ${nameOf(item.b)}`,
        );
        rows.push([
          item.unitId,
          label,
          item.dimensionId,
          meta?.label ?? "",
          item.a,
          nameOf(item.a),
          item.b,
          nameOf(item.b),
        ]);
      }
    }
    if (total === 0) console.log("  沒有分歧。");
    else console.log(`\n  共 ${total} 處分歧。`);

    const csvPath = arg("csv");
    if (csvPath) {
      const header = [
        "session_id",
        "label",
        "dimension_id",
        "dimension",
        `${coderA}_code`,
        `${coderA}_label`,
        `${coderB}_code`,
        `${coderB}_label`,
      ];
      const csv = [header, ...rows]
        .map((line) => line.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
        .join("\n");
      // BOM：Excel 開啟 UTF-8 CSV 沒有它會變亂碼，而分歧清單一定會拿去跟人討論。
      writeFileSync(csvPath, `﻿${csv}`, "utf8");
      console.log(`\n分歧清單已寫入 ${csvPath}`);
    }
  } finally {
    await db.end();
  }
}

async function loadSessionLabels(
  db: Client,
  sessionIds: readonly string[],
): Promise<Map<string, string>> {
  if (sessionIds.length === 0) return new Map();
  const result = await db.query<{ id: string; code: string; order_no: number }>(
    `select s.id, p.code, a.order_no
       from sessions s
       join participants p on p.id = s.participant_id
       join assignments a on a.id = s.assignment_id
      where s.id = any($1)`,
    [[...sessionIds]],
  );
  return new Map(result.rows.map((r) => [r.id, `${r.code} 第${r.order_no}次`]));
}

main().catch((err: unknown) => {
  console.error(`${RED}${err instanceof Error ? err.message : String(err)}${OFF}`);
  process.exit(1);
});
