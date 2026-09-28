/**
 * 将剩余价值评估渲染为一张适合分享的 PNG 卡片（Canvas 绘制，无外部依赖）。
 */

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

function formatMoney(value, currency) {
  return `${currency}${Number(value).toFixed(2)}`;
}

/**
 * @param {Array} items computeNodeValue 结果列表
 * @param {object} summary summarizeValues 结果
 * @returns {Promise<Blob>} PNG Blob
 */
export async function renderValueImage(items, summary, meta = {}) {
  const scale = 2;
  const width = 960;
  const padding = 44;
  const rowHeight = 58;
  const headerHeight = 132;
  const columns = [
    { title: "节点", x: padding, align: "left", width: 250 },
    { title: "到期", x: 400, align: "center", width: 110 },
    { title: "单价", x: 516, align: "right", width: 110 },
    { title: "剩余", x: 636, align: "center", width: 90 },
    { title: "剩余价值", x: 732, align: "right", width: 120 },
    { title: "溢价", x: 858, align: "right", width: 58 },
  ];
  const height = headerHeight + rowHeight + items.length * rowHeight + 118;

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  // 背景：深夜渐变 + 轻噪点色块
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
  ctx.fillText(meta.title || "VPS 剩余价值评估", padding, 64);
  ctx.fillStyle = "#7c8db0";
  ctx.font = `400 14px ${FONT}`;
  ctx.fillText(meta.dateText || new Date().toLocaleString("zh-CN", { hour12: false }), padding, 92);
  ctx.font = `400 13px ${FONT}`;
  ctx.fillText(`已选 ${items.length} 台 · 信息完整 ${summary.validCount} 台${summary.missingInfo ? ` · ${summary.missingInfo} 台缺计费信息` : ""}`, padding, 114);

  // 合计卡片（右上）
  const total = summary.total.cny;
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  roundRect(ctx, width - padding - 330, 44, 330, 76, 14);
  ctx.fill();
  ctx.fillStyle = "#7c8db0";
  ctx.font = `400 13px ${FONT}`;
  ctx.fillText(total ? "合计剩余价值（CNY 折算）" : "合计剩余价值", width - padding - 20, 72);
  ctx.fillStyle = "#4ade80";
  ctx.font = `600 24px ${FONT}`;
  const valueText = total ? `¥${total.value.toFixed(2)}` : [...summary.total.byCurrency.values()].map((b) => b.value.toFixed(2)).join(" / ") || "—";
  ctx.fillText(valueText, width - padding - 20, 104);
  ctx.fillStyle = "#7c8db0";
  ctx.font = `400 12px ${FONT}`;
  if (total) ctx.fillText(`购入 ¥${total.price.toFixed(2)}${total.premium ? ` · 溢价 ¥${total.premium.toFixed(2)}` : ""}`, width - padding - 340 + 10, 104);
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
    const expired = item.expired;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = expired ? "#64748b" : "#e2e8f0";
    ctx.font = `500 15px ${FONT}`;
    const name = item.name.length > 16 ? `${item.name.slice(0, 15)}…` : item.name;
    ctx.fillText(name, padding, centerY - 8);
    ctx.font = `400 11px ${FONT}`;
    ctx.fillStyle = "#5b6b8c";
    ctx.fillText([item.group, item.permanent ? "长期" : expired ? "已过期" : null].filter(Boolean).join(" · "), padding, centerY + 12);

    ctx.font = `400 13px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillStyle = expired ? "#64748b" : "#c3cde4";
    ctx.fillText(item.expiryMs ? new Date(item.expiryMs).toLocaleDateString("zh-CN") : item.permanent ? "长期" : "未知", 455, centerY);
    ctx.textAlign = "right";
    ctx.fillText(formatMoney(item.price, item.currency), 626, centerY);
    ctx.textAlign = "center";
    ctx.fillText(item.permanent ? "∞" : item.remainingDays === null ? "—" : `${item.remainingDays} 天`, 681, centerY);
    ctx.textAlign = "right";
    ctx.fillStyle = expired ? "#64748b" : "#4ade80";
    ctx.font = `600 15px ${FONT}`;
    ctx.fillText(item.remainingValue === null ? "—" : formatMoney(item.remainingValue, item.currency), 852, centerY);
    ctx.fillStyle = item.premium === null ? "#5b6b8c" : item.premium > 0 ? "#f87171" : "#60a5fa";
    ctx.font = `400 13px ${FONT}`;
    ctx.fillText(item.premium === null ? "—" : `${item.premium >= 0 ? "+" : ""}${item.premium.toFixed(2)}`, 916, centerY);
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
  ctx.fillText("Komari · komari-theme-minecraft", width - padding, footerTop);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("图片编码失败"))), "image/png");
  });
}
