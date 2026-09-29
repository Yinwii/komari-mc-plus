import assert from "node:assert/strict";
import test from "node:test";
import { buildCycleBuckets, buildExpiryTimeline, buildHourlyTraffic, resolveRecordTime, summarizeLimits, trafficShare } from "../src/utils/overviewCharts.js";
import { formatBytes } from "../src/utils/format.js";
import { summarizeAssets } from "../src/services/assets.js";
import { normalizeRecordPayload } from "../src/services/nodeHistory.js";

const DAY = 86400000;
const NOW = Date.parse("2026-09-29T12:00:00Z");

test("到期时间线按剩余天数升序，买断与缺失到期时间的节点不计入", () => {
  const nodes = [
    { uuid: "c", name: "far", billingCycle: 365, expiredAt: new Date(NOW + 200 * DAY).toISOString() },
    { uuid: "a", name: "urgent", billingCycle: 30, expiredAt: new Date(NOW + 3 * DAY).toISOString() },
    { uuid: "b", name: "soon", billingCycle: 30, expiredAt: new Date(NOW + 20 * DAY).toISOString() },
    { uuid: "d", name: "lifetime", billingCycle: -1 },
    { uuid: "e", name: "no-expiry", billingCycle: 30 },
  ];
  const timeline = buildExpiryTimeline(nodes, NOW, 5);
  assert.deepEqual(timeline.items.map((item) => item.name), ["urgent", "soon", "far"]);
  assert.deepEqual(timeline.items.map((item) => item.days), [3, 20, 200]);
  assert.deepEqual(timeline.items.map((item) => item.level), ["danger", "warning", "ok"]);
  assert.equal(timeline.total, 3);
  assert.equal(timeline.overflow, 0);
  assert.equal(timeline.urgent, 1);
  // 条长表示本计费周期剩余比例：3/30 天。
  assert.equal(timeline.items[0].ratio, 0.1);
  assert.match(timeline.items[0].title, /剩余 3 天/);
});

test("到期时间线超出上限时只返回前 N 台并给出剩余台数", () => {
  const nodes = Array.from({ length: 8 }, (_item, index) => ({
    uuid: `node-${index}`,
    name: `node-${index}`,
    billingCycle: 30,
    expiredAt: new Date(NOW + (index + 1) * DAY).toISOString(),
  }));
  const timeline = buildExpiryTimeline(nodes, NOW, 5);
  assert.equal(timeline.items.length, 5);
  assert.equal(timeline.total, 8);
  assert.equal(timeline.overflow, 3);
  assert.equal(timeline.items[0].name, "node-0");
  // all 保留完整列表供卡片「展开全部」，且仍是升序。
  assert.equal(timeline.all.length, 8);
  assert.deepEqual(timeline.all.map((item) => item.name), nodes.map((item) => item.name));
  // limit 传 Infinity 等价于全部展示，不该出现 overflow。
  const full = buildExpiryTimeline(nodes, NOW, Infinity);
  assert.equal(full.items.length, 8);
  assert.equal(full.overflow, 0);
});

test("记录时间兼容 RFC3339 / 毫秒 / 秒时间戳，字段名兼容 time 与 updated_at", () => {
  const ms = NOW - 2 * 3600000;
  assert.equal(resolveRecordTime({ updated_at: new Date(ms).toISOString() }), ms);
  assert.equal(resolveRecordTime({ time: new Date(ms).toISOString() }), ms);
  assert.equal(resolveRecordTime({ time: ms }), ms);
  assert.equal(resolveRecordTime({ time: Math.floor(ms / 1000) }), ms);
  assert.equal(resolveRecordTime({ time: String(ms) }), ms);
  assert.ok(Number.isNaN(resolveRecordTime({})));
  assert.ok(Number.isNaN(resolveRecordTime({ time: "not-a-date" })));
});

test("记录只有累计总量时用相邻采样差值推算每小时流量", () => {
  const hour = 3600000;
  const records = Array.from({ length: 4 }, (_item, index) => ({
    time: new Date(NOW - (4 - index) * hour).toISOString(),
    network: { totalDown: index * 1024 ** 3, totalUp: index * 1024 ** 2 },
  }));
  const series = buildHourlyTraffic([records], NOW, 24);
  assert.equal(series.hasData, true);
  assert.equal(series.source, "total");
  assert.equal(series.samples, 4);
  // 每次采样间隔 1 小时，累计量增加 1GiB，落在该小时桶里。
  assert.equal(series.totalDown, 3 * 1024 ** 3);
  assert.equal(series.totalUp, 3 * 1024 ** 2);
  const byRate = buildHourlyTraffic([records], NOW, 24);
  assert.equal(byRate.points.length, 24);
});

