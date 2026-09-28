/**
 * 剩余价值计算（纯函数，供 RemainingValuePanel 与测试使用）。
 *
 * 口径（与 services/assets.js 的资产估值保持一致）：
 *   - billingCycle 单位为天（Komari 后台按天存储，30≈月付 / 365≈年付；-1 表示长期/买断）；
 *   - 剩余价值 = 单价 × 剩余天数 / 计费周期天数（钳制在 [0, 单价]）；
 *   - 长期/买断不折旧，剩余价值 = 单价；
 *   - 缺少到期日且非长期 → 信息不完整，剩余价值记为 null（不计入合计）；
 *   - 溢价支持两种模式（premiumMode）：
 *       · "premium"（默认）：直接填写溢价，总价 = 剩余价值 + 溢价；
 *       · "market"：填写参考市价，溢价 = 参考市价 − 剩余价值，总价 = 剩余价值 + 溢价 = 参考市价；
 *   - 未显式指定模式时自动推断：填了溢价按 premium，填了市价按 market，否则 premium。
 */

import { billingCycleUnit } from "./format.js";

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
  const d = Math.trunc(Number(days));
  if (d === -1 || d <= 0) return "长期 / 买断";
  // 与 format.js 的 billingCycleUnit 共用同一套 Komari 官方区间，避免非整 30/365 天被误标。
  const unit = billingCycleUnit(d);
  return unit.endsWith("天") ? `自定义 · ${d}天` : `${unit}付 · ${d}天`;
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
 *          billingCycle:number, expiredAt?:string|null, market?:number,
 *          premiumMode?:""|"premium"|"market", manualPremium?:number|null}} node
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

  // 直接填写的溢价（允许为负 = 折价）。
  const manualRaw = node.manualPremium;
  const hasManual = manualRaw !== null && manualRaw !== undefined && manualRaw !== ""
    && Number.isFinite(Number(manualRaw));
  const manualPremium = hasManual ? Number(manualRaw) : null;
  const premiumMode = node.premiumMode === "market" || node.premiumMode === "premium"
    ? node.premiumMode
    : manualPremium !== null ? "premium" : market > 0 ? "market" : "premium";

  let premium = null;
  if (remainingValue !== null) {
    if (premiumMode === "premium") premium = manualPremium;
    else if (hasMarket) premium = market - remainingValue;
  }

  // 总价 = 剩余价值 + 溢价（未填溢价时按 0 计，即总价等于剩余价值）。
  const totalPrice = remainingValue === null ? null : remainingValue + (premium ?? 0);
  const premiumRate = premium !== null && remainingValue > 0 ? premium / remainingValue : null;

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
    premiumMode,
    manualPremium,
    premium,
    premiumRate,
    totalPrice,
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
  let cnyTotal = 0;
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
    const bucket = byCurrency.get(item.currency) || { price: 0, value: 0, premium: 0, totalPrice: 0 };
    bucket.price += item.price;
    bucket.value += item.remainingValue ?? 0;
    if (item.premium !== null) bucket.premium += item.premium;
    bucket.totalPrice += item.totalPrice ?? 0;
    byCurrency.set(item.currency, bucket);
    if (ratio !== null) {
      cnyPrice += item.price * ratio;
      cnyValue += (item.remainingValue ?? 0) * ratio;
      if (item.premium !== null) cnyPremium += item.premium * ratio;
      cnyTotal += (item.totalPrice ?? 0) * ratio;
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
        ? { price: cnyPrice, value: cnyValue, premium: cnyPremium, totalPrice: cnyTotal }
        : null,
      byCurrency,
    },
  };
}

function cycleShort(days) {
  const map = { 30: "月付", 90: "季付", 180: "半年付", 365: "年付", 730: "两年付" };
  if (days === -1) return "长期";
  return map[days] || (days > 0 ? `${days}天周期` : "未知周期");
}

/** 每台节点的 jsq 风格行数据（含 CNY 折算；rates 缺失时回退原币种）。 */
function buildValueLines(item, rates) {
  const ratio = rates ? cnyRatio(item.currency, rates) : null;
  const convertible = ratio !== null;
  const cny = (value) => (convertible ? value * ratio : null);
  const priceCny = cny(item.price);
  const valueCny = item.remainingValue === null ? null : cny(item.remainingValue);
  const premiumCny = item.premium === null ? null : cny(item.premium);
  const totalCny = item.totalPrice === null ? null : cny(item.totalPrice);
  const isCny = item.currency === "¥";

  const priceLine = item.price > 0
    ? isCny || !convertible
      ? `${item.price.toFixed(2)} ${isCny ? "元" : item.currency}/${cycleShort(item.cycleDays)}`
      : `${item.price.toFixed(2)} ${item.currency}/${cycleShort(item.cycleDays)}（约 ${priceCny.toFixed(2)} 元）`
    : `免费或未设置`;
  const remainingLine = item.permanent
    ? "长期有效"
    : item.remainingDays === null
      ? "未知（缺少到期日或周期）"
      : item.expired
        ? `0天（已于 ${item.expiryMs ? formatDate(item.expiryMs) : "?"} 到期）`
        : `${item.remainingDays}天（${item.expiryMs ? formatDate(item.expiryMs) : "?"} 到期）`;
  const unit = convertible || isCny ? "元" : ` ${item.currency}`;
  const amount = (value, converted) => `${(convertible ? converted : value).toFixed(2)}${unit}`;
  const valueLine = item.remainingValue === null
    ? "未知"
    : convertible && !isCny
      ? `${valueCny.toFixed(2)}元（约 ${item.remainingValue.toFixed(2)} ${item.currency}）`
      : `${(convertible ? valueCny : item.remainingValue).toFixed(2)}${unit}`;
  const totalText = item.totalPrice === null ? "—" : amount(item.totalPrice, totalCny);
  const premiumText = item.premium === null ? "—" : `${item.premium > 0 ? "+" : ""}${amount(item.premium, premiumCny)}`;
  const premiumLine = item.premium === null
    ? `— / ${totalText}`
    : item.premiumMode === "market" && item.market !== null
      ? `（市价 ${item.market.toFixed(2)} ${item.currency}）${premiumText} / ${totalText}`
      : `${premiumText} / ${totalText}`;
  return { priceLine, remainingLine, valueLine, premiumLine, totalText };
}

