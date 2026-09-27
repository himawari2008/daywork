'use strict';
/**
 * 活记分组回归测试 — 共享 HTTP 工具
 *
 * 这些脚本对「正在运行的活记后端」做实时回归（需要 server + Postgres）。
 * 单元测试（不依赖服务）请改用 `npm run test:grouping`（jest）。
 *
 * 环境变量：
 *   GROUPING_BASE_URL  默认 http://localhost:3000
 *   GROUPING_USER_ID   测试用用户，默认 ci-grouping-verify（跑完会清空该用户全部记录）
 */
const BASE_URL = process.env.GROUPING_BASE_URL || 'http://localhost:3000';
// 默认每次运行用独立的时间戳 UID，避免跨脚本/跨运行的「分组名模糊合并」相互污染
// （例如先跑出「采购·建材」，再跑「采购」会被 findOrCreate 合并进去）。
// 需要固定 UID 调试时，设 GROUPING_USER_ID 即可。
const USER_ID = process.env.GROUPING_USER_ID || 'ci-grouping-' + Date.now();

function headers(userId) {
  return { 'Content-Type': 'application/json', 'x-user-id': userId || USER_ID };
}

async function postJson(path, body, userId) {
  const res = await fetch(BASE_URL + path, {
    method: 'POST',
    headers: headers(userId),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function getJson(path, userId) {
  const res = await fetch(BASE_URL + path, { method: 'GET', headers: headers(userId) });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

async function patchJson(path, body, userId) {
  const res = await fetch(BASE_URL + path, {
    method: 'PATCH',
    headers: headers(userId),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function delJson(path, userId) {
  const res = await fetch(BASE_URL + path, { method: 'DELETE', headers: headers(userId) });
  if (!res.ok) throw new Error(`DELETE ${path} -> ${res.status}`);
  return true;
}

// 后端返回结构可能包裹在 {data} / {record} 中，这里统一取出记录对象
function extractRecord(json) {
  if (!json) return null;
  if (json.id) return json;
  if (json.data && json.data.id) return json.data;
  if (json.record && json.record.id) return json.record;
  return json;
}

// GET /api/groups 把 groupId 映射成名称；新建分组有提交竞态，故带重试。
// 兼容两种返回结构：裸数组 [{id,name}] 或 { groups:[{id,name}], ungroupedCount }
async function getGroupsMap(userId, retries = 6, delayMs = 120) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await getJson('/api/groups', userId);
      const list = Array.isArray(res) ? res : (res && res.groups) || [];
      const map = {};
      for (const g of list) map[g.id] = g.name;
      if (Object.keys(map).length > 0) return map;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error('getGroupsMap 重试后仍失败: ' + (lastErr && lastErr.message));
}

async function createRecord(content, userId) {
  return extractRecord(await postJson('/api/records', { content }, userId));
}

async function getRecord(id, userId) {
  return extractRecord(await getJson('/api/records/' + id, userId));
}

// 解析某条记录的所属分组名（带重试，规避分组提交竞态）
async function resolveRecordGroup(record, userId) {
  if (!record || !record.groupId) return null;
  const map = await getGroupsMap(userId);
  return map[record.groupId] || null;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `✗ ${label}\n    期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`,
    );
  }
}

async function cleanup(userId) {
  try {
    await delJson('/api/records/all', userId);
  } catch (e) {
    // 清空失败不阻塞（可能服务已停）
  }
}

module.exports = {
  BASE_URL,
  USER_ID,
  postJson,
  getJson,
  patchJson,
  delJson,
  extractRecord,
  getGroupsMap,
  createRecord,
  getRecord,
  resolveRecordGroup,
  assertEqual,
  cleanup,
};
