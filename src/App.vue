<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Toolbar from "./components/Toolbar.vue";
import OverviewCards from "./components/OverviewCards.vue";
import GroupFilter from "./components/GroupFilter.vue";
import NodeCard from "./components/NodeCard.vue";
import NodeListView from "./components/NodeListView.vue";
import NodeDetails from "./components/NodeDetails.vue";
import RemainingValuePanel from "./components/RemainingValuePanel.vue";
import ValueCalculatorModal from "./components/ValueCalculatorModal.vue";
import VisitorCard from "./components/VisitorCard.vue";
import { LayoutGrid, Rows3 } from "lucide-vue-next";
import { fetchLatestStats, fetchSnapshot, supportsBatchLatestStats, updateNodeRealtime, toNodeModel } from "./services/komariApi.js";
import { getRpcTransportState } from "./services/rpc.js";
import { calculateAssets, fetchExchangeRates } from "./services/assets.js";
import { fetchThemeSettings, fetchPublicSiteName, normalizeSettings, resolveAppearance, syncAdminAppearance } from "./services/themeSettings.js";
import { initWallpaper, loadWallpaperState, setWallpaperEnabled, switchWallpaper as switchBingWallpaper } from "./services/bingWallpaper.js";
import { formatByteRate } from "./utils/format.js";

const APPEARANCE_STORAGE_KEY = "komari-appearance";

function getSystemDark() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

function readAppearance() {
  try {
    const stored = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "mc") return stored;
  } catch {
    // 无法读取偏好时，按系统外观选择初始主题。
  }
  return null;
}

