<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Check, Copy, ImageDown, Plus, X } from "lucide-vue-next";
import { fetchExchangeRates, aliases } from "../services/assets.js";
import { buildHtmlReport, buildTextReport, computeNodeValue, cnyRatio, summarizeValues } from "../utils/valueCalc.js";
import { renderValueImage } from "../utils/valueImage.js";
import { setPremiumMode, usePremiumMode } from "../utils/premiumMode.js";
import SelectMenu from "./SelectMenu.vue";

const props = defineProps({
  nodes: { type: Array, required: true },
  initialUuids: { type: Array, default: () => [] },
});
const emit = defineEmits(["close"]);

const OVERRIDES_KEY = "komari-value-overrides-v1";
const CONFIG_FIELDS_KEY = "komari-value-config-fields-v1";
const MAX_CARDS = 4;

/** 复制/图片可附带的服务器配置项（Komari 不提供端口带宽数据，故无该项）。 */
const CONFIG_FIELDS = [
  { key: "cpu", label: "CPU" },
  { key: "ram", label: "内存" },
  { key: "disk", label: "硬盘" },
  { key: "traffic", label: "月流量" },
];

const CURRENCY_OPTIONS = [
  { symbol: "¥", code: "CNY", label: "CNY 人民币" },
  { symbol: "$", code: "USD", label: "USD 美元" },
  { symbol: "€", code: "EUR", label: "EUR 欧元" },
  { symbol: "£", code: "GBP", label: "GBP 英镑" },
  { symbol: "HK$", code: "HKD", label: "HKD 港币" },
  { symbol: "₽", code: "RUB", label: "RUB 卢布" },
  { symbol: "₹", code: "INR", label: "INR 卢比" },
  { symbol: "฿", code: "THB", label: "THB 泰铢" },
  { symbol: "₫", code: "VND", label: "VND 越南盾" },
];

/** jsq 风格周期按钮（含长期；自定义天数走总面板）。 */
const CYCLE_PILLS = [
  { days: 30, label: "月付" },
  { days: 90, label: "季付" },
  { days: 180, label: "半年" },
  { days: 365, label: "年付" },
  { days: 730, label: "两年" },
  { days: 1095, label: "三年" },
  { days: -1, label: "长期" },
];

function loadOverrides() {
  try {
    const raw = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function loadConfigFields() {
  const defaults = { cpu: true, ram: true, disk: true, traffic: true };
  try {
    const raw = JSON.parse(localStorage.getItem(CONFIG_FIELDS_KEY) || "{}");
    return raw && typeof raw === "object" ? { ...defaults, ...raw } : defaults;
  } catch {
    return defaults;
  }
}

const overrides = ref(loadOverrides());
const configFields = ref(loadConfigFields());
const premiumMode = usePremiumMode();
const rates = ref(null);
const now = ref(Date.now());
const toastMessage = ref("");
const busyCard = ref("");
let toastTimer;
let cardSeq = 1;

function persistOverrides() {
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides.value));
  } catch {
    // 存储不可用时仅保留本次会话。
  }
}

function patchOverride(uuid, patch) {
  overrides.value = { ...overrides.value, [uuid]: { ...overrides.value[uuid], ...patch } };
  persistOverrides();
}

function persistConfigFields() {
  try {
    localStorage.setItem(CONFIG_FIELDS_KEY, JSON.stringify(configFields.value));
  } catch {
    // 存储不可用时仅保留本次会话。
  }
}

function toggleConfigField(key) {
  configFields.value = { ...configFields.value, [key]: !configFields.value[key] };
  persistConfigFields();
}

const allConfigSelected = computed(() => CONFIG_FIELDS.every((option) => configFields.value[option.key]));

/** 「全部」勾选：全选中时点击取消全部，否则一键全选。 */
function toggleAllConfigFields() {
  const next = !allConfigSelected.value;
  configFields.value = Object.fromEntries(CONFIG_FIELDS.map((option) => [option.key, next]));
  persistConfigFields();
}

/** 按勾选拼接配置描述行（用于复制文本与图片）。 */
function buildConfigLine(row) {
  const parts = [];
  if (configFields.value.cpu && row.cores > 0) parts.push(`${row.cores}核 CPU`);
  if (configFields.value.ram && row.memoryTotalText) parts.push(`${row.memoryTotalText} 内存`);
  if (configFields.value.disk && row.diskTotalText) parts.push(`${row.diskTotalText} 硬盘`);
  if (configFields.value.traffic && row.trafficLimitText) parts.push(`${row.trafficLimitText}/月 流量`);
  return parts.join(" · ");
}

