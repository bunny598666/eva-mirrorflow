/**
 * CSV 產生（RFC 4180）。
 *
 * 【為什麼不自己土法用逗號串起來】匯出的內容包含學生寫的文章與反思，
 * 裡面一定會有逗號、換行、引號。少跳脫一個字元，整份檔案在 SPSS／R 裡
 * 就會錯開一欄——而且錯得很安靜，讀進去的資料看起來還是像資料。
 */

export type CsvRow = readonly (string | number | null | undefined)[];

/**
 * null / undefined 輸出成**未加引號的空欄位**，其餘一律加引號。
 *
 * 這個差別在統計軟體裡是有意義的：R 的 read.csv 與 pandas 的 read_csv 把
 * 未加引號的空欄位讀成 NA，把 `""` 讀成長度為 0 的字串。
 *
 *   沒交件的場次 submitted_at → NA    （這件事沒有發生）
 *   學生把答案清空後送出       → ""    （他真的留了白）
 *
 * 兩者混為一談，缺失值分析就從第一步開始錯。所以：**沒有值用 null，
 * 空字串就寫空字串**，呼叫端不要用 `?? ""` 去填 null。
 */
function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // 一律加引號：欄位裡有沒有特殊字元不必逐一判斷，讀取端也不會有歧義。
  // 內部的引號以兩個引號跳脫（RFC 4180 §2.7）。
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(header: CsvRow, rows: readonly CsvRow[]): string {
  const lines = [header, ...rows].map((row) => row.map(cell).join(","));
  // CRLF 是 RFC 4180 指定的換行；Excel 與 R 都吃得下。
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * 加上 UTF-8 BOM。
 *
 * 沒有它，Excel 開啟含中文的 CSV 一定是亂碼——而這份資料的主要讀者
 * 就是會用 Excel 先掃一眼的研究者。R 與 Python 的 read_csv 都能自動略過 BOM。
 */
export function withBom(csv: string): string {
  return `﻿${csv}`;
}