const settings = ref(normalizeSettings());
const settingsError = ref("");
const rates = ref(null);
const localAppearance = ref(readAppearance());
const systemDark = ref(getSystemDark());
const appearance = computed(() => resolveAppearance(localAppearance.value, systemDark.value));
watch(appearance, syncAdminAppearance, { immediate: true, flush: "sync" });
const systemQuery = window.matchMedia("(prefers-color-scheme: dark)");
let settingsInFlight = false;
function syncSystem(event) { systemDark.value = event.matches; }
async function refreshSettings() {
  if (settingsInFlight) return;
  settingsInFlight = true;
  try {
    settings.value = await fetchThemeSettings();
    settingsError.value = "";
  } catch { settingsError.value = "主题设置加载失败，暂用上次配置或默认值"; }
  try {
    publicSiteName.value = await fetchPublicSiteName();
  } catch {
    // 站点名获取失败时保留上次值或默认 Komari。
  }
  if (settings.value.showStatsBar && settings.value.showAssets) {
    try { rates.value = await fetchExchangeRates(); }
    catch { rates.value = null; }
  }
  settingsInFlight = false;
}
function refreshVisibleSettings() {
  if (document.visibilityState === "visible") void refreshSettings();
}
const isMinecraftTheme = computed(() => appearance.value === "mc");
const isDark = computed(() => appearance.value === "dark");
const faviconUrl = computed(() => {
  const custom = String(settings.value.favicon || "").trim();
  return custom || "/favicon.ico";
});
/** favicon 缺失时的内置兜底图标，避免左上角出现破图。 */
const FALLBACK_ICON = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%234f8ccb'/%3E%3Crect x='7' y='8' width='18' height='12' rx='2' fill='%23e8f1fa'/%3E%3Crect x='12' y='22' width='8' height='3' rx='1.5' fill='%23e8f1fa'/%3E%3C/svg%3E";
function onFaviconError(event) {
  const img = event.target;
  if (img.dataset.fallback) return;
  img.dataset.fallback = "1";
  img.src = FALLBACK_ICON;
}
const siteName = computed(() => {
  const custom = String(settings.value.siteName || "").trim();
  return custom || publicSiteName.value || "Komari";
});
const publicSiteName = ref("");
// 站点名/favicon 联动浏览器标题与标签图标。
watch([siteName, faviconUrl], ([name, icon]) => {
  document.title = name === "Komari" ? "Komari Monitor" : name;
  let link = document.querySelector("link[rel~='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  if (link.getAttribute("href") !== icon) link.setAttribute("href", icon);
}, { immediate: true });
const showValuePanel = ref(false);
const calcCardUuids = ref([]);
function openCalcCard(uuid) {
  calcCardUuids.value = [uuid];
}
const wallpaper = ref(loadWallpaperState());
const wallpaperSwitching = ref(false);
const toast = ref("");
let toastTimer = 0;
function showToast(message, ms = 2600) {
  toast.value = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.value = "";
  }, ms);
}
const wallpaperStyle = computed(() => {
  const url = wallpaper.value.enabled ? wallpaper.value.url : "";
  return url ? { backgroundImage: `url("${url}")` } : {};
});
async function onSwitchWallpaper() {
  if (wallpaperSwitching.value) return;
  wallpaperSwitching.value = true;
  try {
    const next = await switchBingWallpaper();
    if (next) {
      wallpaper.value = { ...loadWallpaperState() };
      showToast(`已切换壁纸：${next.title || "Bing 壁纸"}`);
    } else {
      console.warn("[Wallpaper] 所有 Bing 图源均不可用");
      showToast("壁纸源暂时不可用，稍后再试（右键可关闭壁纸）");
    }
  } finally {
    wallpaperSwitching.value = false;
  }
}
function onToggleWallpaper() {
  wallpaper.value = setWallpaperEnabled(!wallpaper.value.enabled);
  showToast(wallpaper.value.enabled ? "已开启 Bing 壁纸" : "已关闭壁纸");
}
const activeGroup = ref("all");
const VIEW_MODE_KEY = "komari-view-mode";
const viewMode = ref(readViewMode());
function readViewMode() {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === "list" ? "list" : "card";
  } catch {
    return "card";
  }
}
function setViewMode(mode) {
  viewMode.value = mode;
  try {
    localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    // 存储不可用时仅本次会话生效。
  }
}
const selectedNode = ref(null);
const isLoading = ref(true);
const groups = ref([]);
const nodes = ref([]);
const overview = computed(() => getOverviewFromNodes(nodes.value));
// 实时速率历史（字节/秒），供总览"实时速率"卡片绘制迷你走势图。
const SPEED_HISTORY_MAX = 60;
const speedHistory = ref([]);
watch(nodes, () => {
  const up = nodes.value.reduce((sum, node) => sum + (Number(node.up) || 0), 0);
  const down = nodes.value.reduce((sum, node) => sum + (Number(node.down) || 0), 0);
  const last = speedHistory.value[speedHistory.value.length - 1];
  if (last && last.up === up && last.down === down) return;
  speedHistory.value = [...speedHistory.value, { up, down }].slice(-SPEED_HISTORY_MAX);
});
const isDemoMode = ref(false);
const filteredNodes = ref(nodes.value);
const errorMessage = ref("");
let refreshTimer;
let refreshInFlight = false;
let refreshStopped = false;
let realtimeTimer;
let realtimeInFlight = false;
let lastHttpFallbackAt = 0;

function persistAppearance(value) {
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, value);
  } catch {
    // 浏览器禁用存储时仍保留当前会话主题。
  }
}

function setAppearance(next) {
  localAppearance.value = next;
  persistAppearance(next);
}

function findNodeFromLocation() {
  const match = window.location.pathname.match(/^\/instance\/(.+)$/);
  if (!match) return null;
  const uuid = decodeURIComponent(match[1]);
  const node = nodes.value.find((item) => item.uuid === uuid);
  return node || null;
}

function syncRoute() {
  selectedNode.value = findNodeFromLocation();
}

function openNode(node) {
  window.history.pushState({}, "", `/instance/${encodeURIComponent(node.uuid)}`);
  selectedNode.value = node;
}

function closeDetails() {
  window.history.pushState({}, "", "/");
  selectedNode.value = null;
}

/** 点击左上角品牌区：打开当前页面——详情页返回列表，首页则重新加载。 */
function goHome() {
  if (selectedNode.value) {
    window.location.assign("/");
    return;
  }
  window.location.reload();
}