const anyConfigFieldChecked = computed(() => CONFIG_FIELDS.some((option) => configFields.value[option.key]));

/** 节点是否带任何配置数据（CPU/内存/硬盘/流量任一）。 */
function hasConfigData(row) {
  return Boolean(row.cores || row.memoryTotalText || row.diskTotalText || row.trafficLimitText);
}

/** 可编辑行：节点数据 + 手动修正（币种、溢价模式也支持修正）。 */
const rowByUuid = computed(() => {
  const map = new Map();
  for (const node of props.nodes) {
    const o = overrides.value[node.uuid] || {};
    map.set(node.uuid, {
      uuid: node.uuid,
      name: node.name,
      group: node.group || "",
      currency: String(o.currency ?? node.currency ?? "¥").trim() || "¥",
      price: Number(o.price ?? (node.price > 0 ? node.price : 0)) || 0,
      cycle: Number(o.cycle ?? (Number(node.billingCycle) || 0)),
      expiry: String(o.expiry ?? (node.expiredAt ? String(node.expiredAt).slice(0, 10) : "")),
      // 市价/溢价保留原始字符串，避免输入负号、小数点等中间态被数字归一化清除。
      market: o.market === null || o.market === undefined || o.market === "" ? 0 : o.market,
      // 溢价模式为全局开关（与总面板共用）。
      premiumMode: premiumMode.value,
      manualPremium: o.premium === null || o.premium === undefined || o.premium === "" ? null : o.premium,
      currencyLocked: !o.currency && !(String(node.currency || "").trim()),
      // 服务器配置（复制/图片可选用）
      cores: node.cores || 0,
      memoryTotalText: node.memoryTotalText || "",
      diskTotalText: node.diskTotalText || "",
      trafficLimitText: node.trafficLimitText || "",
    });
  }
  return map;
});

function initialCards() {
  const valid = props.initialUuids.filter((uuid) => rowByUuid.value.has(uuid));
  const uuids = valid.length ? valid : [...rowByUuid.value.keys()].slice(0, 1);
  return uuids.slice(0, MAX_CARDS).map((uuid) => ({ id: cardSeq++, uuid }));
}

const cards = ref([]);

/** 添加一张对比卡片：默认选一个尚未打开的节点。 */
function addCard() {
  if (cards.value.length >= MAX_CARDS) return;
  const used = new Set(cards.value.map((card) => card.uuid));
  const next = [...rowByUuid.value.keys()].find((uuid) => !used.has(uuid)) || [...rowByUuid.value.keys()][0];
  if (next) cards.value = [...cards.value, { id: cardSeq++, uuid: next }];
}

function removeCard(id) {
  cards.value = cards.value.filter((card) => card.id !== id);
}

function cardResult(row) {
  return computeNodeValue(
    {
      uuid: row.uuid, name: row.name, group: row.group, currency: row.currency,
      price: row.price, billingCycle: row.cycle, expiredAt: row.expiry || null,
      market: row.market, premiumMode: row.premiumMode, manualPremium: row.manualPremium,
    },
    now.value,
  );
}

const cardsView = computed(() => cards.value.map((card) => {
  const row = rowByUuid.value.get(card.uuid);
  if (!row) return null;
  const item = cardResult(row);
  const ratio = rates.value ? cnyRatio(row.currency, { ...rates.value, aliases }) : null;
  const convertible = ratio !== null;
  const toCny = (value) => (value === null || !convertible ? null : value * ratio);
  const marketCny = toCny(item.market === null ? null : item.market);
  const valueCny = toCny(item.remainingValue);
  const priceCny = toCny(item.price);
  const totalCny = toCny(item.totalPrice);
  const cyclePercent = item.permanent || !item.cycleDays || item.remainingDays === null
    ? null
    : Math.round(Math.min(100, Math.max(0, (item.remainingDays / item.cycleDays) * 100)));
  return { card, row, item, ratio, valueCny, priceCny, marketCny, totalCny, premiumCny: toCny(item.premium), cyclePercent };
}).filter(Boolean));

function currencyRateText(currency) {
  if (!rates.value || currency === "¥") return "";
  const ratio = cnyRatio(currency, { ...rates.value, aliases });
  return ratio === null ? "汇率暂缺" : `1 ${currency} ≈ ${ratio.toFixed(4)} CNY`;
}

function fmt(value, digits = 2) {
  return value === null || value === undefined ? "—" : value.toFixed(digits);
}

function money(currency, value) {
  return value === null || value === undefined ? "—" : `${currency}${value.toFixed(2)}`;
}

