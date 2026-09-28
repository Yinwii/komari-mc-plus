<script setup>
import { computed, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import FlagIcon from "./FlagIcon.vue";
import { getRegionCode, getRegionDisplayName } from "../utils/region.js";

const props = defineProps({
  overview: { type: Object, required: true },
  settings: { type: Object, required: true },
  speedHistory: { type: Array, default: () => [] },
  nodes: { type: Array, default: () => [] },
});
defineEmits(["open-calc"]);

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
            <span class="rate-track"><span class="rate-fill" :class="regionDotClass(item)" :style="{ width: `${Math.round((item.online / item.total) * 100)}%` }" /></span>
            <em>{{ item.online }}/{{ item.total }}</em>
          </span>
        </template>
      </div>
      <span class="overview-icon"><AppIcon name="server" :size="22" /></span>
    </div>
    <div v-if="settings.showAssets" class="overview-card">
      <div class="overview-label">
        剩余价值
        <button class="overview-calc-btn" type="button" title="打开剩余价值计算器（多卡对比 / 手动修正）" @click="$emit('open-calc')">🧮 计算器</button>
      </div>
      <div class="overview-value">{{ overview.assets.value }}</div>
      <p>{{ overview.assets.forecast }}</p>
      <span class="overview-icon"><AppIcon name="wallet" :size="22" /></span>
    </div>
    <div v-if="settings.showTraffic" class="overview-card">
      <div class="overview-label">累计流量</div>
      <div class="overview-value">
        {{ overview.traffic.today }}<small>{{ overview.traffic.unit }}</small>
      </div>
      <p class="traffic-summary">
        <span class="traffic-upload"><AppIcon name="upload" /> {{ overview.traffic.upload }}</span>
        ·
        <span class="traffic-download"><AppIcon name="download" /> {{ overview.traffic.download }}</span>
      </p>
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
