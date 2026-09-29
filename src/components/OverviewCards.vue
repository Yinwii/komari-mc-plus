<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import FlagIcon from "./FlagIcon.vue";
import { getRegionCode, getRegionDisplayName } from "../utils/region.js";
import { formatBytes } from "../utils/format.js";
import { fetchNodeHistory } from "../services/nodeHistory.js";
import { buildCycleBuckets, buildExpiryTimeline, buildHourlyTraffic, summarizeLimits, trafficShare } from "../utils/overviewCharts.js";

const props = defineProps({
  overview: { type: Object, required: true },
  settings: { type: Object, required: true },
  speedHistory: { type: Array, default: () => [] },
  nodes: { type: Array, default: () => [] },
});
const emit = defineEmits(["open-calc", "select-node"]);

// 参考 komari-theme-ink：速率卡片底部绘制上行/下行迷你面积走势图。
const SPARK_W = 100;
const SPARK_H = 30;

function buildSeries(key) {
  return props.speedHistory.map((point) => Math.max(0, Number(point[key]) || 0));
}

function makePaths(series) {
  if (series.length < 2) return null;
  const max = Math.max(...series, 1);
  const step = SPARK_W / (series.length - 1);
  const points = series.map((value, index) => [
    index * step,
    SPARK_H - 2 - (value / max) * (SPARK_H - 5),
  ]);
  const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${SPARK_W},${SPARK_H} L0,${SPARK_H} Z`;
  return { line, area };
}

const downSeries = computed(() => buildSeries("down"));
const upSeries = computed(() => buildSeries("up"));
const downPaths = computed(() => makePaths(downSeries.value));
const upPaths = computed(() => makePaths(upSeries.value));
const sparkReady = computed(() => Boolean(downPaths.value && upPaths.value));

// 在线节点卡的地区展示：按 GeoIP region 聚合在线/总数，供四种样式使用。
const REGION_MODES = ["国旗墙", "地区胶囊", "点阵地图", "分地区在线率"];
// 访客本地切换的样式记忆：优先于后台默认值。
const REGION_OVERRIDE_KEY = "komari-regions-display-v1";

function readRegionOverride() {
  try {
    const value = JSON.parse(localStorage.getItem(REGION_OVERRIDE_KEY) || "null");
    return REGION_MODES.includes(value) || value === "" ? value : null;
  } catch {
    return null;
  }
}

const localRegionOverride = ref(readRegionOverride());

const regionMode = computed(() => {
  if (localRegionOverride.value !== null) return localRegionOverride.value;
  return REGION_MODES.includes(props.settings.onlineRegionsDisplay) ? props.settings.onlineRegionsDisplay : "";
});

// 右上角按钮循环切换：关闭 → 四种样式 → 关闭，本地记忆。
function cycleRegionMode() {
  const cycle = ["", ...REGION_MODES];
  const next = cycle[(cycle.indexOf(regionMode.value) + 1) % cycle.length];
  localRegionOverride.value = next;
  try {
    localStorage.setItem(REGION_OVERRIDE_KEY, JSON.stringify(next));
  } catch {
    /* 隐私模式等场景下静默跳过 */
  }
}

const regionStats = computed(() => {
  const map = new Map();
  props.nodes.forEach((node) => {
    // 归一化为 ISO 代码：真实数据可能是 emoji /「美国 洛杉矶」等复合串，
    // 点阵图坐标与旗子都按代码匹配，同时合并「US」与「洛杉矶」等写法。
    const code = getRegionCode(node.region);
    if (!code) return;
    const item = map.get(code) || { region: code, total: 0, online: 0 };
    item.total += 1;
    if (node.status === "online") item.online += 1;
    map.set(code, item);
  });
  const list = [...map.values()];
  // 在线多的排前，其次节点多的；最多展示 12 个地区避免卡片膨胀。
  list.sort((a, b) => b.online - a.online || b.total - a.total);
  return list.slice(0, 12);
});

const regionLitCount = computed(() => regionStats.value.filter((item) => item.online > 0).length);

function regionTitle(item) {
  return `${getRegionDisplayName(item.region)}：在线 ${item.online} / ${item.total}`;
}

function regionDotClass(item) {
  if (item.online === 0) return "is-off";
  if (item.online < item.total) return "is-partial";
  return "is-on";
}

// 点阵地图：常用国家/地区的简化点阵坐标（col,row），未收录地区不在地图上显示。
const REGION_MAP_POS = {
  US: [3, 2], CA: [4, 1], MX: [3, 4], BR: [8, 6], AR: [7, 8], CL: [7, 9],
  GB: [10, 2], FR: [10, 3], DE: [11, 2], NL: [10, 2], ES: [9, 4], IT: [11, 4],
  PL: [12, 2], SE: [12, 1], NO: [11, 1], FI: [13, 1], RU: [15, 2], UA: [13, 3],
  TR: [13, 4], AE: [14, 5], SA: [13, 5], IL: [13, 4], EG: [12, 5], ZA: [12, 8],
  IN: [16, 5], PK: [15, 5], KZ: [15, 3], CN: [18, 3], MN: [18, 2], JP: [21, 3],
  KR: [20, 3], HK: [19, 4], TW: [19, 4], MO: [19, 4], SG: [18, 6], MY: [18, 5],
  ID: [19, 7], TH: [17, 5], VN: [18, 5], PH: [19, 5], AU: [20, 8], NZ: [22, 9],
};
const MAP_ROWS = 10;
const MAP_COLS = 24;

// 世界点阵：粗略的陆地分布（X=陆地），用于衬托点亮的地区。
const WORLD_ROWS = [
  "........................",
  "......XX.......XX.......",
  "..XX..XXX..XXXXXXXXXXXX.",
  "..XXXXXXXXXXXXXXXXXXXXXX",
  "...XXXXXXXXXXXXXXX..XX..",
  "....XXXXXXXXXXX.....X...",
  ".....XX..XXXXX..........",
  "..........XXX.......XX..",
  "...................XXX..",
  "........................",
];

const mapDots = computed(() => {
  if (regionMode.value !== "点阵地图") return [];
  const lit = new Set(regionStats.value.filter((item) => item.online > 0).map((item) => item.region));
  const dots = [];
  WORLD_ROWS.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== "X") continue;
      dots.push({ x: c * 9 + 5, y: r * 7.2 + 4, lit: false });
    }
  });
  // 有在线节点的国家覆盖为高亮大点（近似经纬位置）。
  regionStats.value.forEach((item) => {
    const pos = REGION_MAP_POS[item.region];
    if (!pos || item.online === 0) return;
    dots.push({ x: pos[0] * 9 + 5, y: pos[1] * 7.2 + 4, lit: true, region: item.region, title: regionTitle(item) });
  });
  return dots;
});

// ── 剩余价值卡 / 累计流量卡底部图例 ────────────────────────────────
// 与在线卡的地区展示同一套交互：后台给总开关与默认样式，访客用卡片内按钮循环切换并本地记忆。
const ASSETS_CHART_MODES = ["留存比例条", "到期时间线", "账期分布柱"];
const TRAFFIC_CHART_MODES = ["上下行构成", "24h 流量趋势", "限额用量环"];
const ASSETS_CHART_KEY = "komari-assets-chart-v1";
const TRAFFIC_CHART_KEY = "komari-traffic-chart-v1";
// 卡片内按钮用短名，避免在窄卡片里换行。
const CHART_LABELS = {
  留存比例条: "留存条",
  到期时间线: "到期线",
  账期分布柱: "账期柱",
  上下行构成: "构成条",
  "24h 流量趋势": "24h 趋势",
  限额用量环: "用量环",
};

function readChartOverride(key, modes) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value === "" || modes.includes(value) ? value : null;
  } catch {
    return null;
  }
}

function saveChartOverride(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 隐私模式等场景下静默跳过 */
  }
}

const assetsChartOverride = ref(readChartOverride(ASSETS_CHART_KEY, ASSETS_CHART_MODES));
const trafficChartOverride = ref(readChartOverride(TRAFFIC_CHART_KEY, TRAFFIC_CHART_MODES));

// 后台开关：关闭后整块图例（含卡片内切换按钮）都不展示。
const assetsChartEnabled = computed(() => props.settings.assetsChartEnabled !== false);
const trafficChartEnabled = computed(() => props.settings.trafficChartEnabled !== false);

function resolveChartMode(override, fallback, modes) {
  if (override !== null) return override;
  return modes.includes(fallback) ? fallback : "";
}

const assetsChartMode = computed(() => resolveChartMode(assetsChartOverride.value, props.settings.assetsChartStyle, ASSETS_CHART_MODES));
const trafficChartMode = computed(() => resolveChartMode(trafficChartOverride.value, props.settings.trafficChartStyle, TRAFFIC_CHART_MODES));

function chartLabel(mode) {
  return mode ? `${CHART_LABELS[mode]} ⇄` : "＋图例 ⇄";
}

function chartButtonTitle(mode) {
  return mode ? `切换卡片图例样式（当前：${mode}）` : "卡片图例已关闭，点击选择展示样式";
}

function cycleChart(overrideRef, current, modes, key) {
  const cycle = ["", ...modes];
  const next = cycle[(cycle.indexOf(current) + 1) % cycle.length];
  overrideRef.value = next;
  saveChartOverride(key, next);
}

function cycleAssetsChart() {
  cycleChart(assetsChartOverride, assetsChartMode.value, ASSETS_CHART_MODES, ASSETS_CHART_KEY);
}

function cycleTrafficChart() {
  cycleChart(trafficChartOverride, trafficChartMode.value, TRAFFIC_CHART_MODES, TRAFFIC_CHART_KEY);
}

// 剩余价值：比例条 / 到期时间线 / 账期分布柱
const assetsDetail = computed(() => props.overview?.assets || {});
const assetsSharePercent = computed(() => Math.round((Number(assetsDetail.value.ratio) || 0) * 100));
const assetsShareHint = computed(() => {
  const detail = assetsDetail.value;
  if (detail.complete === false) return detail.forecast || "部分节点缺少汇率或计费信息";
  const total = Number(detail.total) || 0;
  if (!total) return "暂无计费中的节点";
  return `剩余 CNY ${(Number(detail.remaining) || 0).toFixed(2)} / 总价值 CNY ${total.toFixed(2)}`;
});

// 到期时间线默认只展示最紧迫的若干台（条数由后台配置），卡片内可展开全部。
const EXPIRY_DEFAULT_LIMIT = 5;
const expiryLimit = computed(() => {
  const raw = String(props.settings.assetsExpiryRows ?? "").trim();
  if (raw === "全部" || raw === "all" || raw === "0") return Infinity;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : EXPIRY_DEFAULT_LIMIT;
});
const expiryExpanded = ref(false);
const expiryTimeline = computed(() => buildExpiryTimeline(props.nodes, Date.now(), expiryLimit.value));
const expiryVisible = computed(() => (expiryExpanded.value ? expiryTimeline.value.all : expiryTimeline.value.items));
const expirySummary = computed(() => {
  const { total, urgent } = expiryTimeline.value;
  if (!total) return "";
  return urgent ? `共 ${total} 台 · 7 天内 ${urgent} 台` : `共 ${total} 台`;
});
function toggleExpiryExpand() {
  expiryExpanded.value = !expiryExpanded.value;
}
function selectNode(item) {
  if (item?.uuid) emit("select-node", item.uuid);
}
const cycleBuckets = computed(() => buildCycleBuckets(props.nodes, Date.now()));

// 累计流量：上下行构成 / 24h 趋势 / 限额用量环
const trafficDetail = computed(() => props.overview?.traffic || {});
const trafficSplit = computed(() => trafficShare(trafficDetail.value.upBytes, trafficDetail.value.downBytes));
const trafficSplitTitle = computed(() => (trafficSplit.value.empty
  ? "暂无累计流量"
  : `下行 ${formatBytes(trafficSplit.value.down)} · 上行 ${formatBytes(trafficSplit.value.up)}`));

const limitSummary = computed(() => summarizeLimits(props.nodes));
const LIMIT_RING_CIRCUMFERENCE = 2 * Math.PI * 18;
const limitRingOffset = computed(() => LIMIT_RING_CIRCUMFERENCE * (1 - limitSummary.value.ratio));

const TRAFFIC_HISTORY_HOURS = 24;
const TRAFFIC_HISTORY_CONCURRENCY = 4;
const TRAFFIC_HISTORY_MAX_NODES = 40;
const trafficHistory = ref(emptyTrafficHistory());
const trafficHistoryLoading = ref(false);
const trafficHistoryError = ref("");
let trafficAbort = null;
let trafficRequestId = 0;

function emptyTrafficHistory() {
  return { points: [], totalDown: 0, totalUp: 0, hasData: false, empty: false, source: "none", samples: 0 };
}

const trafficSparkPoints = computed(() => {
  const { hasData, empty, points } = trafficHistory.value;
  // empty（有采样但 24 小时流量恒为 0）交给占位文案，避免画一条贴底的直线。
  if (!hasData || empty || points.length < 2) return null;
  const max = Math.max(...points.map((point) => Math.max(point.down, point.up)), 1);
  const step = SPARK_W / (points.length - 1);
  const build = (key) => {
    const coords = points.map((point, index) => [index * step, SPARK_H - 2 - (point[key] / max) * (SPARK_H - 5)]);
    const line = coords.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    return { line, area: `${line} L${SPARK_W},${SPARK_H} L0,${SPARK_H} Z` };
  };
  return { down: build("down"), up: build("up") };
});

/** 24 小时趋势需要逐节点拉历史记录，因此只在选中该样式时加载，并按节点 uuid 集合变化触发。 */
async function syncTrafficHistory() {
  const uuids = [...new Set(props.nodes.map((node) => node.uuid).filter(Boolean))].slice(0, TRAFFIC_HISTORY_MAX_NODES);
  trafficAbort?.abort();
  trafficAbort = null;
  if (trafficChartMode.value !== "24h 流量趋势" || !uuids.length) {
    trafficRequestId += 1;
    trafficHistory.value = emptyTrafficHistory();
    trafficHistoryError.value = "";
    trafficHistoryLoading.value = false;
    return;
  }
  const controller = new AbortController();
  trafficAbort = controller;
  const requestId = ++trafficRequestId;
  trafficHistoryLoading.value = true;
  trafficHistoryError.value = "";

  const recordSets = [];
  let failures = 0;
  let lastError = "";
  let cursor = 0;
  const worker = async () => {
    while (cursor < uuids.length && !controller.signal.aborted) {
      const uuid = uuids[cursor];
      cursor += 1;
      try {
        recordSets.push(await fetchNodeHistory(uuid, TRAFFIC_HISTORY_HOURS, controller.signal));
      } catch (error) {
        // 单个节点失败不影响整体趋势；历史服务自带 5 分钟缓存，重复切换样式不会重复请求。
        if (error?.name === "AbortError") return;
        failures += 1;
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(TRAFFIC_HISTORY_CONCURRENCY, uuids.length) }, worker));
  if (controller.signal.aborted || requestId !== trafficRequestId) return;

  let result = buildHourlyTraffic(recordSets, Date.now(), TRAFFIC_HISTORY_HOURS);
  // 全部请求都失败、或记录里没有任何流量字段时，补一次重试，避免启动瞬间的竞态把图例定死成空。
  if (!result.hasData && !controller.signal.aborted) {
    const retrySets = [];
    const retry = async (uuid) => {
      try {
        retrySets.push(await fetchNodeHistory(uuid, TRAFFIC_HISTORY_HOURS));
      } catch {
        /* 重试仍失败则按空结果展示 */
      }
    };
    await Promise.all(uuids.slice(0, 8).map(retry));
    if (controller.signal.aborted || requestId !== trafficRequestId) return;
    const retried = buildHourlyTraffic(retrySets, Date.now(), TRAFFIC_HISTORY_HOURS);
    if (retried.hasData) result = retried;
  }

  trafficHistory.value = result;
  if (!result.hasData) {
    trafficHistoryError.value = failures
      ? `历史数据获取失败（${failures} 个节点）：${lastError || "未知错误"}`
      : result.samples
        ? "历史记录中不含流量字段"
        : "所选节点暂无 24 小时内历史记录";
  }
  trafficHistoryLoading.value = false;
}

function retryTrafficHistory() {
  void syncTrafficHistory();
}

onMounted(() => {
  void syncTrafficHistory();
});

onBeforeUnmount(() => {
  trafficAbort?.abort();
});

// 样式切换立即重新加载；节点增删时也刷新（实时刷新不会改变 uuid 集合，因此不会反复拉历史）。
watch(trafficChartMode, () => {
  void syncTrafficHistory();
});

watch(() => props.nodes.map((node) => node.uuid).join("|"), (_value, previousValue) => {
  if (previousValue === undefined) return;
  void syncTrafficHistory();
});
</script>

<template>
  <section v-if="settings.showStatsBar && (settings.showOnline || settings.showAssets || settings.showTraffic || settings.showSpeed)" class="overview-grid">
    <div v-if="settings.showOnline" class="overview-card" :class="{ 'has-regions': regionMode && regionStats.length }">
      <div class="overview-label">
        在线节点
        <button class="overview-calc-btn overview-style-btn" type="button" :title="regionMode ? `切换地区展示样式（当前：${regionMode}）` : '地区展示已关闭，点击选择展示样式'" @click="cycleRegionMode">{{ regionMode || "显示地区 +" }} ⇄</button>
      </div>
      <div class="overview-value">
        {{ overview.online.current
        }}<small>/ {{ overview.online.total }}</small>
      </div>
      <p class="overview-status"><b />在线率 {{ overview.online.rate }}</p>
      <div v-if="regionMode && regionStats.length" class="overview-regions" :class="`is-${['国旗墙', '地区胶囊', '点阵地图', '分地区在线率'].indexOf(regionMode)}`">
        <template v-if="regionMode === '国旗墙'">
          <span v-for="item in regionStats" :key="item.region" class="region-flag" :class="regionDotClass(item)" :title="regionTitle(item)">
            <FlagIcon :code="item.region" :label="regionTitle(item)" />
          </span>
          <small class="region-hint">点亮 {{ regionLitCount }} / {{ regionStats.length }} 地区</small>
        </template>
        <template v-else-if="regionMode === '地区胶囊'">
          <span v-for="item in regionStats" :key="item.region" class="region-pill" :title="regionTitle(item)">
            <i :class="regionDotClass(item)" />
            <FlagIcon :code="item.region" :label="regionTitle(item)" />
            <em>{{ item.online === 0 ? 0 : item.online < item.total ? `${item.online}/${item.total}` : item.total }}</em>
          </span>
        </template>
        <template v-else-if="regionMode === '点阵地图'">
          <svg class="region-map" viewBox="0 0 216 72" preserveAspectRatio="xMidYMid meet" role="img" aria-label="有在线节点的国家地区点阵地图">
            <circle v-for="(dot, index) in mapDots" :key="index" :cx="dot.x" :cy="dot.y" :r="dot.lit ? 3.2 : 2.4" :class="dot.lit ? 'map-dot is-on' : 'map-dot'" :title="dot.title" />
          </svg>
          <small class="region-hint">点亮 {{ regionLitCount }} / {{ regionStats.length }} 地区</small>
        </template>
        <template v-else>
          <span v-for="item in regionStats" :key="item.region" class="region-rate" :class="regionDotClass(item)" :title="regionTitle(item)">
            <FlagIcon :code="item.region" :label="regionTitle(item)" class="rate-flag" />
            <i class="rate-dot" :class="regionDotClass(item)" />
            <em>{{ item.online }}/{{ item.total }}</em>
          </span>
        </template>
      </div>
      <span class="overview-icon"><AppIcon name="server" :size="22" /></span>
    </div>
    <div v-if="settings.showAssets" class="overview-card" :class="{ 'has-chart': assetsChartEnabled && assetsChartMode }">
      <div class="overview-label">
        剩余价值
        <button
          v-if="assetsChartEnabled"
          class="overview-calc-btn overview-chart-btn"
          type="button"
          :title="chartButtonTitle(assetsChartMode)"
          @click="cycleAssetsChart"
        >{{ chartLabel(assetsChartMode) }}</button>
        <button class="overview-calc-btn" type="button" title="打开剩余价值计算器（多卡对比 / 手动修正）" @click="$emit('open-calc')">🧮 计算器</button>
      </div>
      <div class="overview-value">{{ overview.assets?.value }}</div>
      <p>{{ overview.assets?.forecast }}</p>
      <div v-if="assetsChartMode" class="overview-chart">
        <template v-if="assetsChartMode === '留存比例条'">
          <div class="overview-share" :title="assetsShareHint">
            <span class="share-track"><span class="share-fill" :style="{ width: `${assetsSharePercent}%` }" /></span>
            <em>{{ assetsSharePercent }}%</em>
          </div>
          <small class="chart-hint">{{ assetsShareHint }}</small>
        </template>
        <template v-else-if="assetsChartMode === '到期时间线'">
          <div v-if="expiryTimeline.total" class="expiry-head">
            <small class="expiry-count">{{ expirySummary }}</small>
            <button
              v-if="expiryTimeline.total > expiryTimeline.items.length || expiryExpanded"
              class="expiry-toggle"
              type="button"
              :title="expiryExpanded ? '收起，只看最紧迫的几台' : `展开全部 ${expiryTimeline.total} 台`"
              @click="toggleExpiryExpand"
            >{{ expiryExpanded ? "收起" : `展开 +${expiryTimeline.overflow}` }}</button>
          </div>
          <ul v-if="expiryVisible.length" class="expiry-list">
            <li v-for="item in expiryVisible" :key="item.uuid">
              <button class="expiry-row" type="button" :title="`${item.title} · 点击查看节点详情`" @click="selectNode(item)">
                <span class="expiry-name">{{ item.name }}</span>
                <span class="expiry-track"><i :class="`is-${item.level}`" :style="{ width: `${Math.max(8, item.ratio * 100)}%` }" /></span>
                <em :class="`is-${item.level}`">{{ item.days }}天</em>
              </button>
            </li>
          </ul>
          <small v-else class="chart-hint">暂无可计算的到期信息</small>
        </template>
        <template v-else>
          <div class="cycle-bars">
            <span v-for="bucket in cycleBuckets" :key="bucket.label" class="cycle-bar" :title="bucket.title">
              <span class="bar-track"><i :class="`is-${bucket.level}`" :style="{ height: `${bucket.height}%` }" /></span>
              <em>{{ bucket.count }}</em>
              <small>{{ bucket.label }}</small>
            </span>
          </div>
        </template>
      </div>
      <span class="overview-icon"><AppIcon name="wallet" :size="22" /></span>
    </div>
    <div v-if="settings.showTraffic" class="overview-card" :class="{ 'has-chart': trafficChartEnabled && trafficChartMode }">
      <div class="overview-label">
        累计流量
        <button
          v-if="trafficChartEnabled"
          class="overview-calc-btn overview-chart-btn"
          type="button"
          :title="chartButtonTitle(trafficChartMode)"
          @click="cycleTrafficChart"
        >{{ chartLabel(trafficChartMode) }}</button>
      </div>
      <div class="overview-value">
        {{ overview.traffic?.today }}<small>{{ overview.traffic?.unit }}</small>
      </div>
      <p class="traffic-summary">
        <span class="traffic-upload"><AppIcon name="upload" /> {{ overview.traffic?.upload }}</span>
        ·
        <span class="traffic-download"><AppIcon name="download" /> {{ overview.traffic?.download }}</span>
      </p>
      <div v-if="trafficChartMode" class="overview-chart">
        <template v-if="trafficChartMode === '上下行构成'">
          <div class="overview-share is-split" :title="trafficSplitTitle">
            <span class="split-track">
              <i class="split-down" :style="{ width: `${trafficSplit.downPercent}%` }" />
              <i class="split-up" :style="{ width: `${trafficSplit.upPercent}%` }" />
            </span>
          </div>
          <small class="chart-hint">
            <b class="traffic-download">↓ {{ trafficSplit.downPercent }}%</b>
            ·
            <b class="traffic-upload">↑ {{ trafficSplit.upPercent }}%</b>
            <template v-if="trafficSplit.empty"> · 暂无流量</template>
          </small>
        </template>
        <template v-else-if="trafficChartMode === '24h 流量趋势'">
          <svg v-if="trafficSparkPoints" class="traffic-spark" :viewBox="`0 0 ${SPARK_W} ${SPARK_H}`" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="traffic-spark-down" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#3467bd" stop-opacity="0.32" />
                <stop offset="100%" stop-color="#3467bd" stop-opacity="0.02" />
              </linearGradient>
              <linearGradient id="traffic-spark-up" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#0f9f72" stop-opacity="0.3" />
                <stop offset="100%" stop-color="#0f9f72" stop-opacity="0.02" />
              </linearGradient>
            </defs>
            <path :d="trafficSparkPoints.down.area" fill="url(#traffic-spark-down)" />
            <path :d="trafficSparkPoints.down.line" fill="none" stroke="#3467bd" stroke-width="1.4" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
            <path :d="trafficSparkPoints.up.area" fill="url(#traffic-spark-up)" />
            <path :d="trafficSparkPoints.up.line" fill="none" stroke="#0f9f72" stroke-width="1.4" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
          </svg>
          <span v-else class="chart-placeholder">
            <template v-if="trafficHistoryLoading">正在加载 24 小时流量…</template>
            <template v-else-if="trafficHistory.empty">24 小时内没有流量记录</template>
            <template v-else>
              {{ trafficHistoryError || "暂无历史流量数据" }}
              <button v-if="trafficHistoryError" class="expiry-toggle" type="button" @click="retryTrafficHistory">重试</button>
            </template>
          </span>
          <small v-if="trafficSparkPoints" class="chart-hint">
            24 小时 <b class="traffic-download">↓ {{ formatBytes(trafficHistory.totalDown) }}</b> · <b class="traffic-upload">↑ {{ formatBytes(trafficHistory.totalUp) }}</b>
          </small>
        </template>
        <template v-else>
          <div v-if="limitSummary.configured" class="usage-ring" :title="`已用 / 限额，统计 ${limitSummary.configured} 个已设限额节点`">
            <svg viewBox="0 0 44 44" aria-hidden="true">
              <circle class="ring-track" cx="22" cy="22" r="18" />
              <circle
                class="ring-fill"
                :class="`is-${limitSummary.level}`"
                cx="22"
                cy="22"
                r="18"
                :stroke-dasharray="LIMIT_RING_CIRCUMFERENCE.toFixed(2)"
                :stroke-dashoffset="limitRingOffset.toFixed(2)"
              />
            </svg>
            <span class="ring-text">
              <b :class="`is-${limitSummary.level}`">{{ limitSummary.percent }}%</b>
              <small>已用 {{ formatBytes(limitSummary.usedBytes) }} / {{ formatBytes(limitSummary.limitBytes) }}</small>
            </span>
          </div>
          <span v-else class="chart-placeholder">节点未设置流量限额</span>
        </template>
      </div>
      <span class="overview-icon"><AppIcon name="database" :size="22" /></span>
    </div>
    <div v-if="settings.showSpeed" class="overview-card has-spark">
      <div class="overview-label">实时速率</div>
      <div class="overview-value orange-text">
        {{ overview.bandwidth.value
        }}<small>{{ overview.bandwidth.unit }}</small>
      </div>
      <p>
        <span class="bandwidth-upload"><AppIcon name="upload" /> {{ overview.bandwidth.upload }}</span>
        ·
        <span class="bandwidth-download"><AppIcon name="download" /> {{ overview.bandwidth.download }}</span>
      </p>
      <svg v-if="sparkReady" class="speed-spark" :viewBox="`0 0 ${SPARK_W} ${SPARK_H}`" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="spark-down" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#3467bd" stop-opacity="0.35" />
            <stop offset="100%" stop-color="#3467bd" stop-opacity="0.02" />
          </linearGradient>
          <linearGradient id="spark-up" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#0f9f72" stop-opacity="0.32" />
            <stop offset="100%" stop-color="#0f9f72" stop-opacity="0.02" />
          </linearGradient>
        </defs>
        <path :d="downPaths.area" fill="url(#spark-down)" />
        <path :d="downPaths.line" fill="none" stroke="#3467bd" stroke-width="1.4" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
        <path :d="upPaths.area" fill="url(#spark-up)" />
        <path :d="upPaths.line" fill="none" stroke="#0f9f72" stroke-width="1.4" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
      </svg>
      <span class="overview-icon"><AppIcon name="activity" :size="22" /></span>
    </div>
  </section>
</template>