function refreshData() {
  if (isDemoMode.value) return Promise.resolve();
  if (refreshInFlight) return Promise.resolve();
  refreshInFlight = true;
  isLoading.value = true;
  errorMessage.value = "";
  window.clearTimeout(refreshTimer);
  void refreshSettings();
  return fetchSnapshot()
    .then((snapshot) => {
      nodes.value = snapshot.nodes;
      groups.value = getGroupsFromNodes(snapshot.nodes);
      selectGroup(activeGroup.value);
      if (selectedNode.value) {
        selectedNode.value = nodes.value.find((node) => node.uuid === selectedNode.value.uuid) || null;
      } else {
        selectedNode.value = findNodeFromLocation();
      }
    })
    .catch((error) => {
      console.error("[Komari API] 数据刷新失败", error);
      errorMessage.value = `数据刷新失败：${error instanceof Error ? error.message : "未知错误"}`;
    })
    .finally(() => {
      isLoading.value = false;
      refreshInFlight = false;
      if (!refreshStopped) {
        refreshTimer = window.setTimeout(refreshData, 30000);
      }
    });
}

async function refreshRealtimeData() {
  if (refreshStopped || realtimeInFlight || isDemoMode.value || !nodes.value.length || !supportsBatchLatestStats()) return;
  const transport = getRpcTransportState();
  if (transport !== "websocket" && Date.now() - lastHttpFallbackAt < 15000) return;
  realtimeInFlight = true;
  try {
    const latest = await fetchLatestStats(nodes.value.map((node) => node.uuid));
    if (getRpcTransportState() !== "websocket") lastHttpFallbackAt = Date.now();
    nodes.value = await Promise.all(nodes.value.map((node) => updateNodeRealtime(node, latest.get(node.uuid) || [])));
    selectGroup(activeGroup.value);
    if (selectedNode.value) {
      selectedNode.value = nodes.value.find((node) => node.uuid === selectedNode.value.uuid) || null;
    }
  } catch (error) {
    console.warn("[Komari API] 实时状态刷新失败", error);
  } finally {
    realtimeInFlight = false;
  }
}

onMounted(() => {
  systemQuery.addEventListener("change", syncSystem);
  document.addEventListener("visibilitychange", refreshVisibleSettings);
  if (window.location.hash.startsWith("#demo")) isDemoMode.value = true;
  syncRoute();
  window.addEventListener("popstate", syncRoute);
  refreshStopped = false;
  refreshData();
  realtimeTimer = window.setInterval(refreshRealtimeData, 2000);
  void initWallpaper().then(() => { wallpaper.value = { ...loadWallpaperState() }; });
  if (window.location.hash === "#value") showValuePanel.value = true;
  if (window.location.hash === "#list") setViewMode("list");
  if (window.location.hash.startsWith("#demo")) {
    nodes.value = makeDemoNodes();
    groups.value = getGroupsFromNodes(nodes.value);
    selectGroup("all");
    if (window.location.hash === "#demo-value") showValuePanel.value = true;
    if (window.location.hash === "#demo-detail") openNode(nodes.value[0]);
    // 演示模式：轻微抖动速率，驱动实时速率走势图与轮询观感。
    if (!window.location.hash.startsWith("#demo-static")) {
      setInterval(() => {
        nodes.value = nodes.value.map((node) => ({
          ...node,
          up: String(Math.max(0, Number(node.up) + (Math.random() - 0.4) * 4096)),
          down: String(Math.max(0, Number(node.down) + (Math.random() - 0.4) * 12288)),
        }));
      }, 2000);
    }
  }
});
onBeforeUnmount(() => {
  refreshStopped = true;
  systemQuery.removeEventListener("change", syncSystem);
  document.removeEventListener("visibilitychange", refreshVisibleSettings);
  window.removeEventListener("popstate", syncRoute);
  window.clearTimeout(refreshTimer);
  window.clearInterval(realtimeTimer);
});

