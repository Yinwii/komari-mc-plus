<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Camera, Check, Copy, ImageDown, Search, Share2, X } from "lucide-vue-next";
import { fetchExchangeRates, aliases } from "../services/assets.js";
import {
  buildHtmlReport,
  buildTextReport,
  computeNodeValue,
  cnyRatio,
  CYCLE_OPTIONS,
  summarizeValues,
} from "../utils/valueCalc.js";
import { renderValueImage } from "../utils/valueImage.js";

const props = defineProps({ nodes: { type: Array, required: true } });
const emit = defineEmits(["close"]);

const OVERRIDES_KEY = "komari-value-overrides-v1";

function loadOverrides() {
  try {
    const raw = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function persistOverrides() {
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides.value));
  } catch {
    // 存储不可用时仅保留本次会话。
  }
}

const overrides = ref(loadOverrides());
const selected = ref(new Set());
const search = ref("");
const rates = ref(null);
const now = ref(Date.now());
const toastMessage = ref("");
const busy = ref("");
let toastTimer;
let toastSeq = 0;

const STANDARD_CYCLES = new Set([0, 30, 90, 180, 365, 730, -1]);
const cycleOptions = [{ value: 0, label: "未设置" }, ...CYCLE_OPTIONS];

const rows = computed(() => props.nodes.map((node) => {
  const override = overrides.value[node.uuid] || {};
  return {
    uuid: node.uuid,
    name: node.name,
    group: node.group || "",
    currency: String(node.currency || "¥").trim() || "¥",
    price: Number(override.price ?? (node.price > 0 ? node.price : 0)) || 0,
    cycle: Number(override.cycle ?? (Number(node.billingCycle) || 0)),
    expiry: String(override.expiry ?? (node.expiredAt ? String(node.expiredAt).slice(0, 10) : "")),
    market: Number(override.market ?? 0) || 0,
    hasApiInfo: Boolean(node.price > 0 || node.expiredAt),
  };
}));

const visibleRows = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  if (!keyword) return rows.value;
  return rows.value.filter((row) => row.name.toLowerCase().includes(keyword) || row.group.toLowerCase().includes(keyword));
});

/** 每行的计算结果（无论是否选中都展示明细）。 */
const resultByUuid = computed(() => {
  const map = new Map();
  for (const row of rows.value) {
    map.set(row.uuid, computeNodeValue({
      uuid: row.uuid, name: row.name, group: row.group, currency: row.currency,
      price: row.price, billingCycle: row.cycle,
      expiredAt: row.expiry || null, market: row.market,
    }, now.value));
  }
  return map;
});

const selectedResults = computed(() => rows.value.filter((row) => selected.value.has(row.uuid)).map((row) => resultByUuid.value.get(row.uuid)));

const ratesForCalc = computed(() => (rates.value ? { ...rates.value, aliases } : null));

const summary = computed(() => summarizeValues(selectedResults.value, ratesForCalc.value, now.value));

const totalDailyCost = computed(() => {
  let cny = 0;
  let convertible = ratesForCalc.value !== null;
  for (const item of selectedResults.value) {
    if (item.dailyCost === null) continue;
    const ratio = ratesForCalc.value ? cnyRatio(item.currency, ratesForCalc.value) : null;
    if (ratio === null) { convertible = false; continue; }
    cny += item.dailyCost * ratio;
  }
  return convertible ? cny : null;
});

const allSelected = computed(() => rows.value.length > 0 && selected.value.size === rows.value.length);

const meta = computed(() => ({
  title: "VPS 剩余价值评估",
  dateText: new Date(now.value).toLocaleString("zh-CN", { hour12: false }),
  footer: "由 Komari 面板生成",
}));

const reportItems = computed(() => selectedResults.value);

function showToast(message) {
  const seq = ++toastSeq;
  toastMessage.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (seq === toastSeq) toastMessage.value = "";
  }, 2200);
}

function toggleRow(uuid) {
  const next = new Set(selected.value);
  if (next.has(uuid)) next.delete(uuid);
  else next.add(uuid);
  selected.value = next;
}

function toggleAll() {
  selected.value = allSelected.value ? new Set() : new Set(rows.value.map((row) => row.uuid));
}

function updateRow(uuid, patch) {
  overrides.value = { ...overrides.value, [uuid]: { ...overrides.value[uuid], ...patch } };
  persistOverrides();
}

function onCycleChange(row, event) {
  const value = event.target.value;
  if (value === "__custom") {
    updateRow(row.uuid, { cycle: STANDARD_CYCLES.has(row.cycle) && row.cycle !== 0 && row.cycle !== -1 ? row.cycle : 30 });
  } else {
    updateRow(row.uuid, { cycle: Number(value) });
  }
}

