import { callRpc } from "./rpc.js";

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_RECORDS = 20000;

/**
 * 节点历史记录服务。
 *
 * 关键设计：底层请求是「按 uuid:hours 去重的共享请求」，**不受任何调用方的 signal 影响**。
 * 调用方的 signal 只用来取消自己的等待（raceWithAbort），不会中断真正的网络请求。
 *
 * 这样做的原因（踩过的坑）：总览卡片会在挂载、节点列表变化、样式切换时连续触发多次加载，
 * 每次都先 abort 上一次。如果共享请求绑定在调用方的 signal 上，新的那一次会复用上一条
 * 已被 abort 的 promise，于是必然拿到 AbortError → 结果集为空 → 图表永远没有数据。
 */
class NodeHistoryService {
  constructor() {
    this.cache = new Map();
    this.pending = new Map();
    this.source = null;
  }

  fetch(uuid, hours = 1, signal) {
    const safeHours = Math.max(1, Number(hours) || 1);
    const key = `${uuid}:${safeHours}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
      return raceWithAbort(Promise.resolve(cached.records), signal);
    }

    let shared = this.pending.get(key);
    if (!shared) {
      shared = this.request(uuid, safeHours)
        .then((records) => {
          this.cache.set(key, { createdAt: Date.now(), records });
          return records;
        })
        .finally(() => this.pending.delete(key));
      // 所有等待者都中途取消时，共享请求自身仍会 reject，挂一个空 catch 避免未处理拒绝告警。
      shared.catch(() => {});
      this.pending.set(key, shared);
    }
    return raceWithAbort(shared, signal);
  }

  async request(uuid, hours) {
    if (this.source !== "common:getRecords") {
      try {
        const payload = await callRpc("public:getRecordsByUUID", { uuid, hours: String(hours) });
        this.source = "public:getRecordsByUUID";
        return normalizeRecords(payload);
      } catch (error) {
        if (!isUnsupportedMethod(error)) throw error;
      }
    }

    const payload = await callRpc("common:getRecords", {
      uuid,
      hours,
      type: "load",
      maxCount: MAX_RECORDS,
    });
    this.source = "common:getRecords";
    return normalizeRecords(payload);
  }
}

/** 只影响本次等待：signal 触发时以 AbortError 拒绝，但不打断共享请求。 */
function raceWithAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function abortError(signal) {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  try {
    return new DOMException("Aborted", "AbortError");
  } catch {
    const error = new Error("Aborted");
    error.name = "AbortError";
    return error;
  }
}

function normalizeRecords(payload) {
  const records = Array.isArray(payload) ? payload : payload?.records;
  if (!Array.isArray(records)) return [];
  return records.filter((record) => record && typeof record === "object");
}

function isUnsupportedMethod(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /method|not found|unknown|unsupported|不存在|不支持/i.test(message);
}

export const nodeHistoryService = new NodeHistoryService();

export function fetchNodeHistory(uuid, hours = 1, signal) {
  return nodeHistoryService.fetch(uuid, hours, signal);
}