test("既无速率也无累计量时判定为空，并给出采样数以便界面提示", () => {
  const records = [{ time: new Date(NOW - 3600000).toISOString(), cpu: { usage: 10 } }];
  const series = buildHourlyTraffic([records], NOW, 24);
  assert.equal(series.hasData, false);
  assert.equal(series.source, "none");
  assert.equal(series.samples, 1);
});

test("账期分布柱按剩余天数归入四档，柱高按最大档归一", () => {
  const make = (days) => ({ uuid: `d${days}`, billingCycle: 365, expiredAt: new Date(NOW + days * DAY).toISOString() });
  const buckets = buildCycleBuckets([make(1), make(5), make(20), make(20), make(60), make(300)], NOW);
  assert.deepEqual(buckets.map((bucket) => bucket.label), ["≤7天", "≤30天", "≤90天", "更久"]);
  assert.deepEqual(buckets.map((bucket) => bucket.count), [2, 2, 1, 1]);
  assert.equal(Math.max(...buckets.map((bucket) => bucket.height)), 100);
  assert.equal(buckets[2].height, 50);
  assert.deepEqual(buildCycleBuckets([], NOW).map((bucket) => bucket.height), [0, 0, 0, 0]);
});

test("上下行构成按字节占比取整，零流量时不冒充 0%/100%", () => {
  const split = trafficShare(1024 ** 3, 3 * 1024 ** 3);
  assert.equal(split.downPercent, 75);
  assert.equal(split.upPercent, 25);
  assert.equal(split.empty, false);
  const empty = trafficShare(0, 0);
  assert.equal(empty.empty, true);
  assert.equal(empty.downPercent, 0);
  assert.equal(empty.upPercent, 0);
});

test("限额用量环只统计设置过流量限额的节点", () => {
  const nodes = [
    { trafficLimitBytes: 2 * 1024 ** 4, trafficUpBytes: 1024 ** 4, trafficDownBytes: 1024 ** 4 },
    { trafficLimitBytes: 0, trafficUpBytes: 5 * 1024 ** 4, trafficDownBytes: 5 * 1024 ** 4 },
    { trafficLimitBytes: 1024 ** 4, trafficUpBytes: 0, trafficDownBytes: 0 },
  ];
  const summary = summarizeLimits(nodes);
  assert.equal(summary.configured, 2);
  assert.equal(summary.total, 3);
  assert.equal(summary.limitBytes, 3 * 1024 ** 4);
  assert.equal(summary.usedBytes, 2 * 1024 ** 4);
  assert.equal(summary.percent, 67);
  assert.equal(summary.level, "ok");
  assert.ok(summary.ratio > 0.66 && summary.ratio < 0.67);
  assert.equal(summarizeLimits([{ trafficLimitBytes: 0 }]).percent, 0);
});

test("24 小时流量趋势按小时分桶取平均速率再折算为字节", () => {
  const hour = 3600000;
  const records = [
    { updated_at: new Date(NOW - 24 * hour + 30 * 60000).toISOString(), network: { up: 0, down: 3600 } },
    { updated_at: new Date(NOW - 24 * hour + 50 * 60000).toISOString(), network: { up: 0, down: 7200 } },
    { updated_at: new Date(NOW - 2 * hour).toISOString(), network: { up: 1800, down: 0 } },
    // 超出 24 小时窗口的记录必须被丢弃。
    { updated_at: new Date(NOW - 30 * hour).toISOString(), network: { up: 9999, down: 9999 } },
  ];
  const series = buildHourlyTraffic([records], NOW, 24);
  assert.equal(series.hasData, true);
  assert.equal(series.points.length, 24);
  assert.equal(series.points[0].down, 5400 * 3600);
  assert.equal(series.points[22].up, 1800 * 3600);
  assert.equal(series.totalDown, 5400 * 3600);

  const empty = buildHourlyTraffic([], NOW, 24);
  assert.equal(empty.hasData, false);
  assert.equal(empty.totalDown, 0);
});

test("真实扁平记录（net_in/net_out）直接按速率折算为每小时流量", () => {
  const hour = 3600000;
  // 服务端 models.Record 的真实形状：扁平字段 + time，没有嵌套 network。
  const records = [
    { time: new Date(NOW - 3 * hour).toISOString(), net_in: 3600, net_out: 1800, net_total_down: 1000, net_total_up: 500 },
    { time: new Date(NOW - 2 * hour).toISOString(), net_in: 7200, net_out: 3600, net_total_down: 2000, net_total_up: 1000 },
  ];
  const series = buildHourlyTraffic([records], NOW, 24);
  assert.equal(series.hasData, true);
  assert.equal(series.source, "rate");
  assert.equal(series.samples, 2);
  assert.equal(series.empty, false);
  // 24 小时窗口自 NOW-24h 起算：3 小时前的样本落在第 21 个桶。
  assert.equal(series.points[21].down, 3600 * 3600);
  assert.equal(series.points[22].down, 7200 * 3600);
  assert.equal(series.totalDown, (3600 + 7200) * 3600);
  assert.equal(series.totalUp, (1800 + 3600) * 3600);
});

