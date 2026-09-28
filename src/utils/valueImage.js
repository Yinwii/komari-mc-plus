/**
 * 将剩余价值评估渲染为一张适合分享的 PNG 卡片（Canvas 绘制，无外部依赖）。
 * 版式对齐 jsq.xiaoge.org 风格：🐔 标题 + 📅 交易日期 + 💹 汇率 + 每台节点明细。
 */

import { cnyRatio, formatDate } from "./valueCalc.js";

const FONT = `"PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif`;

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

/**
 * @param {Array} items computeNodeValue 结果列表
 * @param {object} summary summarizeValues 结果
 * @param {object} meta {dateText, rates, rateLines, footer}
 * @returns {Promise<Blob>} PNG Blob
 */
export async function renderValueImage(items, summary, meta = {}) {
  const scale = 2;
  const width = 960;
  const padding = 44;
  const rowHeight = 58;
  const headerHeight = 150;
  const columns = [
    { title: "🖥 节点", x: padding, align: "left" },
    { title: "💰 单价", x: 470, align: "right" },
    { title: "⏳ 剩余", x: 600, align: "center" },
    { title: "💎 剩余价值", x: 742, align: "right" },
    { title: "🧾 溢价", x: 916, align: "right" },
  ];
  const height = headerHeight + rowHeight + items.length * rowHeight + 118;

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  // 背景：深夜渐变
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#101826");
  bg.addColorStop(0.55, "#0d1420");
  bg.addColorStop(1, "#131a2b");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(120,160,255,0.05)";
  ctx.fillRect(0, 0, width, 6);
  ctx.fillStyle = "rgba(74,222,128,0.06)";
  ctx.fillRect(0, height - 6, width, 6);

  // 标题区
  ctx.fillStyle = "#f8fafc";
  ctx.font = `600 30px ${FONT}`;
  ctx.fillText("🐔 VPS 剩余价值", padding, 62);
  ctx.font = `400 14px ${FONT}`;
  ctx.fillStyle = "#8fa2c5";
  const dateText = meta.dateText ? meta.dateText.slice(0, 10) : formatDate(Date.now());
  ctx.fillText(`📅 交易日期：${dateText}`, padding, 92);
  const rateText = meta.rateLines?.length
    ? `💹 外币汇率：${meta.rateLines.join("，")}`
    : "💹 外币汇率：未获取（按原币种显示）";
  ctx.fillText(rateText, padding, 114);
  ctx.font = `400 13px ${FONT}`;
  ctx.fillText(`已选 ${items.length} 台 · 信息完整 ${summary.validCount} 台${summary.missingInfo ? ` · ${summary.missingInfo} 台缺计费信息` : ""}`, padding, 136);

  // 合计卡片（右上）
  const total = summary.total.cny;
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  roundRect(ctx, width - padding - 340, 44, 340, 84, 14);
  ctx.fill();
  ctx.fillStyle = "#7c8db0";
  ctx.font = `400 13px ${FONT}`;
  ctx.fillText(total ? "合计剩余价值（CNY 折算）" : "合计剩余价值", width - padding - 20, 72);
  ctx.fillStyle = "#4ade80";
  ctx.font = `600 25px ${FONT}`;
  const valueText = total ? `¥${total.value.toFixed(2)}` : [...summary.total.byCurrency.values()].map((b) => b.value.toFixed(2)).join(" / ") || "—";
  ctx.fillText(valueText, width - padding - 20, 104);
  ctx.fillStyle = "#7c8db0";
  ctx.font = `400 12px ${FONT}`;
  if (total && total.premium) ctx.fillText(`溢价 ¥${total.premium.toFixed(2)}`, width - padding - 20, 122);
  ctx.textAlign = "left";

  // 表头
  const tableTop = headerHeight;
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  roundRect(ctx, padding - 10, tableTop, width - (padding - 10) * 2, 40, 10);
  ctx.fill();
  ctx.fillStyle = "#8b9bbf";
  ctx.font = `500 13px ${FONT}`;
  ctx.textBaseline = "middle";
  for (const column of columns) {
    ctx.textAlign = column.align;
    ctx.fillText(column.title, column.x, tableTop + 20);
  }

  // 数据行（斑马纹）
  items.forEach((item, index) => {
    const top = tableTop + 40 + index * rowHeight;
    if (index % 2 === 1) {
      ctx.fillStyle = "rgba(255,255,255,0.025)";
      ctx.fillRect(padding - 10, top, width - (padding - 10) * 2, rowHeight);
    }
    const centerY = top + rowHeight / 2;
    const ratio = meta.rates ? cnyRatio(item.currency, meta.rates) : null;
    const expired = item.expired;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = expired ? "#64748b" : "#e2e8f0";
    ctx.font = `500 15px ${FONT}`;
    const name = item.name.length > 24 ? `${item.name.slice(0, 23)}…` : item.name;
    ctx.fillText(name, padding, centerY - 8);
    ctx.font = `400 11px ${FONT}`;
    ctx.fillStyle = "#5b6b8c";
    ctx.fillText([item.group, expired ? "已过期" : null].filter(Boolean).join(" · "), padding, centerY + 12);

    ctx.font = `400 13px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillStyle = expired ? "#64748b" : "#c3cde4";
    ctx.fillText(`${item.price.toFixed(2)} ${item.currency}`, 528, centerY);
    ctx.textAlign = "center";
    ctx.fillText(item.permanent ? "长期" : item.remainingDays === null ? "—" : `${item.remainingDays} 天`, 600, centerY);
    ctx.textAlign = "right";
    if (item.remainingValue === null) {
      ctx.fillStyle = "#5b6b8c";
      ctx.fillText("—", 812, centerY);
    } else if (ratio !== null) {
      ctx.fillStyle = expired ? "#64748b" : "#4ade80";
      ctx.font = `600 15px ${FONT}`;
      ctx.fillText(`¥${(item.remainingValue * ratio).toFixed(2)}`, 812, centerY);
    } else {
      ctx.fillStyle = expired ? "#64748b" : "#4ade80";
      ctx.font = `600 15px ${FONT}`;
      ctx.fillText(`${item.remainingValue.toFixed(2)} ${item.currency}`, 812, centerY);
    }
    ctx.font = `400 13px ${FONT}`;
    ctx.fillStyle = item.premium === null ? "#5b6b8c" : item.premium > 0 ? "#f87171" : "#60a5fa";
    const premiumText = item.premium === null
      ? "—"
      : ratio !== null
        ? `${item.premium * ratio >= 0 ? "+" : ""}¥${(item.premium * ratio).toFixed(2)}`
        : `${item.premium >= 0 ? "+" : ""}${item.premium.toFixed(2)} ${item.currency}`;
    ctx.fillText(premiumText, 916, centerY);
  });

  // 底部
  const footerTop = tableTop + 40 + items.length * rowHeight + 26;
  if (summary.avgRemainingDays !== null) {
    ctx.textAlign = "left";
    ctx.fillStyle = "#7c8db0";
    ctx.font = `400 13px ${FONT}`;
    ctx.fillText(`平均剩余 ${Math.round(summary.avgRemainingDays)} 天`, padding, footerTop);
  }
  ctx.textAlign = "right";
  ctx.fillStyle = "#4b5b7a";
  ctx.font = `400 12px ${FONT}`;
  ctx.fillText(meta.footer || "由 Komari 面板生成", width - padding, footerTop);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("图片编码失败"))), "image/png");
  });
}
