/**
 * 軌跡圖的幾何與 SVG 產生（純函式）。
 *
 * 【為什麼不用 Recharts】CLAUDE.md §2 把 Recharts 列為圖表選型，其餘圖表仍
 * 沿用。但這一張是「論文最重要的一張 Figure，渲染品質要求出版級」，而它需要：
 * 每位學生一條帶箭頭的折線、期別以點形狀區分、匯出一份能用 Illustrator／
 * Inkscape 直接開的獨立 SVG。從 Recharts 的 DOM 裡撈 SVG 會夾帶大量包裝元素
 * 與外部 CSS class，另存後在向量軟體裡就是破版。
 *
 * 這裡把整張圖描述成純資料 → 產生 SVG 字串，畫面與匯出用**同一支函式**，
 * 所見即所得，而且驗得到（不需要瀏覽器）。
 *
 * 【匯出檔為什麼用英文標籤】期刊投稿用。英文字母在任何一套基礎字型裡都有，
 * 不必嵌入字型檔就不會缺字；中文則反過來——沒嵌字型在別人的機器上必然變成
 * 豆腐字。畫面上仍是中文，只有匯出檔改英文（BUILD_PLAN §6 STEP 10 的要求）。
 */
import {
  QUADRANT_LABEL,
  QUADRANT_LABEL_EN,
  Y_DIVIDER,
  type QuadrantName,
  type Trajectory,
} from "./quadrant.ts";

export type ChartOptions = {
  width: number;
  height: number;
  /** X 軸範圍。z 分數相加，實務上落在 ±6 之內。 */
  xMin: number;
  xMax: number;
  /** 匯出用：標籤走英文、不畫互動用的裝飾。 */
  english: boolean;
};

export const DEFAULT_CHART: ChartOptions = {
  width: 720,
  height: 640,
  xMin: -6,
  xMax: 6,
  english: false,
};

const MARGIN = { top: 56, right: 24, bottom: 64, left: 64 };

/** 期別對應的點形狀：第 1 期 ○、第 2 期 △、第 3 期 □。 */
export type PointShape = "circle" | "triangle" | "square";

export function shapeFor(orderNo: number): PointShape {
  if (orderNo <= 1) return "circle";
  if (orderNo === 2) return "triangle";
  return "square";
}

export type Scale = { x: (value: number) => number; y: (value: number) => number };

