<script setup>
import { computed, ref, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import { fetchNodeHistory } from "../services/nodeHistory.js";

const props = defineProps({
  uuid: { type: String, required: true },
});

const TIMELINE_DAYS = 7;
const records = ref([]);
const loading = ref(false);
const failed = ref(false);
let requestId = 0;

/**
 * 按天分桶：以「实际样本数 / 理论期望样本数」的密度判断当天状态
 * （正常 ≥70% · 部分异常 10%~70% · 离线 <10% · 无数据 = 尚未开始上报）。
 */
const buckets = computed(() => {
  const timestamps = records.value
    .map((record) => Date.parse(record.updated_at || record.time))
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);
  if (!timestamps.length) return [];

  // 估计上报间隔（取相邻样本间隔的中位数，下限 30 秒）。
  const gaps = [];
  for (let i = 1; i < timestamps.length; i++) {
    const gap = timestamps[i] - timestamps[i - 1];
    if (gap > 0 && gap < 3600_000) gaps.push(gap);
  }
  gaps.sort((a, b) => a - b);
  const intervalMs = gaps.length ? Math.max(30_000, gaps[Math.floor(gaps.length / 2)]) : 300_000;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const firstDayStart = new Date(timestamps[0]);
  firstDayStart.setHours(0, 0, 0, 0);

  const countByDate = new Map();
  for (const time of timestamps) {
    // 只截掉窗口之后的样本；窗口之前的样本不落入任何桶，自然不参与计数。
    if (time >= todayStart + TIMELINE_DAYS * 86400_000) continue;
    const date = new Date(time);
    const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    countByDate.set(key, (countByDate.get(key) || 0) + 1);
  }

  const result = [];
  for (let i = TIMELINE_DAYS - 1; i >= 0; i--) {
    const dayStart = todayStart - i * 86400_000;
    const date = new Date(dayStart);
    const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    const isToday = i === 0;
    const elapsedMs = isToday ? now.getTime() - dayStart : 86400_000;
    const expected = Math.max(1, Math.round(elapsedMs / intervalMs));
    const sampleCount = countByDate.get(key) || 0;
    const beforeFirstRecord = dayStart < firstDayStart.getTime();

    let status = "no-data";
    let ratio = null;
    if (!beforeFirstRecord) {
      ratio = Math.min(1, sampleCount / expected);
      status = ratio >= 0.7 ? "ok" : ratio >= 0.1 ? "degraded" : "down";
    }
    result.push({
      key,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      title: `${date.toLocaleDateString("zh-CN")}${isToday ? "（今天）" : ""} · 样本 ${sampleCount}/${expected} · ${status === "ok" ? "正常" : status === "degraded" ? "部分异常" : status === "down" ? "离线" : "无数据"}`,
      status,
      width: `${(1 / TIMELINE_DAYS) * 100}%`,
    });
  }
  return result;
});

watch(
  () => props.uuid,
  (uuid) => {
    if (!uuid) return;
    const current = ++requestId;
    loading.value = true;
    failed.value = false;
    fetchNodeHistory(uuid, TIMELINE_DAYS * 24)
      .then((data) => {
        if (current === requestId) records.value = data;
      })
      .catch(() => {
        if (current === requestId) {
          records.value = [];
          failed.value = true;
        }
      })
      .finally(() => {
        if (current === requestId) loading.value = false;
      });
  },
  { immediate: true },
);
</script>

<template>
  <section v-if="!failed && buckets.length" class="uptime-timeline" aria-label="近 7 天在线状态时间轴">
    <header class="timeline-head">
      <h2><AppIcon name="activity" /> 在线状态时间轴 <small>近 7 天</small></h2>
      <div class="timeline-legend" aria-hidden="true">
        <span><i class="is-ok" />正常</span>
        <span><i class="is-degraded" />部分异常</span>
        <span><i class="is-down" />离线</span>
        <span><i class="is-no-data" />无数据</span>
      </div>
    </header>
    <div v-if="loading && !buckets.length" class="timeline-loading">加载中…</div>
    <div v-else class="timeline-track" role="img" aria-label="按天的在线状态条带">
      <i
        v-for="bucket in buckets"
        :key="bucket.key"
        class="timeline-segment"
        :class="`is-${bucket.status}`"
        :style="{ width: bucket.width }"
        :title="bucket.title"
      />
    </div>
    <div class="timeline-dates" aria-hidden="true">
      <span>{{ buckets[0]?.label }}</span>
      <span>{{ buckets[buckets.length - 1]?.label }}（今天）</span>
    </div>
  </section>
</template>
