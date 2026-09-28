import assert from "node:assert/strict";
import test from "node:test";
import { aliases } from "../src/services/assets.js";
import {
  buildHtmlReport,
  buildTextReport,
  computeNodeValue,
  CYCLE_OPTIONS,
  formatDate,
  parseExpiry,
  summarizeValues,
} from "../src/utils/valueCalc.js";

const NOW = Date.parse("2026-09-28T12:00:00+08:00");

function makeNode(overrides = {}) {
  return {
    uuid: "u1",
    name: "测试节点",
    group: "香港",
    currency: "¥",
    price: 365,
    billingCycle: 365,
    expiredAt: "2027-03-28T00:00:00+08:00",
    ...overrides,
  };
}

test("年付节点：剩余半年价值为一半", () => {
  const item = computeNodeValue(makeNode(), NOW);
  assert.equal(item.remainingDays, 181); // 2026-09-28 → 2027-03-28
  assert.equal(item.remainingValue, 365 * (181 / 365));
  assert.ok(Math.abs(item.dailyCost - 1) < 1e-9);
  assert.equal(item.consumed, 365 - item.remainingValue);
  assert.equal(item.incomplete, false);
});

test("长期/买断不折旧", () => {
  const item = computeNodeValue(makeNode({ billingCycle: -1, expiredAt: "2099-01-01" }), NOW);
  assert.equal(item.permanent, true);
  assert.equal(item.remainingValue, 365);
  assert.equal(item.remainingDays, null);
  assert.equal(item.consumed, 0);
  assert.equal(item.incomplete, false);
});

test("已过期节点剩余价值为 0", () => {
  const item = computeNodeValue(makeNode({ expiredAt: "2026-09-01" }), NOW);
  assert.equal(item.expired, true);
  assert.equal(item.remainingDays, 0);
  assert.equal(item.remainingValue, 0);
});

test("缺少到期日或周期时标记为信息不完整", () => {
  assert.equal(computeNodeValue(makeNode({ expiredAt: null }), NOW).incomplete, true);
  assert.equal(computeNodeValue(makeNode({ billingCycle: 0 }), NOW).incomplete, true);
});

test("溢价 = 参考市价 − 剩余价值，未填市价时为 null", () => {
  const withMarket = computeNodeValue(makeNode({ market: 150 }), NOW);
  assert.ok(Math.abs(withMarket.premium - (150 - withMarket.remainingValue)) < 1e-9);
  assert.ok(withMarket.premium < 0); // 剩余价值 ≈181 高于市价 150 → 折价
  assert.equal(computeNodeValue(makeNode(), NOW).premium, null);
});

test("汇总：CNY 折算与币种分组", () => {
  const items = [
    computeNodeValue(makeNode(), NOW),
    computeNodeValue(makeNode({ uuid: "u2", currency: "$", price: 100, billingCycle: 365, expiredAt: "2027-09-28" }), NOW),
  ];
  // er-api 的 CNY 基准汇率：rates.USD = 1 美元兑的人民币数量的倒数（约 1/7）
  const rates = { USD: 1 / 7, aliases };
  const summary = summarizeValues(items, rates, NOW);
  assert.equal(summary.validCount, 2);
  assert.ok(summary.total.cny);
  // 节点1：¥365 × 181/365 = 181；节点2：$100 全年剩余 → $100 × 7 = ¥700
  assert.ok(Math.abs(summary.total.cny.value - (181 + 700)) < 0.01);
  assert.ok(Math.abs(summary.total.cny.price - (365 + 700)) < 0.01);
});

test("汇总：无法获取汇率时按币种分组且 total.cny 为空", () => {
  const items = [computeNodeValue(makeNode(), NOW), computeNodeValue(makeNode({ uuid: "u2", currency: "$", price: 100, billingCycle: -1 }), NOW)];
  const summary = summarizeValues(items, null, NOW);
  assert.equal(summary.total.cny, null);
  assert.equal(summary.total.byCurrency.get("¥").value, 181);
  assert.equal(summary.total.byCurrency.get("$").value, 100);
});

test("文本与 HTML 报告为 jsq 风格 emoji 清单", () => {
  const item = computeNodeValue(makeNode(), NOW);
  const summary = summarizeValues([item], null, NOW);
  const text = buildTextReport([item], summary, { dateText: "2026-09-28 12:00:00" });
  assert.match(text, /## 🐔 VPS 剩余价值/);
  assert.match(text, /- 📅 交易日期：2026-09-28/);
  assert.match(text, /### 🖥 测试节点/);
  assert.match(text, /- 💰 续费价格：365\.00 元\/年付/);
  assert.match(text, /- ⏳ 剩余天数：181天（2027-03-28 到期）/);
  assert.match(text, /- 💎 剩余价值：181\.00元/);
  assert.match(text, /- 🧾 溢价 \/ 总价：— \/ 181\.00元/);
  const html = buildHtmlReport([item], summary, { dateText: "2026-09-28 12:00:00" });
  assert.match(html, /🐔 VPS 剩余价值/);
  assert.match(html, /📅 交易日期：2026-09-28/);
  assert.match(html, /剩余价值：/);
});

test("非 CNY 节点报告带汇率换算", () => {
  const item = computeNodeValue(makeNode({ currency: "$", price: 100, billingCycle: 365, expiredAt: "2027-03-28T00:00:00+08:00" }), NOW);
  const summary = summarizeValues([item], { USD: 1 / 6.7195, aliases }, NOW);
  const text = buildTextReport([item], summary, { dateText: "2026-09-28", rates: { USD: 1 / 6.7195, aliases }, rateLines: ["1 $ ≈ 6.7195 CNY"] });
  assert.match(text, /- 💹 外币汇率：1 \$ ≈ 6\.7195 CNY/);
  assert.match(text, /- 💰 续费价格：100\.00 \$\/年付（约 671\.95 元）/);
  assert.match(text, /- 💎 剩余价值：333\.21元（约 49\.59 \$）/);
});

test("工具函数：周期选项齐全、日期解析与本地格式化", () => {
  assert.equal(CYCLE_OPTIONS.length, 6);
  assert.equal(parseExpiry("2026-01-02"), Date.parse("2026-01-02"));
  assert.equal(parseExpiry("not a date"), null);
  assert.equal(formatDate(Date.parse("2026-01-02T23:30:00+08:00")), "2026-01-02");
});
