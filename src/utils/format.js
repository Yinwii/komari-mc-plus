const BYTE_UNITS = ["B/s", "KB/s", "MB/s", "GB/s", "TB/s"];
const LONG_TERM_EXPIRE_DAYS = 36500;

export function formatByteRate(value, unit = "B/s") {
  const bytes = toBytes(value, unit);
  if (!Number.isFinite(bytes) || bytes <= 0) return { value: "0", unit: "B/s" };

  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  const converted = bytes / 1024 ** index;
  const decimals = converted >= 100 ? 0 : converted >= 10 ? 1 : 2;
  return { value: converted.toFixed(decimals), unit: BYTE_UNITS[index] };
}

export function formatExpiry(value, now = Date.now()) {
  if (!value) return "--";
  const days = Math.ceil((Date.parse(value) - now) / 86400000);
  if (!Number.isFinite(days)) return "--";
  if (days > LONG_TERM_EXPIRE_DAYS) return "长期";
  return days > 0 ? `${days} 天` : "已到期";
}

/**
 * 计费周期短标签。Komari 官方按天区间识别周期（utils/renewal.go）：
 * 27-32 月付 / 87-95 季付 / 175-185 半年付 / 360-370 年付 / 720-750 两年付 / 1080-1150 三年付 / 1800-1850 五年付 / -1 长期。
 */
export function billingCycleUnit(days) {
  const d = Math.trunc(Number(days));
  if (d === -1) return "买断";
  if (d >= 27 && d <= 32) return "月";
  if (d >= 87 && d <= 95) return "季";
  if (d >= 175 && d <= 185) return "半年";
  if (d >= 360 && d <= 370) return "年";
  if (d >= 720 && d <= 750) return "两年";
  if (d >= 1080 && d <= 1150) return "三年";
  if (d >= 1800 && d <= 1850) return "五年";
  return d > 0 ? `${d}天` : "次";
}

export function formatCost(node) {
  const price = Number(node.price);
  if (!Number.isFinite(price) || price <= 0) return "免费";
  return `${node.currency || "$"}${price.toFixed(2)}/${billingCycleUnit(node.billingCycle)}`;
}

function toBytes(value, unit) {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return 0;
  const normalizedUnit = String(unit || "B/s").toUpperCase().replace("/S", "");
  const index = Math.max(0, BYTE_UNITS.findIndex((item) => item.startsWith(normalizedUnit)));
  return amount * 1024 ** index;
}
