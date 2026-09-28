/**
 * Bing 每日壁纸服务。
 *
 * 说明：Bing 官方 HPImageArchive 接口不允许跨域（无 Access-Control-Allow-Origin），
 * 因此浏览器端无法直接拉取每日图列表 JSON。这里采用多级降级：
 *   1. 带 CORS 的 Bing 镜像 JSON 接口（可用时附带图名信息）；
 *   2. 免 CORS 的 302 重定向图源（api.dujin.org / bing.img.run），
 *      图片本身可以直接作为 CSS 背景加载，无需跨域许可；
 *   3. 全部失败时返回 null，页面保持默认纯色背景。
 *
 * 交互：switchWallpaper() 依次尝试候选源并预加载，成功即切换；
 *      随机源通过 cache-buster 保证每次点击都换图。
 */

const STORAGE_KEY = "komari-wallpaper-state";
const DAY_MS = 86400000;

/** 当日固定图源（按优先级尝试，全部为免 CORS 的重定向服务）。 */
const DAILY_SOURCES = [
  { id: "dujin", url: "https://api.dujin.org/bing/1920.php" },
  { id: "bing-run-daily", url: "https://bing.img.run/1920x1080.php" },
  { id: "bing-run-uhd", url: "https://bing.img.run/uhd.php" },
];

/** 随机历史 Bing 图源：点击刷新切换时优先使用（加 cache-buster 强制换图）。 */
const RANDOM_SOURCES = [
  { id: "bing-run-rand", url: () => `https://bing.img.run/rand.php?_=${Date.now()}` },
  { id: "peapix-rand", url: () => `https://bing.img.run/1366x768.php?_=${Date.now()}` },
];

/** 可选的带元数据 JSON 源（需要服务端开启 CORS，失败自动跳过）。 */
const JSON_SOURCES = [
  {
    id: "vvhan",
    url: "https://api.vvhan.com/api/bing?type=json",
    pick: (data) => {
      const url = data?.data?.url || data?.url;
      return url ? { url, title: data?.data?.copyright || data?.data?.title || "Bing 每日壁纸" } : null;
    },
  },
  {
    id: "birbit",
    url: "https://bing.biturl.top/?resolution=1920&format=json&index=0&mkt=zh-CN",
    pick: (data) => (data?.url ? { url: data.url, title: data.copyright || "Bing 每日壁纸" } : null),
  },
];

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function loadWallpaperState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!raw || typeof raw !== "object") return { enabled: true, date: "", url: "", title: "" };
    return { enabled: raw.enabled !== false, date: String(raw.date || ""), url: String(raw.url || ""), title: String(raw.title || "") };
  } catch {
    return { enabled: true, date: "", url: "", title: "" };
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用时仅保留内存状态。
  }
}

/** 预加载图片（CSS 背景无需 CORS，用 Image 探测可用性）。 */
function preloadImage(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => {
      image.src = "";
      reject(new Error("timeout"));
    }, timeout);
    image.onload = () => {
      clearTimeout(timer);
      if (image.naturalWidth >= 400) resolve(url);
      else reject(new Error("too small"));
    };
    image.onerror = () => {
      clearTimeout(timer);
      reject(new Error("load failed"));
    };
    image.src = url;
  });
}

async function fetchJsonSource(source) {
  try {
    const response = await fetch(source.url, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    return source.pick(await response.json());
  } catch {
    return null;
  }
}

async function resolveDaily() {
  for (const source of JSON_SOURCES) {
    const picked = await fetchJsonSource(source);
    if (picked) return { ...picked, source: source.id };
  }
  for (const source of DAILY_SOURCES) {
    const url = typeof source.url === "function" ? source.url() : source.url;
    try {
      await preloadImage(url);
      return { url, title: "Bing 每日壁纸", source: source.id };
    } catch {
      // 尝试下一个源。
    }
  }
  return null;
}

/**
 * 初始化/自动续期壁纸：当天已缓存则直接复用，否则解析每日图。
 * @returns {Promise<{enabled:boolean, url:string, title:string}>}
 */
export async function initWallpaper() {
  const state = loadWallpaperState();
  if (!state.enabled) return { ...state };
  if (state.url && state.date === todayKey()) return { ...state };
  const daily = await resolveDaily();
  if (!daily) {
    // 当日解析失败：旧图仍在 3 天内可继续展示，否则放弃。
    const stale = state.url && state.date && Date.now() - Date.parse(state.date) < 3 * DAY_MS;
    return stale ? { ...state } : { ...state, url: "", title: "" };
  }
  const next = { enabled: true, date: todayKey(), url: daily.url, title: daily.title };
  saveState(next);
  return next;
}

/**
 * 手动切换壁纸：优先随机历史图，其次重新解析每日图，循环尝试直到成功。
 * @returns {Promise<{url:string, title:string} | null>}
 */
export async function switchWallpaper() {
  const candidates = [...RANDOM_SOURCES, ...DAILY_SOURCES.map((s) => ({ ...s, url: () => `${s.url}?r=${Date.now()}` }))];
  for (const source of candidates) {
    try {
      const url = await preloadImage(source.url());
      const next = { ...loadWallpaperState(), date: todayKey(), url, title: "Bing 壁纸" };
      saveState(next);
      return { url, title: next.title };
    } catch {
      // 尝试下一个源。
    }
  }
  const daily = await resolveDaily();
  if (daily) {
    const next = { ...loadWallpaperState(), date: todayKey(), url: daily.url, title: daily.title };
    saveState(next);
    return { url: next.url, title: next.title };
  }
  return null;
}

/** 开启/关闭壁纸。 */
export function setWallpaperEnabled(enabled) {
  const next = { ...loadWallpaperState(), enabled: Boolean(enabled) };
  saveState(next);
  return next;
}
