#!/usr/bin/env node
/** zcode-autostart 冒烟测试：握手 → 状态 → 关闭/开启切换 → 一致性校验（真实读写 Run 键） */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
const child = spawn(process.execPath, [join(PLUGIN_DIR, "dist", "server.mjs")], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, AUTOSTART_ENABLED: "true", EXE_PATH: "" },
});
child.stderr.on("data", d => process.stderr.write(`[server] ${d}`));

const pending = new Map();
let nextId = 1;
const rl = createInterface({ input: child.stdout });
rl.on("line", line => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const entry = pending.get(msg.id);
  if (entry) { pending.delete(msg.id); entry(msg); }
});

function request(method, params, timeoutMs = 30000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`${method} 超时`)); } }, timeoutMs);
  });
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

try {
  const init = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0.0.0" } });
  check("initialize 返回 serverInfo", init?.result?.serverInfo?.name === "zcode-autostart");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  await new Promise(r => setTimeout(r, 1500)); // 等启动同步跑完

  const st1 = (await request("tools/call", { name: "get_status", arguments: {} })).result.structuredContent;
  check("get_status：自启为开启", st1?.enabled === true, `runValue=${st1?.runValue}`);
  check("get_status：exe 路径正确", st1?.runValue === '"C:\\Program Files\\ZCode\\ZCode.exe"');

  const off = (await request("tools/call", { name: "set_autostart", arguments: { enabled: false } })).result.structuredContent;
  check("set_autostart(false)：已删除", off?.enabled === false && off?.runValue === null, `changed=${off?.changed}`);

  const st2 = (await request("tools/call", { name: "get_status", arguments: {} })).result.structuredContent;
  check("复核：注册表确已删除", st2?.enabled === false);

  const on = (await request("tools/call", { name: "set_autostart", arguments: { enabled: true } })).result.structuredContent;
  check("set_autostart(true)：已恢复", on?.enabled === true && on?.changed === true, `runValue=${on?.runValue}`);

  const sync = (await request("tools/call", { name: "sync_from_config", arguments: {} })).result.structuredContent;
  check("sync_from_config：无变更（一致）", sync?.changed === false && sync?.enabled === true, `configEnabled=${sync?.configEnabled}`);
} catch (err) {
  check("冒烟流程无异常", false, err.message);
} finally {
  child.kill();
}

console.log(failures === 0 ? "\n全部通过" : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
