<script setup>
import { computed } from "vue";
import FlagIcon from "./FlagIcon.vue";
import SystemIcon from "./SystemIcon.vue";
import { getNodeStatus, getNodeStatusLabel } from "../utils/nodeStatus.js";
import { formatByteRate } from "../utils/format.js";

const props = defineProps({ nodes: { type: Array, required: true } });
defineEmits(["select"]);

function formatTraffic(value) {
  if (!Number.isFinite(value) || value <= 0) return "--";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index > 2 ? 1 : 0)} ${units[index]}`;
}

function trafficText(node) {
  const total = (node.trafficUpBytes || 0) + (node.trafficDownBytes || 0);
  if (!total) return "--";
  return formatTraffic(total);
}

function rateText(value) {
  const rate = formatByteRate(value, "B/s");
  return `${rate.value} ${rate.unit}`;
}

function expiryText(node) {
  const raw = node.expiredAt;
  if (!raw || !Number.isFinite(Date.parse(raw))) return "--";
  const days = Math.ceil((Date.parse(raw) - Date.now()) / 86400000);
  if (days > 36500) return "长期";
  const date = new Date(raw).toLocaleDateString("zh-CN");
  return days > 0 ? `${date} · 剩 ${days} 天` : `${date} · 已到期`;
}

function usageTone(percent) {
  const value = Number(percent) || 0;
  if (value >= 90) return "is-danger";
  if (value >= 70) return "is-warn";
  return "is-ok";
}
</script>

<template>
  <section class="node-table-wrap">
    <table class="node-table">
      <thead>
        <tr>
          <th class="nt-center">状态</th>
          <th>节点</th>
          <th class="nt-metric">CPU</th>
          <th class="nt-metric">内存</th>
          <th class="nt-metric">硬盘</th>
          <th class="nt-right">↑ 上行</th>
          <th class="nt-right">↓ 下行</th>
          <th class="nt-right">总流量</th>
          <th>到期</th>
          <th class="nt-center">详情</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="node in nodes"
          :key="node.uuid"
          role="button"
          tabindex="0"
          @click="$emit('select', node)"
          @keydown.enter="$emit('select', node)"
        >
          <td class="nt-center"><i class="node-status-dot" :class="getNodeStatus(node.status)" :title="getNodeStatusLabel(node.status)" /></td>
          <td class="nt-name">
            <FlagIcon class="nt-flag" :code="node.region || node.group" :label="node.region || node.group" />
            <SystemIcon :system="node.os" />
            <span class="nt-name-text" :title="node.name">{{ node.name }}</span>
          </td>
          <td class="nt-metric">
            <span class="nt-usage"><i :class="usageTone(node.cpu)" :style="{ width: `${Math.min(100, Number(node.cpu) || 0)}%` }" /></span>
            <b>{{ node.cpu }}%</b>
          </td>
          <td class="nt-metric">
            <span class="nt-usage"><i :class="usageTone(node.memory)" :style="{ width: `${Math.min(100, Number(node.memory) || 0)}%` }" /></span>
            <b>{{ node.memory }}%</b>
          </td>
          <td class="nt-metric">
            <span class="nt-usage"><i :class="usageTone(node.disk)" :style="{ width: `${Math.min(100, Number(node.disk) || 0)}%` }" /></span>
            <b>{{ node.disk }}%</b>
          </td>
          <td class="nt-right nt-rate-up">{{ rateText(node.up) }}</td>
          <td class="nt-right nt-rate-down">{{ rateText(node.down) }}</td>
          <td class="nt-right" :title="`出站 ${node.out} · 入站 ${node.in}`">{{ trafficText(node) }}</td>
          <td class="nt-expire">{{ expiryText(node) }}</td>
          <td class="nt-center nt-detail"><button class="nt-detail-btn" type="button" title="查看节点详情" @click.stop="$emit('select', node)">详情</button></td>
        </tr>
      </tbody>
    </table>
    <p v-if="!nodes.length" class="empty-state">暂无节点</p>
  </section>
</template>
