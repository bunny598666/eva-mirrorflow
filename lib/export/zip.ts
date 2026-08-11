/**
 * 最小 ZIP 產生器。
 *
 * 【為什麼自己寫】CLAUDE.md §7 禁止清單外的依賴。壓縮本身用 Node 內建的
 * node:zlib（deflateRaw），這裡只負責把 ZIP 的檔頭與目錄組出來——大約一百行，
 * 而且是規格明確的二進位格式，驗得到。
 *
 * 【為什麼要打包成一個檔】匯出的七個檔案必須一起走。manifest.json 記的是
 * 「這批資料有幾列、用哪組 θ 算的」——它跟資料分家的那一刻，那些數字就
 * 不再能證明任何事。研究資料的可稽核性靠的就是這種綁定。
 *
 * 實作的是 ZIP 的基本子集：單一磁碟、無加密、無 ZIP64。
 * 匯出規模（一個班三期）遠低於 4GB 與 65535 個檔案的上限。
 */
import { deflateRawSync } from "node:zlib";

export type ZipEntry = { name: string; content: string };

/** CRC-32（IEEE 802.3）。ZIP 每個檔案都要帶，讀取端用它驗完整性。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS 時間格式（ZIP 沿用至今）。秒數只有 2 秒精度，這是格式本身的限制。 */
function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2));
  const day =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: day };
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function u32(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

const SIGNATURE = {
  local: 0x04034b50,
  central: 0x02014b50,
  end: 0x06054b50,
};

/** 語言編碼旗標（bit 11）：告訴讀取端檔名是 UTF-8。 */
const FLAG_UTF8 = 0x0800;
const METHOD_DEFLATE = 8;

export function createZip(entries: readonly ZipEntry[], now: Date): Uint8Array {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(now);

  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const raw = encoder.encode(entry.content);
    const compressed = new Uint8Array(deflateRawSync(raw));
    const crc = crc32(raw);

    const localHeader = concat([
      u32(SIGNATURE.local),
      u16(20), // 解壓所需版本 2.0
      u16(FLAG_UTF8),
      u16(METHOD_DEFLATE),
      u16(time),
      u16(date),
      u32(crc),
      u32(compressed.length),
      u32(raw.length),
      u16(nameBytes.length),
      u16(0), // extra field 長度
      nameBytes,
    ]);

    localChunks.push(localHeader, compressed);

    centralChunks.push(
      concat([
        u32(SIGNATURE.central),
        u16(20), // 建立者版本
        u16(20), // 解壓所需版本
        u16(FLAG_UTF8),
        u16(METHOD_DEFLATE),
        u16(time),
        u16(date),
        u32(crc),
        u32(compressed.length),
        u32(raw.length),
        u16(nameBytes.length),
        u16(0), // extra
        u16(0), // 註解長度
        u16(0), // 磁碟編號
        u16(0), // 內部屬性
        u32(0), // 外部屬性
        u32(offset), // 對應的 local header 位移
        nameBytes,
      ]),
    );

    offset += localHeader.length + compressed.length;
  }

  const central = concat(centralChunks);
  const end = concat([
    u32(SIGNATURE.end),
    u16(0), // 本磁碟編號
    u16(0), // 中央目錄起始磁碟
    u16(entries.length),
    u16(entries.length),
    u32(central.length),
    u32(offset), // 中央目錄起始位移
    u16(0), // 註解長度
  ]);

  return concat([...localChunks, central, end]);
}
