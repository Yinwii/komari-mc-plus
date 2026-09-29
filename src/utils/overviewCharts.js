/**
 * 首页总览卡片底部图例的纯计算层：
 * 剩余价值卡（留存比例条 / 到期时间线 / 账期分布柱）与累计流量卡（上下行构成 / 24h 趋势 / 限额用量环）。
 * 全部为无副作用的纯函数，便于单测与在 SSR 下安全求值。
 */
export const DAY_MS = 86400000;
export const HOUR_MS = 3600000;

/** 剩余天数分档：7 天内告急、30 天内临期、其余健康。 */
export function expiryLevel(days) {
  if (days <= 7) return "danger";
  if (days <= 30) return "warning";
  return "ok";
}

function formatDate(ms) {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * 到期时间线：按剩余天数升序取前 limit 台，条长表示「本计费周期还剩多少」。
 * 买断（billingCycle = -1）与缺失到期时间的节点不参与。
 */
export function buildExpiryTimeline(nodes = [], now = Date.now(), limit = 5) {
  const items = [];
  for (const node of nodes) {
    const cycleDays = Number(node.billingCycle);
    if (cycleDays === -1) continue;
    const expiry = Date.parse(node.expiredAt);
    if (!Number.isFinite(expiry)) continue;
    const remainingMs = expiry - now;
    const days = Math.max(0, Math.ceil(remainingMs / DAY_MS));
    const ratio = cycleDays > 0 ? Math.max(0, Math.min(1, remainingMs / (cycleDays * DAY_MS))) : 0;
    items.push({
      uuid: node.uuid || node.name,
      name: node.name || node.uuid || "未命名",
      days,
      expiry,
      ratio,
      level: expiryLevel(days),
      title: `${node.name || node.uuid} · 到期 ${formatDate(expiry)} · 剩余 ${days} 天`,
    });
  }
  items.sort((left, right) => left.days - right.days || left.name.localeCompare(right.name));
  const cap = Number.isFinite(limit) ? Math.max(0, limit) : items.length;
  return {
    items: items.slice(0, cap),
    // all 供卡片「展开全部」使用，避免展开时重复计算。
    all: items,
    total: items.length,
    overflow: Math.max(0, items.length - cap),
    urgent: items.filter((item) => item.level === "danger").length,
  };
}

const CYCLE_BUCKETS = [
  { label: "≤7天", max: 7, level: "danger" },
  { label: "≤30天", max: 30, level: "warning" },
  { label: "≤90天", max: 90, level: "ok" },
  { label: "更久", max: Infinity, level: "ok" },
];

/** 账期分布柱：把有到期信息的节点按剩余天数归入四档，柱高按最大档归一。 */
export function buildCycleBuckets(nodes = [], now = Date.now()) {
  const buckets = CYCLE_BUCKETS.map((bucket) => ({ ...bucket, count: 0 }));
  for (const node of nodes) {
    if (Number(node.billingCycle) === -1) continue;
    const expiry = Date.parse(node.expiredAt);
    if (!Number.isFinite(expiry)) continue;
    const days = Math.max(0, Math.ceil((expiry - now) / DAY_MS));
    const target = buckets.find((bucket) => days <= bucket.max);
    if (target) target.count += 1;
  }
  const max = Math.max(...buckets.map((bucket) => bucket.count), 1);
  return buckets.map((bucket) => ({
    ...bucket,
    height: bucket.count ? Math.max(14, Math.round((bucket.count / max) * 100)) : 0,
    title: `${bucket.label}：${bucket.count} 台`,
  }));
}

/** 累计流量的上下行占比（0 流量时各占一半，避免出现 0%/100% 的误导条）。 */
export function trafficShare(upBytes = 0, downBytes = 0) {
  const up = Math.max(0, Number(upBytes) || 0);
  const down = Math.max(0, Number(downBytes) || 0);
  const total = up + down;
  if (total <= 0) return { up: 0, down: 0, upPercent: 0, downPercent: 0, total: 0, empty: true };
  const upPercent = (up / total) * 100;
  return {
    up,
    down,
    total,
    upPercent: Math.round(upPercent),
    downPercent: Math.round(100 - upPercent),
    empty: false,
  };
}

/** 限额用量环：只统计后台设置过流量限额（traffic_limit > 0）的节点。 */
export function summarizeLimits(nodes = []) {
  let limitBytes = 0;
  let usedBytes = 0;
  let configured = 0;
  for (const node of nodes) {
    const limit = Number(node.trafficLimitBytes) || 0;
    if (limit <= 0) continue;
    configured += 1;
    limitBytes += limit;
    usedBytes += (Number(node.trafficUpBytes) || 0) + (Number(node.trafficDownBytes) || 0);
  }
  const ratio = limitBytes > 0 ? Math.min(1, usedBytes / limitBytes) : 0;
  return {
    limitBytes,
    usedBytes,
    remainBytes: Math.max(0, limitBytes - usedBytes),
    configured,
    total: nodes.length,
    ratio,
    percent: Math.round(ratio * 100),
    level: ratio >= 0.9 ? "danger" : ratio >= 0.7 ? "warning" : "ok",
  };
}

/**
 * 记录时间解析：兼容 RFC3339 字符串与「毫秒 / 秒」时间戳，字段名兼容 time / updated_at。
 * Komari 不同版本与不同传输路径给出的形状并不统一，这里统一收口。
 */
export function resolveRecordTime(record) {
  const raw = record?.updated_at ?? record?.time ?? record?.timestamp;
  if (raw === undefined || raw === null || raw === "") return NaN;
  if (typeof raw === "number") return raw > 1e11 ? raw : raw * 1000;
  const text = String(raw).trim();
  if (/^\d+$/.test(text)) {
    const value = Number(text);
    return value > 1e11 ? value : value * 1000;
  }
  return Date.parse(text);
}

/** 采样速率（字节/秒）：兼容 network.down/up 与扁平字段。 */
function recordRate(record) {
  const down = Number(record?.network?.down ?? record?.network_down ?? record?.net_down);
  const up = Number(record?.network?.up ?? record?.network_up ?? record?.net_up);
  return {
    down: Number.isFinite(down) && down >= 0 ? down : NaN,
    up: Number.isFinite(up) && up >= 0 ? up : NaN,
  };
}

/** 累计流量（字节）：兼容 network.totalDown/totalUp 与扁平字段。 */
function recordTotal(record) {
  const down = Number(record?.network?.totalDown ?? record?.network?.total_down ?? record?.total_down);
  const up = Number(record?.network?.totalUp ?? record?.network?.total_up ?? record?.total_up);
  return {
    down: Number.isFinite(down) && down >= 0 ? down : NaN,
    up: Number.isFinite(up) && up >= 0 ? up : NaN,
  };
}

/**
 * 24 小时流量趋势：把各节点原始采样记录按小时分桶。
 *
 * 优先用「采样速率 × 3600」得到每小时的流量字节（与实时速率卡同款画法，形状最贴近真实）。
 * 若该实例的记录里没有速率字段，退化为「相邻两次累计总量的差值」来推算每小时流量。
 */
export function buildHourlyTraffic(recordSets = [], now = Date.now(), hours = 24) {
  const buckets = Array.from({ length: hours }, () => ({ down: [], up: [] }));
  const deltaBuckets = Array.from({ length: hours }, () => ({ down: [], up: [] }));
  const start = now - hours * HOUR_MS;
  let samples = 0;

  const bucketIndex = (time) => Math.min(hours - 1, Math.max(0, Math.floor((time - start) / HOUR_MS)));

  for (const records of recordSets) {
    if (!Array.isArray(records)) continue;
    let previous = null;
    for (const record of records) {
      const time = resolveRecordTime(record);
      if (!Number.isFinite(time) || time < start || time > now) continue;
      samples += 1;
      const index = bucketIndex(time);
      const rate = recordRate(record);
      if (Number.isFinite(rate.down)) buckets[index].down.push(rate.down);
      if (Number.isFinite(rate.up)) buckets[index].up.push(rate.up);

      // 累计量差值：只在同一条记录流内相邻采样之间计算，跨节点不互相干扰。
      const total = recordTotal(record);
      if (previous && Number.isFinite(total.down) && Number.isFinite(previous.down) && total.down >= previous.down) {
        deltaBuckets[index].down.push(total.down - previous.down);
      }
      if (previous && Number.isFinite(total.up) && Number.isFinite(previous.up) && total.up >= previous.up) {
        deltaBuckets[index].up.push(total.up - previous.up);
      }
      previous = total;
    }
  }

  const average = (list) => (list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : 0);
  const rateBits = buckets.some((bucket) => bucket.down.length || bucket.up.length);
  const source = rateBits
    ? "rate"
    : deltaBuckets.some((bucket) => bucket.down.length || bucket.up.length)
      ? "total"
      : "none";
  const points = (source === "total" ? deltaBuckets : buckets).map((bucket) => (
    source === "total"
      ? { down: average(bucket.down), up: average(bucket.up) }
      : { down: average(bucket.down) * 3600, up: average(bucket.up) * 3600 }
  ));
  return {
    points,
    source,
    samples,
    hasData: source !== "none",
    totalDown: points.reduce((sum, point) => sum + point.down, 0),
    totalUp: points.reduce((sum, point) => sum + point.up, 0),
  };
}
