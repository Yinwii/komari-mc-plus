<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Building2, ChevronDown, Clock, Globe, MapPin, Monitor, Network, X } from "lucide-vue-next";

/**
 * 访客信息卡片：
 * - 默认展开在左下角，可收纳为贴边小按钮，也可直接关闭（刷新后重新显示）；
 * - "今日不再显示"按本地日期记忆（localStorage），当天刷新不再弹出；
 * - IP / 归属地 / ISP 通过公共 IP 信息接口获取，失败时对应行显示"未知"。
 */

const STORE_KEY = "komari-visitor-card-v1";
// mode: "open" 展开 | "mini" 收纳贴边；"closed-today" 按天隐藏
const state = ref(null);
const info = ref(null);
const infoFailed = ref(false);

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

function readState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    if (raw.closedDate === today()) return { mode: "closed-today" };
    return { mode: raw.mode === "mini" ? "mini" : "open" };
  } catch {
    return { mode: "open" };
  }
}

function persistState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ mode: state.value.mode, closedDate: state.value.mode === "closed-today" ? today() : "" }));
  } catch {
    // 存储不可用时仅本次会话生效。
  }
}

const mode = computed(() => state.value.mode);
const visible = computed(() => mode.value !== "closed-today" && !sessionClosed.value);
const sessionClosed = ref(false);

function collapse() {
  state.value = { mode: "mini" };
  persistState();
}
function expand() {
  state.value = { mode: "open" };
  persistState();
}
function close() {
  // 仅本次会话隐藏，刷新后重新显示。
  sessionClosed.value = true;
}
function closeToday() {
  state.value = { mode: "closed-today" };
  persistState();
}

const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 5) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 13) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
});

const dateText = computed(() =>
  new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }),
);

function parseBrowser(ua) {
  const rules = [
    ["Edg", "Edge"], ["OPR", "Opera"], ["Vivaldi", "Vivaldi"], ["Brave", "Brave"],
    ["MiuiBrowser", "小米浏览器"], ["HuaweiBrowser", "华为浏览器"], ["Quark", "夸克浏览器"],
    ["QQBrowser", "QQ浏览器"], ["UCBrowser", "UC 浏览器"], ["Firefox", "Firefox"], ["Chrome", "Chrome"], ["Safari", "Safari"],
  ];
  for (const [key, name] of rules) {
    if (ua.includes(key)) {
      if (key === "Safari" && ua.includes("Chrome")) continue;
      const match = ua.match(new RegExp(`${key}/([\\d.]+)`));
      const version = match ? match[1].split(".")[0] : "";
      return version ? `${name} ${version}` : name;
    }
  }
  return "未知浏览器";
}

function parseOS(ua) {
  if (/Windows NT 10/.test(ua)) return /Windows NT 10\.\d+;.*Arm/.test(ua) ? "Windows 11" : "Windows 10+";
  if (/Windows/.test(ua)) return "Windows";
  if (/Android/.test(ua)) {
    const m = ua.match(/Android ([\d.]+)/);
    return m ? `Android ${m[1].split(".")[0]}` : "Android";
  }
  if (/iPhone|iPad|iPod/.test(ua)) {
    const m = ua.match(/OS ([\d_]+)/);
    return m ? `iOS ${m[1].replace(/_/g, ".")}` : "iOS";
  }
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return "未知系统";
}

async function fetchVisitorInfo(signal) {
  // ipwho.is：免费、支持 HTTPS/CORS；失败再试 ipapi.co。
  try {
    const res = await fetch("https://ipwho.is/", { signal });
    const data = await res.json();
    if (data && data.success !== false) {
      return {
        ip: data.ip || "",
        location: [data.city, data.region, data.country].filter(Boolean).join(", "),
        isp: data.connection?.isp || data.connection?.org || "",
      };
    }
    throw new Error("ipwho.is 响应无效");
  } catch (error) {
    if (signal?.aborted) throw error;
    const res = await fetch("https://ipapi.co/json/", { signal });
    const data = await res.json();
    if (data && !data.error) {
      return {
        ip: data.ip || "",
        location: [data.city, data.region, data.country_name].filter(Boolean).join(", "),
        isp: data.org || "",
      };
    }
    throw new Error("IP 信息接口均不可用");
  }
}

let abortController = null;

onMounted(() => {
  state.value = readState();
  const ua = navigator.userAgent || "";
  info.value = {
    os: parseOS(ua),
    browser: parseBrowser(ua),
    ip: "",
    location: "",
    isp: "",
  };
  abortController = new AbortController();
  fetchVisitorInfo(abortController.signal)
    .then((data) => { info.value = { ...info.value, ...data }; })
    .catch((error) => {
      if (error?.name !== "AbortError") infoFailed.value = true;
    });
});

onBeforeUnmount(() => abortController?.abort());
</script>

<template>
  <div v-if="visible" class="visitor-layer" aria-live="polite">
    <button
      v-if="mode === 'mini'"
      class="visitor-mini"
      title="显示访客信息"
      aria-label="显示访客信息"
      @click="expand"
    >
      <Network :size="16" :stroke-width="1.8" aria-hidden="true" />
    </button>
    <transition name="visitor-pop">
      <section v-if="mode === 'open'" class="visitor-card" role="dialog" aria-label="访客信息">
        <header class="visitor-head">
          <div class="visitor-avatar"><Network :size="17" :stroke-width="2" aria-hidden="true" /></div>
          <div class="visitor-title">
            <b>{{ greeting }}，欢迎回来</b>
            <small v-if="info?.location || infoFailed">{{ info?.location || "归属地未知" }}</small>
          </div>
          <div class="visitor-head-actions">
            <button class="visitor-action" title="收纳到边栏" aria-label="收纳" @click="collapse"><ChevronDown :size="14" :stroke-width="2" aria-hidden="true" /></button>
            <button class="visitor-action" title="关闭（刷新后重新显示）" aria-label="关闭" @click="close"><X :size="14" :stroke-width="2" aria-hidden="true" /></button>
          </div>
        </header>
        <ul class="visitor-list">
          <li><Monitor :size="13" :stroke-width="1.8" aria-hidden="true" /><span>{{ info?.os || "未知系统" }}</span></li>
          <li><Globe :size="13" :stroke-width="1.8" aria-hidden="true" /><span>{{ info?.browser || "" }}</span></li>
          <li><Network :size="13" :stroke-width="1.8" aria-hidden="true" /><span>{{ info?.ip || "获取中..." }}</span></li>
          <li><Building2 :size="13" :stroke-width="1.8" aria-hidden="true" /><span>{{ info?.isp || "未知运营商" }}</span></li>
          <li><Clock :size="13" :stroke-width="1.8" aria-hidden="true" /><span>{{ dateText }}</span></li>
        </ul>
        <footer class="visitor-foot">
          <button @click="closeToday">今日不再显示</button>
        </footer>
      </section>
    </transition>
  </div>
</template>
