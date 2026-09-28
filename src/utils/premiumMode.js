/**
 * 溢价模式的全局开关（总面板与计算器共用）：
 *   - "premium"（默认）：直接填溢价，总价 = 剩余价值 + 溢价；
 *   - "market"：填参考市价，溢价 = 参考市价 − 剩余价值。
 * 持久化到 localStorage，一处切换全局生效。
 */
import { ref } from "vue";

const KEY = "komari-value-premium-mode-v1";

function load() {
  try {
    return localStorage.getItem(KEY) === "market" ? "market" : "premium";
  } catch {
    return "premium";
  }
}

const mode = ref(load());

export function usePremiumMode() {
  return mode;
}

export function setPremiumMode(value) {
  mode.value = value === "market" ? "market" : "premium";
  try {
    localStorage.setItem(KEY, mode.value);
  } catch {
    // 存储不可用时仅本次会话生效。
  }
}