export function scaleFor(options: ChartOptions): Scale {
  const plotWidth = options.width - MARGIN.left - MARGIN.right;
  const plotHeight = options.height - MARGIN.top - MARGIN.bottom;
  const span = options.xMax - options.xMin || 1;
  return {
    x: (value) =>
      MARGIN.left + ((clamp(value, options.xMin, options.xMax) - options.xMin) / span) * plotWidth,
    // Y 是 0–1 的比例，1 在上方。
    y: (value) => MARGIN.top + (1 - clamp(value, 0, 1)) * plotHeight,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 一個點的路徑（形狀畫在原點附近，再平移）。 */
export function shapePath(shape: PointShape, cx: number, cy: number, r: number): string {
  if (shape === "circle") {
    return `M ${round(cx - r)} ${round(cy)} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
  }
  if (shape === "square") {
    const s = r * 0.9;
    return `M ${round(cx - s)} ${round(cy - s)} H ${round(cx + s)} V ${round(cy + s)} H ${round(cx - s)} Z`;
  }
  const h = r * 1.15;
  return `M ${round(cx)} ${round(cy - h)} L ${round(cx + h)} ${round(cy + h * 0.8)} L ${round(cx - h)} ${round(cy + h * 0.8)} Z`;
}

/**
 * 箭頭：把線段末端縮短，留出箭頭本身的長度，否則箭頭會蓋住終點的形狀。
 * 兩點重合時回 null——沒有方向就不該畫箭頭。
 */
export function arrowFor(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  gap: number,
): { x1: number; y1: number; x2: number; y2: number; angle: number } | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length < gap * 2) return null;
  const ux = dx / length;
  const uy = dy / length;
  return {
    x1: round(x1 + ux * gap),
    y1: round(y1 + uy * gap),
    x2: round(x2 - ux * gap),
    y2: round(y2 - uy * gap),
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

/** 每位學生一個顏色，依代號穩定分配——同一個人在任何一次渲染都同色。 */
const PALETTE = [
  "#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed",
  "#0891b2", "#db2777", "#65a30d", "#c026d3", "#0d9488",
];

export function colorFor(code: string): string {
  let hash = 0;
  for (let i = 0; i < code.length; i += 1) hash = (hash * 31 + code.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length] ?? "#525252";
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 產生整張圖的 SVG 字串。
 *
 * 全部走 presentation attribute（fill / stroke 直接寫在元素上），不依賴任何
 * CSS class 或外部樣式表——這是「另存後在向量軟體裡不破版」的關鍵。
 */
export function renderTrajectorySvg(
  trajectories: readonly Trajectory[],
  options: ChartOptions = DEFAULT_CHART,
): string {
  const { width, height, english } = options;
  const scale = scaleFor(options);
  const zeroX = scale.x(0);
  const dividerY = scale.y(Y_DIVIDER);
  const plotLeft = MARGIN.left;
  const plotRight = width - MARGIN.right;
  const plotTop = MARGIN.top;
  const plotBottom = height - MARGIN.bottom;

  const font = "Helvetica, Arial, 'Noto Sans', sans-serif";
  const label = (key: QuadrantName): string =>
    english ? QUADRANT_LABEL_EN[key] : QUADRANT_LABEL[key];

  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${font}">`,
  );
  parts.push(
    `<defs><marker id="mf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#525252"/></marker></defs>`,
  );
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`);

  // 象限底色（極淡，印出來不搶掉資料點）
  parts.push(
    `<rect x="${plotLeft}" y="${plotTop}" width="${round(zeroX - plotLeft)}" height="${round(dividerY - plotTop)}" fill="#f8fafc"/>`,
    `<rect x="${round(zeroX)}" y="${plotTop}" width="${round(plotRight - zeroX)}" height="${round(dividerY - plotTop)}" fill="#f1f5f9"/>`,
    `<rect x="${plotLeft}" y="${round(dividerY)}" width="${round(zeroX - plotLeft)}" height="${round(plotBottom - dividerY)}" fill="#f1f5f9"/>`,
    `<rect x="${round(zeroX)}" y="${round(dividerY)}" width="${round(plotRight - zeroX)}" height="${round(plotBottom - dividerY)}" fill="#f8fafc"/>`,
  );

  // 象限分界
  parts.push(
    `<line x1="${round(zeroX)}" y1="${plotTop}" x2="${round(zeroX)}" y2="${plotBottom}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4 4"/>`,
    `<line x1="${plotLeft}" y1="${round(dividerY)}" x2="${plotRight}" y2="${round(dividerY)}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4 4"/>`,
  );

  // 外框
  parts.push(
    `<rect x="${plotLeft}" y="${plotTop}" width="${round(plotRight - plotLeft)}" height="${round(plotBottom - plotTop)}" fill="none" stroke="#334155" stroke-width="1"/>`,
  );

  // 象限名稱
  const corners: { key: QuadrantName; x: number; y: number; anchor: string }[] = [
    { key: "solo", x: plotLeft + 10, y: plotTop + 20, anchor: "start" },
    { key: "collaborator", x: plotRight - 10, y: plotTop + 20, anchor: "end" },
    { key: "free_rider", x: plotLeft + 10, y: plotBottom - 10, anchor: "start" },
    { key: "outsourcer", x: plotRight - 10, y: plotBottom - 10, anchor: "end" },
  ];
  for (const corner of corners) {
    parts.push(
      `<text x="${round(corner.x)}" y="${round(corner.y)}" text-anchor="${corner.anchor}" font-size="13" fill="#64748b">${escapeXml(label(corner.key))}</text>`,
    );
  }

  // 座標軸刻度
  for (let value = options.xMin; value <= options.xMax; value += 2) {
    const x = scale.x(value);
    parts.push(
      `<line x1="${round(x)}" y1="${plotBottom}" x2="${round(x)}" y2="${plotBottom + 5}" stroke="#334155" stroke-width="1"/>`,
      `<text x="${round(x)}" y="${plotBottom + 20}" text-anchor="middle" font-size="11" fill="#334155">${value}</text>`,
    );
  }
  for (let value = 0; value <= 1.0001; value += 0.25) {
    const y = scale.y(value);
    parts.push(
      `<line x1="${plotLeft - 5}" y1="${round(y)}" x2="${plotLeft}" y2="${round(y)}" stroke="#334155" stroke-width="1"/>`,
      `<text x="${plotLeft - 9}" y="${round(y + 4)}" text-anchor="end" font-size="11" fill="#334155">${value.toFixed(2)}</text>`,
    );
  }

  // 軸標籤
  const xLabel = english
    ? "Interaction depth  (z(turns) + z(mean prompt length) + z(high-order questions))"
    : "互動深度（對話輪次 + 平均提問長度 + 高階提問，皆為該期全班 z 分數）";
  const yLabel = english
    ? "Originality  (orange + 0.5 × green)"
    : "原創性（橘 + 0.5 × 綠）";
  parts.push(
    `<text x="${round((plotLeft + plotRight) / 2)}" y="${height - 16}" text-anchor="middle" font-size="12" fill="#0f172a">${escapeXml(xLabel)}</text>`,
    `<text x="18" y="${round((plotTop + plotBottom) / 2)}" text-anchor="middle" font-size="12" fill="#0f172a" transform="rotate(-90 18 ${round((plotTop + plotBottom) / 2)})">${escapeXml(yLabel)}</text>`,
  );

  // 軌跡
  for (const trajectory of trajectories) {
    const color = colorFor(trajectory.participantCode);
    const coords = trajectory.points.map((point) => ({
      x: scale.x(point.x),
      y: scale.y(point.y),
      shape: shapeFor(point.orderNo),
    }));

    for (let i = 1; i < coords.length; i += 1) {
      const from = coords[i - 1];
      const to = coords[i];
      if (!from || !to) continue;
      const arrow = arrowFor(from.x, from.y, to.x, to.y, 9);
      if (!arrow) continue;
      parts.push(
        `<line x1="${arrow.x1}" y1="${arrow.y1}" x2="${arrow.x2}" y2="${arrow.y2}" stroke="${color}" stroke-width="1.5" opacity="0.75" marker-end="url(#mf-arrow)"/>`,
      );
    }

    for (const coord of coords) {
      parts.push(
        `<path d="${shapePath(coord.shape, coord.x, coord.y, 5)}" fill="${color}" fill-opacity="0.85" stroke="#ffffff" stroke-width="1"/>`,
      );
    }
  }

  // 期別圖例
  const legendY = plotTop - 22;
  const legendItems: { shape: PointShape; text: string }[] = [
    { shape: "circle", text: english ? "Time 1" : "第 1 次" },
    { shape: "triangle", text: english ? "Time 2" : "第 2 次" },
    { shape: "square", text: english ? "Time 3" : "第 3 次" },
  ];
  let legendX = plotLeft;
  for (const item of legendItems) {
    parts.push(
      `<path d="${shapePath(item.shape, legendX + 6, legendY, 5)}" fill="#334155"/>`,
      `<text x="${legendX + 17}" y="${legendY + 4}" font-size="12" fill="#334155">${escapeXml(item.text)}</text>`,
    );
    legendX += 90;
  }

  parts.push("</svg>");
  return parts.join("");
}