function expiryMin() {
  // 到期日期可自由选择，不设下限。
  return "";
}

function onCyclePill(row, days) {
  patchOverride(row.uuid, { cycle: days });
}

function onCurrencyChange(row, symbol) {
  const option = CURRENCY_OPTIONS.find((item) => item.symbol === symbol);
  if (option) patchOverride(row.uuid, { currency: option.symbol });
}

const currencyChoices = CURRENCY_OPTIONS.map((option) => ({ value: option.symbol, label: option.label }));
const nodeChoices = computed(() => (props.nodes || []).map((node) => ({ value: node.uuid, label: node.name })));

function onDateChange(row, event) {
  patchOverride(row.uuid, { expiry: event.target.value });
}

/** 溢价输入：保留原始字符（负号、小数点等中间态不归一化），计算时再转数字。 */
function onPremiumInput(row, event) {
  const raw = event.target.value.trim();
  patchOverride(row.uuid, { premium: raw === "" ? null : raw });
}

function onMarketInput(row, event) {
  const raw = event.target.value.trim();
  patchOverride(row.uuid, { market: raw === "" ? 0 : raw });
}

/** 溢价金额：带正负号的统一展示（原币种或 CNY）。 */
function premiumText(view) {
  const value = view.item.premium;
  if (value === null) return view.row.premiumMode === "market" ? "填市价后算" : "填溢价后算";
  const sign = value > 0 ? "+" : "";
  if (view.premiumCny === null) return `${sign}${money(view.row.currency, value)}`;
  return `${sign}¥${fmt(view.premiumCny)}`;
}

/** 总价 = 剩余价值 + 溢价。 */
function totalText(view) {
  const value = view.item.totalPrice;
  if (value === null) return "—";
  if (view.totalCny === null) return money(view.row.currency, value);
  return `¥${fmt(view.totalCny)}`;
}

function meta() {
  return {
    title: "VPS 剩余价值评估",
    dateText: new Date(now.value).toLocaleString("zh-CN", { hour12: false }),
    footer: "由 Komari 面板生成",
    rates: rates.value ? { ...rates.value, aliases } : null,
    rateLines: [],
  };
}

async function copyCard(view) {
  const item = { ...view.item, configLine: buildConfigLine(view.row) };
  const summary = summarizeValues([item], rates.value ? { ...rates.value, aliases } : null, now.value);
  const text = buildTextReport([item], summary, { ...meta(), rateLines: currencyRateText(view.row.currency) ? [currencyRateText(view.row.currency)] : [] });
  const html = buildHtmlReport([item], summary, { ...meta(), rateLines: currencyRateText(view.row.currency) ? [currencyRateText(view.row.currency)] : [] });
  try {
    if (window.ClipboardItem && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      })]);
      showToast(`已复制「${view.row.name}」报告`);
    } else {
      await navigator.clipboard.writeText(text);
      showToast("已复制纯文本报告");
    }
  } catch {
    showToast("复制失败，请检查剪贴板权限");
  }
}