function selectGroup(group) {
  activeGroup.value = group;
  filteredNodes.value =
    group === "all" ? nodes.value : nodes.value.filter((node) => node.group === group);
}

function getGroupsFromNodes(items) {
  const counts = new Map();
  items.forEach((node) => counts.set(node.group, (counts.get(node.group) || 0) + 1));
  return [...counts].map(([code, count]) => ({ code, count }));
}

/** 无后端时的演示数据：访问 #demo / #demo-value 使用，便于预览与联调。 */
function makeDemoNodes() {
  const day = 86400000;
  const now = Date.now();
  const demoStats = {
    online: true, cpu: { usage: 12.5 }, ram: { used: 1024 ** 3, total: 4 * 1024 ** 3 },
    disk: { used: 20 * 1024 ** 3, total: 80 * 1024 ** 3 },
    network: { up: 2048, down: 8192, totalUp: 34.7 * 1024 ** 3, totalDown: 35.2 * 1024 ** 3 },
    connections: { tcp: 12, udp: 5 }, process: 93, uptime: 62 * 86400 + 16 * 3600,
    load: { load1: 0.1, load5: 0.03, load15: 0.01 }, updated_at: new Date().toISOString(),
  };
  const raw = (over) => ({
    uuid: "demo", name: "demo", region: "", group: "", os: "Debian 12",
    price: 0, currency: "$", billing_cycle: 365, expired_at: null, traffic_limit: 0,
    cpu_cores: 2, mem_total: 4 * 1024 ** 3, disk_total: 80 * 1024 ** 3,
    latestStats: demoStats,
    ...over,
  });
  return [
    toNodeModel(raw({ uuid: "demo-1", name: "eoefjerqs.colocrossing.cloud", region: "🇺🇸", group: "US", price: 11, currency: "$", billing_cycle: 365, expired_at: new Date(now + 122 * day).toISOString(), traffic_limit: 2 * 1024 ** 4 }), [raw().latestStats]),
    toNodeModel(raw({ uuid: "demo-2", name: "hk-cmi.example.com", region: "🇭🇰", group: "香港 CMI", price: 35, currency: "¥", billing_cycle: 30, expired_at: new Date(now + 18 * day).toISOString(), traffic_limit: 1024 ** 4 }), [raw().latestStats]),
    toNodeModel(raw({ uuid: "demo-3", name: "jp-tokyo.example.com", region: "🇯🇵", group: "JP 东京", os: "AlmaLinux 9", price: 6.5, currency: "$", billing_cycle: 30, expired_at: new Date(now + 60 * day).toISOString() }), [raw().latestStats]),
    toNodeModel(raw({ uuid: "demo-4", name: "de-fra.example.com", region: "德国 法兰克福", group: "欧洲", os: "Debian 11", currency: "€", billing_cycle: 0 }), [raw().latestStats]),
  ];
}

function getOverviewFromNodes(items) {  const online = items.filter((node) => node.status === "online").length;
  const trafficUp = items.reduce((sum, node) => sum + (node.trafficUpBytes || 0), 0);
  const trafficDown = items.reduce((sum, node) => sum + (node.trafficDownBytes || 0), 0);
  const speedUp = items.reduce((sum, node) => sum + (Number(node.up) || 0), 0);
  const speedDown = items.reduce((sum, node) => sum + (Number(node.down) || 0), 0);
  const toGb = (bytes) => (bytes / 1024 ** 3).toFixed(2);
  const uploadRate = formatByteRate(speedUp, "B/s");
  const downloadRate = formatByteRate(speedDown, "B/s");
  const totalRate = formatByteRate(speedUp + speedDown, "B/s");
  return {
    online: { current: online, total: items.length, rate: items.length ? `${((online / items.length) * 100).toFixed(2)}%` : "0%" },
    assets: calculateAssets(items, rates.value),
    traffic: { today: toGb(trafficUp + trafficDown), unit: "GB", upload: `${toGb(trafficUp)} GB`, download: `${toGb(trafficDown)} GB` },
    bandwidth: {
      value: totalRate.value,
      unit: totalRate.unit,
      upload: `${uploadRate.value} ${uploadRate.unit}`,
      download: `${downloadRate.value} ${downloadRate.unit}`,
    },
  };
}
</script>

