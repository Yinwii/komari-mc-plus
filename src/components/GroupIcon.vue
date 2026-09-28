<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import FlagIcon from "./FlagIcon.vue";

/**
 * 分组条左侧图标：按后台 groupIconMode 渲染。
 * - 唯一地区旗（旧行为）：组内所有节点同属一个地区时显示该国旗；
 * - 首节点国旗：取组内第一个节点的地区；
 * - 双旗对拼：按节点数取前两个地区，左右各半拼成一面旗（超过 2 个地区 +N 角标）；
 * - 国旗轮换：单一旗位每 3 秒渐隐渐显轮换组内各地区；
 * - 主旗+角标：节点数最多地区的国旗 + 覆盖地区数角标。
 */

const props = defineProps({
  group: { type: Object, required: true },
  mode: { type: String, default: "唯一地区旗" },
});

const MODES = ["唯一地区旗", "首节点国旗", "双旗对拼", "国旗轮换", "主旗+角标"];
const mode = computed(() => (MODES.includes(props.mode) ? props.mode : "唯一地区旗"));

// regions: [{ region, count }]，getGroupsFromNodes 已按节点数降序。
const regions = computed(() => (Array.isArray(props.group.regions) ? props.group.regions.filter((item) => item && item.region) : []));

// 唯一地区旗：沿用 group.region（仅组内地区唯一时非空）。
const uniqueRegion = computed(() => (mode.value === "唯一地区旗" ? props.group.region : ""));
const firstRegion = computed(() => (mode.value === "首节点国旗" ? props.group.firstRegion : ""));
const topRegion = computed(() => (mode.value === "主旗+角标" && regions.value.length ? regions.value[0].region : ""));
const splitRegions = computed(() => (mode.value === "双旗对拼" ? regions.value.slice(0, 2) : []));
const extraRegions = computed(() => Math.max(0, regions.value.length - 2));

// 国旗轮换：单一旗位定时轮换；无地区时不启动。
const rotateRegions = computed(() => (mode.value === "国旗轮换" ? regions.value.map((item) => item.region) : []));
const rotateIndex = ref(0);
let rotateTimer = null;

onMounted(() => {
  if (rotateRegions.value.length > 1) {
    rotateTimer = setInterval(() => {
      rotateIndex.value = (rotateIndex.value + 1) % rotateRegions.value.length;
    }, 3000);
  }
});

onBeforeUnmount(() => {
  if (rotateTimer) clearInterval(rotateTimer);
});

const rotateRegion = computed(() => (rotateRegions.value.length ? rotateRegions.value[rotateIndex.value % rotateRegions.value.length] : ""));

const badgeCount = computed(() => {
  if (mode.value === "主旗+角标") return regions.value.length > 1 ? regions.value.length : 0;
  if (mode.value === "双旗对拼" && extraRegions.value > 0) return `+${extraRegions.value}`;
  return 0;
});
</script>

<template>
  <span v-if="uniqueRegion || firstRegion || topRegion" class="group-flag">
    <FlagIcon :code="uniqueRegion || firstRegion || topRegion" :label="`${group.code} 分组图标`" />
    <span v-if="badgeCount" class="group-flag-badge">{{ badgeCount }}</span>
  </span>
  <span v-else-if="splitRegions.length" class="group-flag group-flag-split" :class="{ 'has-badge': extraRegions > 0 }">
    <FlagIcon v-for="item in splitRegions" :key="item.region" :code="item.region" :label="`${group.code} 分组图标`" class="split-half" />
    <span v-if="extraRegions > 0" class="group-flag-badge">+{{ extraRegions }}</span>
  </span>
  <span v-else-if="rotateRegion" class="group-flag group-flag-rotate">
    <Transition name="flag-fade" mode="out-in">
      <FlagIcon :key="rotateRegion" :code="rotateRegion" :label="`${group.code} 分组图标`" />
    </Transition>
  </span>
  <span v-else class="flag-fallback" aria-hidden="true" />
</template>
