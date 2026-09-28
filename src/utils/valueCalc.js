/**
 * 剩余价值计算（纯函数，供 RemainingValuePanel 与测试使用）。
 *
 * 口径（与 services/assets.js 的资产估值保持一致）：
 *   - billingCycle 单位为天（Komari 后台按天存储，30≈月付 / 365≈年付；-1 表示长期/买断）；
 *   - 剩余价值 = 单价 × 剩余天数 / 计费周期天数（钳制在 [0, 单价]）；
 *   - 长期/买断不折旧，剩余价值 = 单价；
 *   - 缺少到期日且非长期 → 信息不完整，剩余价值记为 null（不计入合计）；
 *   - 溢价 = 参考市价 − 剩余价值（仅当填写了参考市价时计算）。
 */

export const CYCLE_OPTIONS = [
  { value: 30, label: "月付 · 30天" },
  { value: 90, label: "季付 · 90天" },
  { value: 180, label: "半年付 · 180天" },
  { value: 365, label: "年付 · 365天" },
  { value: 730, label: "两年付 · 730天" },
  { value: -1, label: "长期 / 买断" },
];

const DAY_MS = 86400000;

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

/** 解析到期日输入（ISO 字符串 / 时间戳），无效返回 null。 */
export function parseExpiry(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function cycleLabel(days) {
  const option = CYCLE_OPTIONS.find((item) => item.value === days);
  return option ? option.label : days > 0 ? `自定义 · ${days}天` : "长期 / 买断";
}

/** 本地时区 YYYY-MM-DD（避免 toISOString 的 UTC 偏移导致跨日误差）。 */
export function formatDate(ms) {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * 计算单个节点的价值明细。
 * @param {{uuid:string, name:string, group?:string, currency?:string, price:number,
 *          billingCycle:number, expiredAt?:string|null, market?:number}} node
 */
export function computeNodeValue(node, now = Date.now()) {
  const price = toFiniteNumber(node.price);
  const cycleDays = Math.trunc(Number(node.billingCycle)) || 0;
  const permanent = cycleDays === -1;
  const currency = String(node.currency || "¥").trim() || "¥";
  const expiryMs = parseExpiry(node.expiredAt);
  let remainingDays = null;
  let remainingValue = null;
  let consumed = null;
  let expired = false;

  if (permanent) {
    remainingDays = null;
    remainingValue = price;
    consumed = 0;
  } else if (expiryMs !== null) {
    remainingDays = Math.ceil((expiryMs - now) / DAY_MS);
    expired = remainingDays <= 0;
    if (expired) remainingDays = 0;
    if (cycleDays > 0 && price > 0) {
      remainingValue = Math.min(price, Math.max(0, price * (remainingDays / cycleDays)));
      consumed = price - remainingValue;
    }
  }

  const dailyCost = cycleDays > 0 && price > 0 ? price / cycleDays : null;
  const market = toFiniteNumber(node.market);
  const hasMarket = market > 0 && remainingValue !== null;
  const premium = hasMarket ? market - remainingValue : null;
  const premiumRate = hasMarket && remainingValue > 0 ? premium / remainingValue : null;

  return {
    uuid: node.uuid,
    name: node.name,
    group: node.group || "",
    currency,
    price,
    cycleDays,
    permanent,
    expiryMs,
    expired,
    remainingDays,
    dailyCost,
    remainingValue,
    consumed,
    market: hasMarket ? market : null,
    premium,
    premiumRate,
    incomplete: !permanent && (expiryMs === null || cycleDays <= 0),
  };
}

/** 按币种折算为 CNY 的比率；无法识别返回 null。 */
export function cnyRatio(currency, rates) {
  const raw = String(currency).trim().toUpperCase();
  const code = (rates.aliases ? rates.aliases : {}) [raw] || raw;
  if (code === "CNY") return 1;
  const rate = rates?.[code];
  return Number.isFinite(rate) && rate > 0 ? 1 / rate : null;
}

/**
 * 汇总多台节点：能换汇时给出 CNY 合计，否则按币种分组小计。
 * @returns {{count, validCount, missingInfo, total: {cny:{price,value}|null, byCurrency:Map}}}
 */
export function summarizeValues(items, rates, now = Date.now()) {
  const byCurrency = new Map();
  let cnyPrice = 0;
  let cnyValue = 0;
  let cnyPremium = 0;
  let cnyConvertible = true;
  let validCount = 0;
  let missingInfo = 0;
  let remainingDaysSum = 0;
  let remainingDaysCount = 0;

  for (const item of items) {
    if (item.incomplete) { missingInfo++; continue; }
    validCount++;
    const ratio = rates ? cnyRatio(item.currency, rates) : null;
    if (ratio === null) cnyConvertible = false;
    const bucket = byCurrency.get(item.currency) || { price: 0, value: 0, premium: 0 };
    bucket.price += item.price;
    bucket.value += item.remainingValue ?? 0;
    if (item.premium !== null) bucket.premium += item.premium;
    byCurrency.set(item.currency, bucket);
    if (ratio !== null) {
      cnyPrice += item.price * ratio;
      cnyValue += (item.remainingValue ?? 0) * ratio;
      if (item.premium !== null) cnyPremium += item.premium * ratio;
    }
    if (item.remainingDays !== null) {
      remainingDaysSum += item.remainingDays;
      remainingDaysCount++;
    }
  }

  return {
    count: items.length,
    validCount,
    missingInfo,
    avgRemainingDays: remainingDaysCount ? remainingDaysSum / remainingDaysCount : null,
    total: {
      cny: cnyConvertible && rates
        ? { price: cnyPrice, value: cnyValue, premium: cnyPremium }
        : null,
      byCurrency,
    },
  };
}

/** 生成简洁的纯文本报告（复制/分享用）。 */
export function buildTextReport(items, summary, meta = {}) {
  const lines = [];
  const title = meta.title || "VPS 剩余价值评估";
  lines.push(title);
  if (meta.dateText) lines.push(`生成时间：${meta.dateText}`);
  lines.push("");
  lines.push("节点          币种  单价      到期        剩余天数  剩余价值   溢价");
  lines.push("-".repeat(72));
  for (const item of items) {
    const name = item.name.length > 12 ? `${item.name.slice(0, 11)}…` : item.name;
    const expiry = item.expiryMs ? formatDate(item.expiryMs) : item.permanent ? "长期" : "未知";
    const remaining = item.permanent ? "∞" : item.remainingDays === null ? "-" : `${item.remainingDays}`;
    const value = item.remainingValue === null ? "-" : item.remainingValue.toFixed(2);
    const premium = item.premium === null ? "-" : `${item.premium >= 0 ? "+" : ""}${item.premium.toFixed(2)}`;
    lines.push(`${name.padEnd(14)}${item.currency.padEnd(4)}${item.price.toFixed(2).padEnd(10)}${expiry.padEnd(12)}${remaining.padEnd(10)}${value.padEnd(11)}${premium}`);
  }
  lines.push("-".repeat(72));
  if (summary.total.cny) {
    lines.push(`合计（CNY 折算）：购入 ${summary.total.cny.price.toFixed(2)} · 剩余价值 ${summary.total.cny.value.toFixed(2)} · 溢价 ${summary.total.cny.premium.toFixed(2)}`);
  }
  for (const [currency, bucket] of summary.total.byCurrency) {
    if (summary.total.cny && currency === "¥") continue;
    lines.push(`合计（${currency}）：购入 ${bucket.price.toFixed(2)} · 剩余价值 ${bucket.value.toFixed(2)}${bucket.premium ? ` · 溢价 ${bucket.premium.toFixed(2)}` : ""}`);
  }
  lines.push(`节点 ${summary.count} 台（信息完整 ${summary.validCount}）`);
  if (meta.footer) lines.push(meta.footer);
  return lines.join("\n");
}

/** 生成带格式的 HTML 表格（富文本复制用）。 */
export function buildHtmlReport(items, summary, meta = {}) {
  const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const rows = items.map((item) => {
    const expiry = item.expiryMs ? formatDate(item.expiryMs) : item.permanent ? "长期" : "未知";
    const remaining = item.permanent ? "长期" : item.remainingDays === null ? "—" : `${item.remainingDays} 天`;
    const value = item.remainingValue === null ? "—" : item.remainingValue.toFixed(2);
    const premium = item.premium === null ? "—" : `${item.premium >= 0 ? "+" : ""}${item.premium.toFixed(2)}`;
    return `<tr><td>${esc(item.name)}</td><td style="text-align:center">${esc(expiry)}</td><td style="text-align:right">${esc(item.currency)}${item.price.toFixed(2)}</td><td style="text-align:center">${esc(remaining)}</td><td style="text-align:right">${esc(value)}</td><td style="text-align:right">${esc(premium)}</td></tr>`;
  }).join("");
  const totals = [];
  if (summary.total.cny) totals.push(`合计（CNY 折算）：<b>${summary.total.cny.value.toFixed(2)}</b>（购入 ${summary.total.cny.price.toFixed(2)}，溢价 ${summary.total.cny.premium.toFixed(2)}）`);
  for (const [currency, bucket] of summary.total.byCurrency) {
    if (summary.total.cny && currency === "¥") continue;
    totals.push(`合计（${esc(currency)}）：<b>${bucket.value.toFixed(2)}</b>（购入 ${bucket.price.toFixed(2)}）`);
  }
  return [
    `<div style="font-family:system-ui,sans-serif;max-width:640px">`,
    `<h3 style="margin:0 0 4px">${esc(meta.title || "VPS 剩余价值评估")}</h3>`,
    meta.dateText ? `<p style="margin:0 0 10px;color:#64748b;font-size:12px">${esc(meta.dateText)}</p>` : "",
    `<table style="border-collapse:collapse;width:100%;font-size:13px">`,
    `<thead><tr style="background:#f1f5f9"><th style="text-align:left;padding:6px 10px;border:1px solid #e2e8f0">节点</th><th style="padding:6px 10px;border:1px solid #e2e8f0">到期</th><th style="padding:6px 10px;border:1px solid #e2e8f0">单价</th><th style="padding:6px 10px;border:1px solid #e2e8f0">剩余</th><th style="padding:6px 10px;border:1px solid #e2e8f0">剩余价值</th><th style="padding:6px 10px;border:1px solid #e2e8f0">溢价</th></tr></thead>`,
    `<tbody>${rows}</tbody>`,
    `</table>`,
    `<p style="margin:10px 0 0;font-size:13px">${totals.join("<br/>")}</p>`,
    `<p style="margin:8px 0 0;color:#94a3b8;font-size:11px">${esc(meta.footer || "由 Komari 面板生成")}</p>`,
    `</div>`,
  ].join("");
}