test("只有扁平累计量（net_total_down/up）时按相邻采样差值推算", () => {
  const hour = 3600000;
  const records = [
    { time: new Date(NOW - 3 * hour).toISOString(), net_total_down: 0, net_total_up: 0 },
    { time: new Date(NOW - 2 * hour).toISOString(), net_total_down: 1024 ** 3, net_total_up: 1024 ** 2 },
    { time: new Date(NOW - 1 * hour).toISOString(), net_total_down: 3 * 1024 ** 3, net_total_up: 2 * 1024 ** 2 },
  ];
  const series = buildHourlyTraffic([records], NOW, 24);
  assert.equal(series.source, "total");
  assert.equal(series.empty, false);
  assert.equal(series.points[22].down, 1024 ** 3);
  assert.equal(series.points[23].down, 2 * 1024 ** 3);
  assert.equal(series.totalUp, 2 * 1024 ** 2);
});

test("只有计费周期流量计数（traffic_down/up）时退化为差值推算", () => {
  const hour = 3600000;
  const records = [
    { time: new Date(NOW - 2 * hour).toISOString(), traffic_down: 10 * 1024 ** 3, traffic_up: 1024 ** 3 },
    { time: new Date(NOW - 1 * hour).toISOString(), traffic_down: 10.5 * 1024 ** 3, traffic_up: 1024 ** 3 + 1024 ** 2 },
  ];
  const series = buildHourlyTraffic([records], NOW, 24);
  assert.equal(series.source, "total");
  assert.equal(series.empty, false);
  assert.equal(series.points[23].down, 0.5 * 1024 ** 3);
  assert.equal(series.points[23].up, 1024 ** 2);
});

test("速率为 0 但累计量在增长时自动切到差值来源，不误判为零流量", () => {
  const hour = 3600000;
  const records = [
    { time: new Date(NOW - 2 * hour).toISOString(), net_in: 0, net_out: 0, net_total_down: 500, net_total_up: 0 },
    { time: new Date(NOW - 1 * hour).toISOString(), net_in: 0, net_out: 0, net_total_down: 1500, net_total_up: 0 },
  ];
  const series = buildHourlyTraffic([records], NOW, 24);
  assert.equal(series.source, "total");
  assert.equal(series.empty, false);
  assert.equal(series.points[23].down, 1000);
});

test("速率字段恒为 0 时标记为空流量，交给界面显示文案而不是贴底直线", () => {
  const records = [{ time: new Date(NOW - 3600000).toISOString(), net_in: 0, net_out: 0 }];
  const series = buildHourlyTraffic([records], NOW, 24);
  assert.equal(series.hasData, true);
  assert.equal(series.empty, true);
  assert.equal(series.totalDown, 0);
});

test("历史记录载荷兼容数组与「按 uuid 分组对象」两种形状", () => {
  const a = { time: "2026-09-29T10:00:00Z", net_in: 1 };
  const b = { time: "2026-09-29T10:00:00Z", net_in: 2 };
  // public:getRecordsByUUID 返回扁平数组；common:getRecords 返回按 uuid 分组的对象。
  assert.deepEqual(normalizeRecordPayload({ records: [a] }), [a]);
  assert.deepEqual(normalizeRecordPayload([a]), [a]);
  assert.deepEqual(normalizeRecordPayload({ records: { "uuid-1": [a], "uuid-2": [b] } }), [a, b]);
  // 分组内的非对象元素与空载荷必须安全过滤。
  assert.deepEqual(normalizeRecordPayload({ records: { u: [a, null, 3] } }), [a]);
  assert.deepEqual(normalizeRecordPayload({ records: null }), []);
  assert.deepEqual(normalizeRecordPayload(undefined), []);
});

test("剩余价值比例条：比例夹取在 0-1，买断计入总价值与剩余", () => {
  const nodes = [
    { price: 70, currency: "¥", billingCycle: -1 },
    { price: 10, currency: "$", billingCycle: 30, expiredAt: new Date(NOW + 15 * DAY).toISOString() },
  ];
  const summary = summarizeAssets(nodes, { USD: 1 / 7, CNY: 1 }, NOW);
  assert.equal(summary.total, 140);
  assert.equal(summary.remaining, 105);
  assert.equal(summary.ratio, 0.75);
  assert.equal(summary.complete, true);
  assert.equal(summarizeAssets([{ price: 10, currency: "$", billingCycle: 30 }], { USD: 1 / 7 }).complete, false);
});

test("字节量格式化区分 B/KB/GB 且零值安全", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(undefined), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1024 ** 3), "1.00 GB");
  assert.equal(formatBytes(3 * 1024 ** 4), "3.00 TB");
});
