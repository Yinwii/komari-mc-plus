/**
 * Bing 每日壁纸服务。
 *
 * 说明：Bing 官方 HPImageArchive 接口不允许跨域（无 Access-Control-Allow-Origin），
 * 因此浏览器端无法直接拉取每日图列表 JSON。这里采用多级降级：
 *   1. 带 CORS 的 Bing 镜像 JSON 接口（biturl.top，支持 index=0~7 取最近 8 天）；
 *   2. 免 CORS 的 302 重定向图源（备用，部分服务可能已停用）；
 *   3. 全部失败时返回 null，页面保持默认纯色背景。
 *
 * 交互：switchWallpaper() 优先从最近 8 天里随机换一张（且与当前图不同），
 *      再退化为重定向图源；随机源通过 cache-buster 保证每次点击都换图。
 */

const STORAGE_KEY = "komari-wallpaper-state";
const DAY_MS = 86400000;
/** biturl.top 可用索引范围：0 = 今天，7 = 8 天前。 */
const BING_INDEX_MAX = 7;

function bingRotateUrl(index) {
  return `https://bing.biturl.top/?resolution=1920&format=json&index=${index}&mkt=zh-CN`;
}

/** 当日固定图源（按优先级尝试，全部为免 CORS 的重定向服务）。 */
const DAILY_SOURCES = [
  { id: "dujin", url: "https://api.dujin.org/bing/1920.php" },
  { id: "bing-run-daily", url: "https://bing.img.run/1920x1080.php" },
  { id: "bing-run-uhd", url: "https://bing.img.run/uhd.php" },
];

/** 随机历史 Bing 图源：作为 JSON 源不可用时的兜底（加 cache-buster 强制换图）。 */
const RANDOM_SOURCES = [
  { id: "bing-run-rand", url: () => `https://bing.img.run/rand.php?_=${Date.now()}` },
  { id: "bing-run-1366", url: () => `https://bing.img.run/1366x768.php?_=${Date.now()}` },
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
    if (!raw || typeof raw !== "object") return { enabled: true, date: "", url: "", title: "", index: -1 };
    return {
      enabled: raw.enabled !== false,
      date: String(raw.date || ""),
      url: String(raw.url || ""),
      title: String(raw.title || ""),
      index: Number.isInteger(raw.index) ? raw.index : -1,
    };
  } catch {
    return { enabled: true, date: "", url: "", title: "", index: -1 };
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

/** 按索引取最近 8 天中的一张（返回 url + 图名），失败返回 null。 */
async function fetchByIndex(index) {
  const picked = await fetchJsonSource({
    url: bingRotateUrl(index),
    pick: (data) => (data?.url ? { url: data.url, title: data.copyright || data.title || "Bing 壁纸" } : null),
  });
  if (!picked) return null;
  try {
    await preloadImage(picked.url);
  } catch {
    return null;
  }
  return { ...picked, index };
}

/** 打乱 0~7 的索引，并把当前索引排到末尾（保证优先换出与当前不同的图片）。 */
function shuffledIndexes(currentIndex) {
  const list = [];
  for (let i = 0; i <= BING_INDEX_MAX; i += 1) {
    if (i !== currentIndex) list.push(i);
  }
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  if (currentIndex >= 0 && currentIndex <= BING_INDEX_MAX) list.push(currentIndex);
  return list;
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
  // 首次只探测前 3 天，避免网络异常时启动过慢。
  for (const index of [0, 1, 2]) {
    const hit = await fetchByIndex(index);
    if (hit) {
      const next = { enabled: true, date: todayKey(), url: hit.url, title: hit.title, index: hit.index };
      saveState(next);
      return next;
    }
  }
  // 当日解析失败：旧图仍在 3 天内可继续展示，否则放弃。
  const stale = state.url && state.date && Date.now() - Date.parse(state.date) < 3 * DAY_MS;
  return stale ? { ...state } : { ...state, url: "", title: "" };
}

/**
 * 手动切换壁纸：优先从最近 8 天的 Bing 图里换一张（跳过当前图），
 * 其次尝试免 CORS 的随机图源，最后回退到当日图。
 * @returns {Promise<{url:string, title:string} | null>}
 */
export async function switchWallpaper() {
  const state = loadWallpaperState();
  const currentUrl = state.url;

  // ① 最近 8 天随机换一张（可拿到图名，且能保证与当前不同）。
  for (const index of shuffledIndexes(Number(state.index))) {
    const hit = await fetchByIndex(index);
    if (!hit || hit.url === currentUrl) continue;
    const next = { ...loadWallpaperState(), date: todayKey(), url: hit.url, title: hit.title, index: hit.index };
    saveState(next);
    return { url: next.url, title: next.title };
  }

  // ② 免 CORS 随机图源兜底。
  for (const source of RANDOM_SOURCES) {
    try {
      const url = await preloadImage(source.url());
      if (url === currentUrl) continue;
      const next = { ...loadWallpaperState(), date: todayKey(), url, title: "Bing 壁纸", index: -1 };
      saveState(next);
      return { url: next.url, title: next.title };
    } catch {
      // 尝试下一个源。
    }
  }

  // ③ 最后回退到当日图（若与当前相同则不视为切换成功）。
  const daily = await resolveDaily();
  if (daily && daily.url !== currentUrl) {
    const next = { ...loadWallpaperState(), date: todayKey(), url: daily.url, title: daily.title, index: 0 };
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