/** 生成 jsq.xiaoge.org 风格的 emoji 清单报告。 */
export function buildTextReport(items, summary, meta = {}) {
  const lines = [];
  lines.push(`## 🐔 VPS 剩余价值`);
  lines.push(`- 📅 交易日期：${meta.dateText ? meta.dateText.slice(0, 10) : formatDate(Date.now())}`);
  for (const rateLine of meta.rateLines || []) lines.push(`- 💹 外币汇率：${rateLine}`);
  if (!meta.rateLines?.length) lines.push("- 💹 外币汇率：未获取（按原币种显示）");
  for (const item of items) {
    const value = buildValueLines(item, meta.rates);
    lines.push("");
    lines.push(`### 🖥 ${item.name}`);
    if (item.configLine) lines.push(`- ⚙️ 服务器配置：${item.configLine}`);
    lines.push(`- 💰 续费价格：${value.priceLine}`);
    lines.push(`- ⏳ 剩余天数：${value.remainingLine}`);
    lines.push(`- 💎 剩余价值：${value.valueLine}`);
    lines.push(`- 🧾 溢价 / 总价：${value.premiumLine}`);
  }
  lines.push("");
  if (summary.total.cny) {
    const { value, premium, totalPrice } = summary.total.cny;
    const diff = Math.abs(totalPrice - value) > 0.005;
    lines.push(`> 💰 合计剩余价值：${value.toFixed(2)} 元（${summary.validCount} 台）${premium ? ` · 溢价 ${premium.toFixed(2)} 元` : ""}${diff ? ` · 合计总价 ${totalPrice.toFixed(2)} 元` : ""}`);
  } else {
    const parts = [...summary.total.byCurrency.entries()].map(([currency, bucket]) => `${bucket.value.toFixed(2)} ${currency}`);
    lines.push(`> 💰 合计剩余价值：${parts.join(" + ") || "—"}（${summary.validCount} 台）`);
  }
  if (meta.footer) lines.push(`> ${meta.footer}`);
  return lines.join("\n");
}

/** 生成带格式的 HTML 报告（富文本复制用），样式与文本版一致。 */
export function buildHtmlReport(items, summary, meta = {}) {
  const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const blocks = items.map((item) => {
    const value = buildValueLines(item, meta.rates);
    return [
      `<div style="margin:0 0 12px;padding:10px 14px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc">`,
      `<div style="font-weight:600;margin-bottom:6px">🖥 ${esc(item.name)}${item.group ? ` <span style="color:#94a3b8;font-weight:400;font-size:12px">${esc(item.group)}</span>` : ""}</div>`,
      `<div style="font-size:13px;line-height:1.9">`,
      item.configLine ? `⚙️ 服务器配置：${esc(item.configLine)}<br/>` : "",
      `💰 续费价格：${esc(value.priceLine)}<br/>`,
      `⏳ 剩余天数：${esc(value.remainingLine)}<br/>`,
      `💎 剩余价值：<b style="color:#12855c">${esc(value.valueLine)}</b><br/>`,
      `🧾 溢价 / 总价：${esc(value.premiumLine)}`,
      `</div></div>`,
    ].join("");
  }).join("");
  const rateLines = meta.rateLines?.length
    ? meta.rateLines.map((line) => esc(line)).join("；")
    : "未获取（按原币种显示）";
  let totalLine;
  if (summary.total.cny) {
    const { value, premium, totalPrice } = summary.total.cny;
    const diff = Math.abs(totalPrice - value) > 0.005;
    totalLine = `合计剩余价值：<b style="color:#12855c">${value.toFixed(2)} 元</b>（${summary.validCount} 台）${premium ? ` · 溢价 ${premium.toFixed(2)} 元` : ""}${diff ? ` · 合计总价 <b>${totalPrice.toFixed(2)} 元</b>` : ""}`;
  } else {
    const parts = [...summary.total.byCurrency.entries()].map(([currency, bucket]) => `${bucket.value.toFixed(2)} ${esc(currency)}`);
    totalLine = `合计剩余价值：<b>${parts.join(" + ") || "—"}</b>（${summary.validCount} 台）`;
  }
  return [
    `<div style="font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;max-width:560px">`,
    `<h2 style="margin:0 0 8px">🐔 VPS 剩余价值</h2>`,
    `<p style="margin:0 0 4px;font-size:13px;color:#475569">📅 交易日期：${esc(meta.dateText ? meta.dateText.slice(0, 10) : formatDate(Date.now()))}</p>`,
    `<p style="margin:0 0 12px;font-size:13px;color:#475569">💹 外币汇率：${rateLines}</p>`,
    blocks,
    `<div style="padding:10px 14px;border-radius:12px;background:#eafbf1;border:1px solid #bfe8cf;font-size:13px">${totalLine}</div>`,
    `<p style="margin:8px 0 0;color:#94a3b8;font-size:11px">${esc(meta.footer || "由 Komari 面板生成")}</p>`,
    `</div>`,
  ].join("");
}
