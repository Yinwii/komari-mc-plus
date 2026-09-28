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
import { getRpcTransportState, setRpcDemoHandler } from "./services/rpc.js";
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
  const target = uuid || nodes.value[0]?.uuid;
  if (target) calcCardUuids.value = [target];
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
    setRpcDemoHandler(mockDemoRpc);
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
  const regions = new Map();
  const firstRegion = new Map();
  items.forEach((node) => {
    counts.set(node.group, (counts.get(node.group) || 0) + 1);
    // 分组旗标：记录组内各地区分布（按出现顺序），供多种分组图标样式使用。
    const code = String(node.region || "").trim();
    if (code) {
      if (!firstRegion.has(node.group)) firstRegion.set(node.group, code);
      const map = regions.get(node.group) || new Map();
      map.set(code, (map.get(code) || 0) + 1);
      regions.set(node.group, map);
    }
  });
  return [...counts].map(([code, count]) => {
    const map = regions.get(code);
    const regionList = map ? [...map].map(([region, regionCount]) => ({ region, count: regionCount })) : [];
    // 节点数多的地区排前；数量相同保持出现顺序。
    regionList.sort((a, b) => b.count - a.count);
    return {
      code,
      count,
      region: regionList.length === 1 ? regionList[0].region : "",
      firstRegion: firstRegion.get(code) || "",
      regions: regionList,
    };
  });
}

/** 无后端时的演示数据：访问 #demo / #demo-value 使用，便于预览与联调。 */
/** 演示模式 RPC 拦截：负载历史（7 天）与 Ping 任务/记录，驱动详情页图表与时间轴。 */
function mockDemoRpc(method, params) {
  if (method === "public:getRecordsByUUID" || method === "common:getRecords") {
    if (params?.type === "ping") return [];
    const hours = Number(params?.hours) || 1;
    const count = Math.min(2000, Math.max(30, Math.round(hours * 12)));
    const now = Date.now();
    const records = [];
    for (let i = count; i >= 1; i--) {
      const time = now - i * 5 * 60_000;
      // 2 天前留 10 小时「离线缺口」（完全不上报），让在线时间轴出现部分异常色带。
      const offline = i > (48 + 2) * 12 && i <= (48 + 12) * 12;
      if (offline) continue;
      records.push({
        time: new Date(time).toISOString(),
        updated_at: new Date(time).toISOString(),
        cpu: { usage: offline ? 0 : 8 + Math.random() * 20 },
        ram: { used: (1.2 + Math.random() * 0.4) * 1024 ** 3, total: 4 * 1024 ** 3 },
        swap: { used: (0.2 + Math.random() * 0.1) * 1024 ** 3, total: 2 * 1024 ** 3 },
        disk: { used: (20 + Math.random() * 0.5) * 1024 ** 3, total: 80 * 1024 ** 3 },
        network: { up: 1024 + Math.random() * 4096, down: 4096 + Math.random() * 12288 },
        connections: { tcp: 10 + Math.round(Math.random() * 10), udp: 3 + Math.round(Math.random() * 5) },
        process: 90 + Math.round(Math.random() * 10),
        uptime: 62 * 86400 + 16 * 3600,
        load: { load1: 0.1 + Math.random() * 0.2, load5: 0.05 + Math.random() * 0.15, load15: 0.02 + Math.random() * 0.1 },
        online: !offline,
      });
    }
    return records;
  }
  if (method === "public:getPublicPingTasks") {
    return [
      { id: "demo-ping-1", name: "CMCC", clients: null, type: "icmp" },
      { id: "demo-ping-2", name: "CU", clients: null, type: "icmp" },
      { id: "demo-ping-3", name: "CT", clients: null, type: "icmp" },
    ];
  }
  if (method === "public:getPingRecords") return [];
  return undefined;
}