<template>
  <div class="monitor-app" :class="{ 'is-dark': isDark, 'mc-theme': isMinecraftTheme, 'has-wallpaper': wallpaper.enabled && wallpaper.url }" :style="wallpaperStyle">
    <div v-if="wallpaper.enabled && wallpaper.url" class="wallpaper-overlay" aria-hidden="true" />
    <header class="header">
      <a class="site-brand" href="/" title="返回首页" @click.prevent="goHome">
        <img class="site-icon" :src="faviconUrl" alt="" @error="onFaviconError" />
        <h1>{{ siteName }}</h1>
      </a>
      <Toolbar
        :appearance="appearance"
        :is-loading="isLoading"
        :wallpaper-on="wallpaper.enabled"
        :wallpaper-busy="wallpaperSwitching"
        @set-appearance="setAppearance"
        @refresh="refreshData"
        @open-admin="syncAdminAppearance(appearance)"
        @open-value="showValuePanel = true"
        @switch-wallpaper="onSwitchWallpaper"
        @toggle-wallpaper="onToggleWallpaper"
      />
    </header>
    <section
      v-if="!selectedNode && isLoading && nodes.length === 0"
      class="details-loading"
      aria-live="polite"
      aria-busy="true"
    >
      <span class="loading-spinner" aria-hidden="true" />
      <p>加载节点...</p>
    </section>
    <main v-else-if="!selectedNode" :aria-busy="isLoading">
      <OverviewCards :overview="overview" :settings="settings" :speed-history="speedHistory" />
      <p v-if="settingsError && !isDemoMode" class="data-error" role="alert">{{ settingsError }}</p>
      <p v-if="errorMessage && !isDemoMode" class="data-error" role="alert">{{ errorMessage }}</p>
      <div class="node-filters">
        <GroupFilter
          :groups="groups"
          :active-group="activeGroup"
          @select="selectGroup"
        />
        <div class="view-switch" role="tablist" aria-label="视图切换">
          <button :class="{ active: viewMode === 'card' }" :aria-pressed="viewMode === 'card'" title="卡片视图" aria-label="卡片视图" @click="setViewMode('card')"><LayoutGrid :size="16" :stroke-width="1.8" /></button>
          <button :class="{ active: viewMode === 'list' }" :aria-pressed="viewMode === 'list'" title="列表视图" aria-label="列表视图" @click="setViewMode('list')"><Rows3 :size="16" :stroke-width="1.8" /></button>
        </div>
      </div>
      <section v-if="viewMode === 'card'" class="node-grid">
        <NodeCard
          v-for="node in filteredNodes"
          :key="node.name"
          :node="node"
          :settings="settings"
          @select="openNode"
        />
      </section>
      <NodeListView v-else :nodes="filteredNodes" @select="openNode" />
      <p v-if="!isLoading && !errorMessage && filteredNodes.length === 0" class="empty-state">暂无节点</p>
    </main>
    <NodeDetails
      v-if="selectedNode"
      :node="selectedNode"
      :hosts="nodes"
      :is-dark="isDark"
      :is-minecraft="isMinecraftTheme"
      @close="closeDetails"
      @select-host="openNode(nodes.find((node) => node.uuid === $event))"
      @open-calc="openCalcCard"
    />
    <RemainingValuePanel v-if="showValuePanel" :nodes="nodes" @close="showValuePanel = false" @open-calc="openCalcCard" />
    <ValueCalculatorModal v-if="calcCardUuids.length" :nodes="nodes" :initial-uuids="calcCardUuids" @close="calcCardUuids = []" />
    <VisitorCard />
    <Transition name="toast-fade">
      <p v-if="toast" class="app-toast" role="status" aria-live="polite">{{ toast }}</p>
    </Transition>
  </div>
</template>
