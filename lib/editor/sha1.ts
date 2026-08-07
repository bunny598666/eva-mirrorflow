/**
 * SHA-1（同步、無相依）。
 *
 * 【為什麼自己寫】貼上攔截（Tiptap handlePaste）是同步的：要在同一個 tick 內
 * 決定這段文字掛 aiOrigin 還是 externalOrigin。`crypto.subtle.digest` 是非同步的，
 * 而且在非安全來源（http 的區網 IP，教室很可能就是這樣連）根本不存在。
 * 為了一顆雜湊而讓貼上變成非同步，會多出「插入位置在等待期間被改掉」的競態，
 * 不值得。
 *
 * 【用途純粹是內容指紋】用來把「Chat 裡的複製」與「編輯器裡的貼上」對起來，
 * 不涉及任何安全性判斷。SHA-1 的碰撞弱點在這個用途上無關緊要——選它是因為
 * BUILD_PLAN §6 STEP 6 就是這麼寫的，換演算法會讓事件欄位與規格對不上。
 *
 * 【為什麼要有指紋而不是直接存文字】events.payload 存指紋而非整段被複製的文字：
 * 事件流會小很多，而且日後只靠 events 就能把 paste 接回 copy，不必依賴用戶端
 * 那份會被清掉的暫存。
 */

/** 回傳 40 字元小寫十六進位。 */
export function sha1Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;

  // 補位：0x80，補零到 (mod 64 === 56)，最後 8 bytes 放長度（big-endian）。
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(padded.length - 4, bitLength >>> 0, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Uint32Array(80);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 80; i += 1) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (x << 1) | (x >>> 31);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i += 1) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = t;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  return [h0, h1, h2, h3, h4].map((n) => n.toString(16).padStart(8, "0")).join("");
}
