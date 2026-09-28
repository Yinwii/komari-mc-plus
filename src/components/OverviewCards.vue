<script setup>
import { computed } from "vue";
import AppIcon from "./AppIcon.vue";

const props = defineProps({
  overview: { type: Object, required: true },
  settings: { type: Object, required: true },
  speedHistory: { type: Array, default: () => [] },
});

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
</script>

<template>
  <section v-if="settings.showStatsBar && (settings.showOnline || settings.showAssets || settings.showTraffic || settings.showSpeed)" class="overview-grid">
    <div v-if="settings.showOnline" class="overview-card">
      <div class="overview-label">在线节点</div>
      <div class="overview-value">
        {{ overview.online.current
        }}<small>/ {{ overview.online.total }}</small>
      </div>
      <p class="overview-status"><b />在线率 {{ overview.online.rate }}</p>
      <span class="overview-icon"><AppIcon name="server" :size="22" /></span>
    </div>
    <div v-if="settings.showAssets" class="overview-card">
      <div class="overview-label">剩余价值</div>
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