function makeDemoNodes() {  const day = 86400000;
  const now = Date.now();
  const demoStats = {
    online: true, cpu: { usage: 12.5 }, ram: { used: 1024 ** 3, total: 4 * 1024 ** 3 },
    swap: { used: 256 * 1024 ** 2, total: 2 * 1024 ** 3 },
    disk: { used: 20 * 1024 ** 3, total: 80 * 1024 ** 3 },
    network: { up: 2048, down: 8192, totalUp: 34.7 * 1024 ** 3, totalDown: 35.2 * 1024 ** 3 },
    connections: { tcp: 12, udp: 5 }, process: 93, uptime: 62 * 86400 + 16 * 3600,
    load: { load1: 0.1, load5: 0.03, load15: 0.01 }, updated_at: new Date().toISOString(),
  };
  const raw = (over) => ({
    uuid: "demo", name: "demo", region: "", group: "", os: "Debian 12",
    price: 0, currency: "$", billing_cycle: 365, expired_at: null, traffic_limit: 0,
    cpu_name: "Intel(R) Xeon(R) Gold 6230R CPU @ 2.10GHz", cpu_cores: 2, cpu_physical_cores: 1,
    arch: "amd64", virtualization: "kvm", kernel_version: "6.1.0-18-amd64",
    mem_total: 4 * 1024 ** 3, disk_total: 80 * 1024 ** 3,
    latestStats: demoStats,
    ...over,
  });
  return [
    toNodeModel(raw({ uuid: "demo-1", name: "eoefjerqs.colocrossing.cloud", region: "US", group: "US", price: 11, currency: "$", billing_cycle: 365, expired_at: new Date(now + 122 * day).toISOString(), traffic_limit: 2 * 1024 ** 4 }), [raw().latestStats]),
    toNodeModel(raw({ uuid: "demo-2", name: "hk-cmi.example.com", region: "HK", group: "香港 CMI", price: 35, currency: "¥", billing_cycle: 30, expired_at: new Date(now + 18 * day).toISOString(), traffic_limit: 1024 ** 4 }), [raw().latestStats]),
    toNodeModel(raw({ uuid: "demo-3", name: "jp-tokyo.example.com", region: "JP", group: "JP 东京", os: "AlmaLinux 9", price: 6.5, currency: "$", billing_cycle: 30, expired_at: new Date(now + 60 * day).toISOString() }), [raw().latestStats]),
    toNodeModel(raw({ uuid: "demo-4", name: "de-fra.example.com", region: "DE", group: "欧洲", os: "Debian 11", currency: "€", billing_cycle: 0 }), [raw().latestStats]),
    // FREE 分组：多地区混合，演示「双旗对拼 / 国旗轮换 / 主旗+角标」等分组图标样式；demo-6 离线演示灰显。
    toNodeModel(raw({ uuid: "demo-5", name: "free-la.example.com", region: "US", group: "FREE", price: 0 }), [raw().latestStats]),
    toNodeModel(raw({ uuid: "demo-6", name: "free-fra.example.com", region: "DE", group: "FREE", price: 0 }), [{ ...raw().latestStats, online: false }]),
    toNodeModel(raw({ uuid: "demo-7", name: "free-nrt.example.com", region: "JP", group: "FREE", price: 0 }), [raw().latestStats]),
  ];
}

function getOverviewFromNodes(items) {
  const online = items.filter((node) => node.status === "online").length;
  // 百分比最多两位小数并去掉尾零：100%、87.5%、33.33%，不硬凑 100.00%。
  const percentText = (value) => `${parseFloat(value.toFixed(2))}%`;
  const trafficUp = items.reduce((sum, node) => sum + (node.trafficUpBytes || 0), 0);
  const trafficDown = items.reduce((sum, node) => sum + (node.trafficDownBytes || 0), 0);
  const speedUp = items.reduce((sum, node) => sum + (Number(node.up) || 0), 0);
  const speedDown = items.reduce((sum, node) => sum + (Number(node.down) || 0), 0);
  const toGb = (bytes) => (bytes / 1024 ** 3).toFixed(2);
  const uploadRate = formatByteRate(speedUp, "B/s");
  const downloadRate = formatByteRate(speedDown, "B/s");
  const totalRate = formatByteRate(speedUp + speedDown, "B/s");
  return {
    online: { current: online, total: items.length, rate: items.length ? percentText((online / items.length) * 100) : "0%" },
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
      <OverviewCards :overview="overview" :settings="settings" :speed-history="speedHistory" :nodes="nodes" @open-calc="openCalcCard" />
      <p v-if="settingsError && !isDemoMode" class="data-error" role="alert">{{ settingsError }}</p>
      <p v-if="errorMessage && !isDemoMode" class="data-error" role="alert">{{ errorMessage }}</p>
      <div class="node-filters">
        <GroupFilter
          :groups="groups"
          :active-group="activeGroup"
          :icon-mode="settings.groupIconMode"
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
    <VisitorCard :enabled="settings.showVisitorCard !== false" :auto-collapse="settings.visitorAutoCollapse" :icon="settings.visitorIcon" :mini-style="settings.visitorMiniStyle" />
    <Transition name="toast-fade">
      <p v-if="toast" class="app-toast" role="status" aria-live="polite">{{ toast }}</p>
    </Transition>
  </div>
</template>
