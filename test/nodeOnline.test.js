import assert from "node:assert/strict";
import test from "node:test";
import { fetchLatestStats, fetchSnapshot, updateNodeRealtime } from "../src/services/komariApi.js";
import { resetRpcClientForTests } from "../src/services/rpc.js";

test("批量接口保留离线节点的旧记录时，首页仍应正确统计在线数量", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
    resetRpcClientForTests();
  });
  let online = true;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const results = {
      "public:getNodesInformation": [{ uuid: "active" }, { uuid: "disconnected" }],
      "common:getNodesLatestStatus": {
        active: { cpu: 10, online, uptime: 3600, time: "2026-09-14T00:00:00Z" },
        disconnected: { cpu: 20, online: false, uptime: 3600, time: "2026-09-13T00:00:00Z" },
      },
    };
    return { ok: true, json: async () => ({ result: results[request.method] ?? [] }) };
  };

  const { nodes } = await fetchSnapshot();
  assert.equal(nodes.filter((node) => node.status === "online").length, 1);
  assert.equal(nodes[1].status, "offline");
  assert.equal(nodes[1].online, "离线");
  assert.equal(nodes[1].cpu, "20.00");
  assert.equal(nodes[1].latestStats.online, false);

  online = false;
  const latest = await fetchLatestStats(nodes.map((node) => node.uuid));
  const refreshed = await Promise.all(nodes.map((node) => updateNodeRealtime(node, latest.get(node.uuid))));
  assert.equal(refreshed.filter((node) => node.status === "online").length, 0);
  assert.equal(refreshed[0].online, "离线");
});

test("采样时间不变时也必须更新掉线和恢复状态，状态未变时才复用对象", async () => {
  const stats = { cpu: { usage: 10 }, uptime: 3600, updated_at: "2026-09-14T00:00:00Z", online: true };
  const node = await updateNodeRealtime({}, [stats]);
  assert.equal(await updateNodeRealtime(node, [stats]), node);
  const offline = await updateNodeRealtime(node, [{ ...stats, online: false }]);
  assert.equal(offline.status, "offline");
  assert.equal(offline.online, "离线");
  const recovered = await updateNodeRealtime(offline, [stats]);
  assert.equal(recovered.status, "online");
  assert.equal(recovered.online, "1 小时");

  const missing = await updateNodeRealtime(node, []);
  assert.equal(missing.status, "offline");
  assert.equal((await updateNodeRealtime(missing, [stats])).status, "online");
});

test("旧版记录没有 online 字段时保持兼容，无记录则显示离线", async () => {
  const node = await updateNodeRealtime({}, [{ cpu: { usage: 5 }, uptime: 3600 }]);
  assert.equal(node.status, "online");
  assert.equal((await updateNodeRealtime(node, [])).status, "offline");
});