function money(item, key) {
  const value = item[key];
  return value === null || value === undefined ? "—" : `${item.currency}${value.toFixed(2)}`;
}

async function copyText() {
  const text = buildTextReport(reportItems.value, summary.value, meta.value);
  try {
    await navigator.clipboard.writeText(text);
    showToast("已复制纯文本报告");
  } catch {
    showToast("复制失败，请检查剪贴板权限");
  }
}

async function copyRich() {
  const text = buildTextReport(reportItems.value, summary.value, meta.value);
  const html = buildHtmlReport(reportItems.value, summary.value, meta.value);
  try {
    if (window.ClipboardItem && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      })]);
      showToast("已复制带格式报告（可直接粘贴到文档）");
    } else {
      await navigator.clipboard.writeText(text);
      showToast("当前浏览器不支持富文本，已复制纯文本");
    }
  } catch {
    try {
      await navigator.clipboard.writeText(text);
      showToast("已复制纯文本报告");
    } catch {
      showToast("复制失败，请检查剪贴板权限");
    }
  }
}

async function ensureImageBlob() {
  return renderValueImage(reportItems.value, summary.value, meta.value);
}

async function exportImage() {
  if (!reportItems.value.length) return showToast("请先选择节点");
  busy.value = "image";
  try {
    const blob = await ensureImageBlob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `komari-剩余价值-${new Date().toISOString().slice(0, 10)}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    showToast("图片已导出");
  } catch (error) {
    console.warn("[RemainingValue] 导出图片失败", error);
    showToast("导出失败，请重试");
  } finally {
    busy.value = "";
  }
}

async function shareReport() {
  if (!reportItems.value.length) return showToast("请先选择节点");
  const text = buildTextReport(reportItems.value, summary.value, meta.value);
  try {
    if (typeof navigator.share === "function") {
      let file = null;
      try {
        const blob = await ensureImageBlob();
        file = new File([blob], "komari-value.png", { type: "image/png" });
      } catch {
        file = null;
      }
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: meta.value.title, text });
        return;
      }
      await navigator.share({ title: meta.value.title, text });
      return;
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
  }
  await copyRich();
}

function onKeydown(event) {
  if (event.key === "Escape") emit("close");
}

watch(() => props.nodes.length, () => {
  // 新出现的节点默认纳入统计。
  const next = new Set(selected.value);
  for (const row of rows.value) next.add(row.uuid);
  selected.value = next;
});

onMounted(async () => {
  selected.value = new Set(rows.value.map((row) => row.uuid));
  document.addEventListener("keydown", onKeydown);
  document.body.style.overflow = "hidden";
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
});
</script>

<template>
  <div class="value-modal" role="dialog" aria-modal="true" aria-label="剩余价值评估" @click.self="emit('close')">
    <div class="value-panel">
      <header class="value-head">
        <div>
          <h2>剩余价值评估</h2>
          <p>按到期日与计费周期折算 {{ selected.size }} 台已选节点的剩余价值，可手动修正价格与周期（自动记忆）。</p>
        </div>
        <button class="value-close" aria-label="关闭" @click="emit('close')"><X :size="18" /></button>
      </header>

      <section class="value-summary">
        <div class="value-stat is-hero">
          <span class="value-stat-label">合计剩余价值</span>
          <strong v-if="summary.total.cny">¥{{ summary.total.cny.value.toFixed(2) }}</strong>
          <strong v-else-if="summary.total.byCurrency.size">{{ [...summary.total.byCurrency.entries()].map(([cur, b]) => `${cur}${b.value.toFixed(2)}`).join(" / ") }}</strong>
          <strong v-else>—</strong>
          <span v-if="summary.total.cny" class="value-stat-sub">折算 · 购入 ¥{{ summary.total.cny.price.toFixed(2) }}</span>
          <span v-else class="value-stat-sub">未获取汇率，按原币种显示</span>
        </div>
        <div class="value-stat">
          <span class="value-stat-label">日均成本</span>
          <strong>{{ totalDailyCost === null ? "—" : `¥${totalDailyCost.toFixed(2)}` }}</strong>
          <span class="value-stat-sub">所有已选节点合计</span>
        </div>
        <div class="value-stat">
          <span class="value-stat-label">平均剩余</span>
          <strong>{{ summary.avgRemainingDays === null ? "—" : `${Math.round(summary.avgRemainingDays)} 天` }}</strong>
          <span class="value-stat-sub">长期/买断不计入</span>
        </div>
        <div class="value-stat">
          <span class="value-stat-label">溢价合计</span>
          <strong :class="{ 'is-neg': summary.total.cny?.premium > 0, 'is-pos': summary.total.cny?.premium < 0 }">
            {{ summary.total.cny ? `¥${summary.total.cny.premium.toFixed(2)}` : "—" }}
          </strong>
          <span class="value-stat-sub">参考市价 − 剩余价值</span>
        </div>
      </section>

      <div class="value-actions">
        <label class="value-search">
          <Search :size="15" aria-hidden="true" />
          <input v-model="search" type="search" placeholder="搜索节点 / 分组" />
        </label>
        <button class="value-btn" :class="{ 'is-active': allSelected }" @click="toggleAll">
          <Check :size="15" aria-hidden="true" />{{ allSelected ? "取消全选" : "全选" }}
        </button>
        <span class="value-spacer" />
        <button class="value-btn" @click="copyText"><Copy :size="15" aria-hidden="true" />复制文本</button>
        <button class="value-btn" @click="copyRich"><Copy :size="15" aria-hidden="true" />复制富文本</button>
        <button class="value-btn" :disabled="busy === 'image'" @click="exportImage"><ImageDown :size="15" aria-hidden="true" />导出图片</button>
        <button class="value-btn is-primary" @click="shareReport"><Share2 :size="15" aria-hidden="true" />分享</button>
      </div>

      <div class="value-table-wrap">
        <div class="value-row value-row-head" aria-hidden="true">
          <span />
          <span>节点</span><span>单价</span><span>周期</span><span>到期日</span><span>参考市价</span><span>剩余</span><span>剩余价值</span><span>溢价</span>
        </div>
        <div v-if="visibleRows.length === 0" class="value-empty">没有匹配的节点</div>
        <div
          v-for="row in visibleRows"
          :key="row.uuid"
          class="value-row"
          :class="{ 'is-off': !selected.has(row.uuid), 'is-expired': resultByUuid.get(row.uuid)?.expired }"
        >
          <label class="value-check">
            <input type="checkbox" :checked="selected.has(row.uuid)" @change="toggleRow(row.uuid)" />
          </label>
          <span class="value-name" :title="row.name">
            <b>{{ row.name }}</b>
            <small>{{ [row.group, row.hasApiInfo ? "" : "缺计费信息"].filter(Boolean).join(" · ") }}</small>
          </span>
          <span class="value-cell">
            <i class="value-tag">单价</i>
            <span class="value-input-wrap"><em>{{ row.currency }}</em><input type="number" min="0" step="0.01" :value="row.price" @change="updateRow(row.uuid, { price: Math.max(0, Number($event.target.value) || 0) })" /></span>
          </span>
          <span class="value-cell">
            <i class="value-tag">周期</i>
            <select class="value-input" :value="STANDARD_CYCLES.has(row.cycle) ? row.cycle : '__custom'" @change="onCycleChange(row, $event)">
              <option v-for="option in cycleOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
              <option value="__custom">自定义…</option>
            </select>
          </span>
          <span class="value-cell">
            <i class="value-tag">到期日</i>
            <input class="value-input" type="date" :value="row.expiry" @change="updateRow(row.uuid, { expiry: $event.target.value })" />
          </span>
          <span class="value-cell">
            <i class="value-tag">参考市价</i>
            <input class="value-input" type="number" min="0" step="0.01" placeholder="可选" :value="row.market || ''" @change="updateRow(row.uuid, { market: Math.max(0, Number($event.target.value) || 0) })" />
          </span>
          <span class="value-cell is-result">
            <i class="value-tag">剩余</i>
            <b>{{ resultByUuid.get(row.uuid)?.permanent ? "长期" : resultByUuid.get(row.uuid)?.remainingDays === null || resultByUuid.get(row.uuid)?.remainingDays === undefined ? "—" : resultByUuid.get(row.uuid)?.expired ? "已过期" : `${resultByUuid.get(row.uuid)?.remainingDays} 天` }}</b>
          </span>
          <span class="value-cell is-result">
            <i class="value-tag">剩余价值</i>
            <b class="is-value">{{ money(resultByUuid.get(row.uuid) || {}, "remainingValue") }}</b>
          </span>
          <span class="value-cell is-result">
            <i class="value-tag">溢价</i>
            <b :class="resultByUuid.get(row.uuid)?.premium > 0 ? 'is-neg' : resultByUuid.get(row.uuid)?.premium < 0 ? 'is-pos' : ''">{{ money(resultByUuid.get(row.uuid) || {}, "premium") }}</b>
          </span>
        </div>
      </div>

      <footer class="value-foot">
        <Camera :size="14" aria-hidden="true" />
        剩余价值 = 单价 × 剩余天数 ÷ 周期天数；长期/买断不折旧；填写参考市价后计算溢价（正数=市价高于剩余价值）。
      </footer>

      <transition name="value-toast">
        <div v-if="toastMessage" class="value-toast" role="status">{{ toastMessage }}</div>
      </transition>
    </div>
  </div>
</template>