async function imageCard(view) {
  busyCard.value = String(view.card.id);
  try {
    const item = { ...view.item, configLine: buildConfigLine(view.row) };
    const summary = summarizeValues([item], rates.value ? { ...rates.value, aliases } : null, now.value);
    const blob = await renderValueImage([item], summary, meta());
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `剩余价值-${view.row.name}-${new Date().toISOString().slice(0, 10)}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    showToast("图片已导出");
  } catch {
    showToast("导出失败，请重试");
  } finally {
    busyCard.value = "";
  }
}

function showToast(message) {
  toastMessage.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastMessage.value = ""; }, 2200);
}

function onKeydown(event) {
  if (event.key === "Escape") emit("close");
}

let clockTimer;

onMounted(async () => {
  cards.value = initialCards();
  document.addEventListener("keydown", onKeydown);
  document.body.style.overflow = "hidden";
  clockTimer = window.setInterval(() => { now.value = Date.now(); }, 30000);
  try {
    rates.value = await fetchExchangeRates();
  } catch {
    rates.value = null;
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
  document.body.style.overflow = "";
  clearTimeout(toastTimer);
  window.clearInterval(clockTimer);
});
</script>

<template>
  <div class="value-modal calc-modal" role="dialog" aria-modal="true" aria-label="剩余价值计算器" @click.self="emit('close')">
    <div class="value-panel calc-panel">
      <header class="value-head calc-head">
        <div>
          <h2>剩余价值计算器</h2>
          <p>调整参数即时重算；点击右上角「添加对比」可同时打开多台服务器同步计算。</p>
        </div>
        <div class="calc-head-actions">
          <button class="value-btn" :disabled="cards.length >= MAX_CARDS" @click="addCard">
            <Plus :size="15" aria-hidden="true" />添加对比
          </button>
          <button class="value-close" aria-label="关闭" @click="emit('close')"><X :size="18" /></button>
        </div>
      </header>

      <div class="calc-config-bar">
        <span class="calc-config-label">⚙️ 复制 / 图片附带服务器配置：</span>
        <label class="calc-config-check is-all" :title="allConfigSelected ? '点击取消全部配置项' : '一键勾选全部配置项'">
          <input
            type="checkbox"
            :checked="allConfigSelected"
            :indeterminate.prop="!allConfigSelected && CONFIG_FIELDS.some((option) => configFields[option.key])"
            @change="toggleAllConfigFields"
          /><b>全部</b>
        </label>
        <label v-for="option in CONFIG_FIELDS" :key="option.key" class="calc-config-check">
          <input type="checkbox" :checked="configFields[option.key]" @change="toggleConfigField(option.key)" />{{ option.label }}
        </label>
        <span class="calc-config-divider" aria-hidden="true" />
        <span class="calc-config-label">🧮 溢价模式：</span>
        <span class="calc-mode-switch" role="group" aria-label="溢价计算方式（全局）">
          <button
            type="button"
            :class="{ active: premiumMode === 'premium' }"
            title="直接填写溢价：总价 = 剩余价值 + 溢价（默认）"
            @click="setPremiumMode('premium')"
          >填溢价</button>
          <button
            type="button"
            :class="{ active: premiumMode === 'market' }"
            title="填写参考市价，系统倒算溢价：溢价 = 市价 − 剩余价值"
            @click="setPremiumMode('market')"
          >按市价</button>
        </span>
      </div>

      <div class="calc-grid" :class="{ 'is-multi': cardsView.length > 1 }">
        <section v-for="view in cardsView" :key="view.card.id" class="calc-card" :class="{ 'is-expired': view.item.expired }">
          <div class="calc-card-head">
            <SelectMenu :model-value="view.row.uuid" :options="nodeChoices" aria-label="选择服务器" @update:model-value="view.card.uuid = $event" />
            <button v-if="cardsView.length > 1" class="calc-card-close" aria-label="移除此卡片" @click="removeCard(view.card.id)"><X :size="14" /></button>
          </div>

          <div v-if="buildConfigLine(view.row)" class="calc-card-config" title="按上方勾选的配置项实时显示">
            🖥 {{ buildConfigLine(view.row) }}
          </div>
          <div v-else-if="anyConfigFieldChecked && !hasConfigData(view.row)" class="calc-card-config is-empty">
            🖥 该节点暂无配置数据
          </div>

          <div class="calc-body">
            <div class="calc-form">
              <div class="calc-field-row">
                <label class="calc-field">
                  <span>💰 续费</span>
                  <span class="value-input-wrap calc-price">
                    <em>{{ view.row.currency }}</em>
                    <input type="number" min="0" step="0.01" placeholder="0.00" :value="view.row.price" @change="patchOverride(view.row.uuid, { price: Math.max(0, Number($event.target.value) || 0) })" />
                  </span>
                </label>
                <label class="calc-field">
                  <span>🪙 币种</span>
                  <SelectMenu :model-value="view.row.currency" :options="currencyChoices" aria-label="币种" @update:model-value="onCurrencyChange(view.row, $event)" />
                </label>
              </div>

              <div class="calc-field">
                <span>🕐 付费周期</span>
                <div class="calc-pills" role="group" aria-label="付费周期">
                  <button
                    v-for="pill in CYCLE_PILLS"
                    :key="pill.days"
                    type="button"
                    :class="{ active: Number(view.row.cycle) === pill.days }"
                    @click="onCyclePill(view.row, pill.days)"
                  >{{ pill.label }}</button>
                </div>
                <small v-if="![30, 90, 180, 365, 730, 1095, -1].includes(Number(view.row.cycle))" class="calc-hint">当前为自定义周期 {{ view.row.cycle }} 天，可在总面板修改</small>
              </div>

              <div class="calc-field-row">
                <label class="calc-field">
                  <span>📅 到期日期</span>
                  <input class="value-input" type="date" :min="expiryMin()" :value="view.row.expiry" @change="onDateChange(view.row, $event)" />
                </label>
                <div class="calc-field">
                  <span class="calc-field-head">
                    <span>{{ premiumMode === "market" ? "🛒 参考市价" : "🧾 溢价" }}</span>
                  </span>
                  <input
                    v-if="view.row.premiumMode === 'premium'"
                    class="value-input"
                    type="text"
                    inputmode="decimal"
                    autocomplete="off"
                    placeholder="正数=加价，负数=折价"
                    :value="view.row.manualPremium ?? ''"
                    @input="onPremiumInput(view.row, $event)"
                  />
                  <input
                    v-else
                    class="value-input"
                    type="text"
                    inputmode="decimal"
                    autocomplete="off"
                    placeholder="可选 · 用于倒算溢价"
                    :value="view.row.market || ''"
                    @input="onMarketInput(view.row, $event)"
                  />
                  <small v-if="view.row.premiumMode === 'premium' && Number(view.row.market) > 0" class="calc-hint">
                    已填参考市价 {{ money(view.row.currency, Number(view.row.market)) }}，切到「按市价」可继续沿用
                  </small>
                  <small v-else-if="view.row.premiumMode === 'premium'" class="calc-hint is-muted">总价 = 剩余价值 + 溢价</small>
                  <small v-else class="calc-hint is-muted">溢价 = 参考市价 − 剩余价值</small>
                </div>
              </div>

              <div class="calc-rate">
                <span>💹 汇率</span>
                <b>{{ view.row.currency === "¥" ? "CNY 基准" : currencyRateText(view.row.currency) || "获取中…" }}</b>
              </div>
            </div>

            <div class="calc-result">
              <div class="calc-result-label">💎 剩余价值（CNY）</div>
              <div v-if="view.item.incomplete" class="calc-hero is-empty">缺信息<small>缺少到期日或周期</small></div>
              <div v-else-if="view.item.permanent" class="calc-hero">长期<small>买断不折旧 · {{ money(view.row.currency, view.item.remainingValue) }}</small></div>
              <div v-else class="calc-hero">
                {{ view.valueCny === null ? money(view.row.currency, view.item.remainingValue) : `¥${fmt(view.valueCny)}` }}
                <small v-if="view.valueCny !== null && view.row.currency !== '¥'">≈ {{ money(view.row.currency, view.item.remainingValue) }}</small>
                <small v-else-if="view.row.currency === '¥'">按原币种计</small>
              </div>

              <div v-if="!view.item.permanent && view.cyclePercent !== null" class="calc-progress">
                <div class="calc-progress-text">
                  <span>⏳ 剩余天数 <b>{{ view.item.expired ? "已过期" : `${view.item.remainingDays} 天` }}</b></span>
                  <span>{{ view.cyclePercent }}%</span>
                </div>
                <div class="calc-progress-bar"><i :style="{ width: `${view.cyclePercent}%` }" /></div>
                <small>到期日 {{ view.row.expiry || "—" }} · 周期 {{ view.item.cycleDays }} 天</small>
              </div>

              <div class="calc-result-grid">
                <div>
                  <span :title="premiumMode === 'market' ? '溢价 = 参考市价 − 剩余价值' : '直接填写的溢价，正数=加价、负数=折价'">
                    🧾 溢价（{{ premiumMode === "market" ? "市价 − 残值" : "直接填" }}）
                  </span>
                  <b :class="{ 'is-neg': view.item.premium > 0, 'is-pos': view.item.premium < 0 }">
                    {{ premiumText(view) }}
                  </b>
                </div>
                <div>
                  <span title="总价 = 剩余价值 + 溢价">💵 总价（剩余价值 + 溢价）</span>
                  <b>{{ totalText(view) }}</b>
                  <small v-if="view.totalCny !== null && view.row.currency !== '¥'" class="calc-total-origin">≈ {{ money(view.row.currency, view.item.totalPrice) }}</small>
                </div>
              </div>

              <div class="calc-card-actions">
                <button class="value-btn" @click="copyCard(view)"><Copy :size="14" aria-hidden="true" />复制文本</button>
                <button class="value-btn" :disabled="busyCard === String(view.card.id)" @click="imageCard(view)"><ImageDown :size="14" aria-hidden="true" />生成图片</button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <footer class="value-foot">
        <Check :size="14" aria-hidden="true" />
        剩余价值 = 单价 × 剩余天数 ÷ 周期天数；总价 = 剩余价值 + 溢价；溢价默认「直接填」（正数加价、负数折价），可用上方「溢价模式」全局切换为按市价倒算；长期/买断不折旧；修改自动记忆并与总面板共用。
      </footer>

      <transition name="value-toast">
        <div v-if="toastMessage" class="value-toast" role="status">{{ toastMessage }}</div>
      </transition>
    </div>
  </div>
</template>
