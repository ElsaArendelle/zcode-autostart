#!/usr/bin/env node
/**
 * zcode-autostart —— ZCode 开机自启开关插件（MCP 服务器）
 *
 * 职责：
 * 1. 进程启动时按清单 userConfig（env 注入 AUTOSTART_ENABLED）同步 HKCU Run 键；
 * 2. 提供工具：get_status / set_autostart / sync_from_config，
 *    供面板（ui.surfaces）与会话内 agent 即时读写自启状态。
 *
 * Windows 实现：HKCU\Software\Microsoft\Windows\CurrentVersion\Run 下
 * 写/删名为 "ZCode" 的值（REG_SZ，带引号的可执行文件路径）。
 * 无需管理员权限；用户级、随时可撤销。
 *
 * 密钥安全：不使用任何凭据。
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_DIR = dirname(dirname(fileURLToPath(import.meta.url))); // dist/ 的上级即插件根
const PANEL_PATH = join(PLUGIN_DIR, "dist", "ui", "panel.html");
const PANEL_URI = "ui://zcode-autostart/panel.html";
const HTML_MIME = "text/html;profile=mcp-app";
const SERVER_INFO = { name: "zcode-autostart", version: "0.1.4" };
const RUN_KEY_PATH = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_VALUE_NAME = "ZCode";
const EXE_FALLBACK = "C:\\Program Files\\ZCode\\ZCode.exe";
const PLUGIN_NAME = "zcode-autostart";
const CONFIG_PATH = join(homedir(), ".zcode", "cli", "config.json");

function exePath() {
  const fromEnv = process.env.EXE_PATH?.trim();
  return fromEnv || EXE_FALLBACK;
}

function envEnabled() {
  // 清单里 boolean 型 userConfig 以字符串形式注入："true" / "false"
  return process.env.AUTOSTART_ENABLED?.trim()?.toLowerCase() === "true";
}

/**
 * 期望状态的真源：宿主把设置页保存的 userConfig 写在
 * ~/.zcode/cli/config.json 的 plugins.options["<插件id>"].enabled。
 * env 注入存在时机问题（保存后进程可能未按新值重启），
 * 因此每次都以该文件为准；读不到时回落 env，再回落 true（清单默认值）。
 */
function readDesiredEnabled() {
  try {
    if (existsSync(CONFIG_PATH)) {
      const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
      const options = cfg?.plugins?.options;
      if (options && typeof options === "object") {
        const key = Object.keys(options).find(k => k.split("@")[0] === PLUGIN_NAME);
        const value = key ? options[key]?.enabled : undefined;
        if (typeof value === "boolean") return value;
      }
    }
  } catch {
    // 配置文件损坏时回落
  }
  return envEnabled() || true;
}

/** 运行 reg 命令；args 数组形式避免 shell 引号问题 */
function runReg(args, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const child = spawn("reg", args, { windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("reg 命令超时"));
    }, timeoutMs);
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (err += d));
    child.on("close", code => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
    child.on("error", e => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/** 读取 Run 键当前值；不存在返回 null */
async function readRunValue() {
  const { out } = await runReg(["query", RUN_KEY_PATH, "/v", RUN_VALUE_NAME]);
  const match = out.match(/REG_SZ\s+(.*)/);
  return match ? match[1].trim() : null;
}

async function writeRunValue() {
  const value = `"${exePath()}"`;
  const { code, err } = await runReg([
    "add", RUN_KEY_PATH, "/v", RUN_VALUE_NAME, "/t", "REG_SZ", "/d", value, "/f",
  ]);
  if (code !== 0) throw new Error(`reg add 失败：${err || code}`);
  const actual = await readRunValue();
  if (actual !== value) throw new Error(`写入后校验不一致：${actual}`);
  return actual;
}

async function removeRunValue() {
  const current = await readRunValue().catch(() => null);
  if (current === null) return false; // 本来就不存在
  const { code, err } = await runReg(["delete", RUN_KEY_PATH, "/v", RUN_VALUE_NAME, "/f"]);
  if (code !== 0) throw new Error(`reg delete 失败：${err || code}`);
  return true;
}

/** 把 Run 键同步到指定状态；返回是否发生变更 */
async function applyState(enabled) {
  const current = await readRunValue().catch(() => null);
  if (enabled) {
    const expected = `"${exePath()}"`;
    if (current === expected) return { changed: false, runValue: current };
    return { changed: true, runValue: await writeRunValue() };
  }
  if (current === null) return { changed: false, runValue: null };
  await removeRunValue();
  return { changed: true, runValue: null };
}

// ---------- 启动时按配置同步一次 ----------

process.stderr.write(
  `[zcode-autostart] ready (pid ${process.pid}), config enabled=${readDesiredEnabled()}, exe=${exePath()}\n`,
);
applyState(readDesiredEnabled())
  .then(r => process.stderr.write(`[zcode-autostart] 启动同步完成：changed=${r.changed}, runValue=${r.runValue ?? "(无)"}\n`))
  .catch(err => process.stderr.write(`[zcode-autostart] 启动同步失败：${err.message}\n`));

// ---------- 最小 MCP stdio 实现 ----------

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function textResult(text, structured) {
  const result = { content: [{ type: "text", text }] };
  if (structured !== undefined) result.structuredContent = structured;
  return result;
}

async function statusPayload() {
  const runValue = await readRunValue().catch(() => null);
  return {
    enabled: runValue !== null,
    runValue,
    exePath: exePath(),
    configEnabled: readDesiredEnabled(),
    runKeyPath: RUN_KEY_PATH,
    runValueName: RUN_VALUE_NAME,
  };
}

const TOOLS = [
  {
    name: "get_status",
    description: "查询 ZCode 开机自启状态（HKCU Run 键是否存在及其值）。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "set_autostart",
    description: "开启或关闭 ZCode 开机自启：enabled=true 写入 HKCU Run 键，false 删除。",
    inputSchema: {
      type: "object",
      properties: { enabled: { type: "boolean", description: "true 开启自启，false 关闭" } },
      required: ["enabled"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "sync_from_config",
    description: "把 Run 键同步为插件设置（userConfig）里的期望状态。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false },
  },
];

function handleRequest({ id, method, params }) {
  switch (method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        },
      });
      return;
    case "ping":
      send({ jsonrpc: "2.0", id, result: {} });
      return;
    case "tools/list":
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      return;
    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments ?? {};
      (async () => {
        try {
          if (name === "get_status") {
            const data = await statusPayload();
            send({ jsonrpc: "2.0", id, result: textResult(JSON.stringify(data, null, 2), data) });
          } else if (name === "set_autostart") {
            const r = await applyState(args.enabled === true);
            const data = { ...(await statusPayload()), changed: r.changed };
            send({
              jsonrpc: "2.0",
              id,
              result: textResult(
                `已${args.enabled === true ? "开启" : "关闭"}开机自启${r.changed ? "（已写入注册表）" : "（注册表原本已是该状态）"}。`,
                data,
              ),
            });
          } else if (name === "sync_from_config") {
            const r = await applyState(readDesiredEnabled());
            const data = { ...(await statusPayload()), changed: r.changed };
            send({
              jsonrpc: "2.0",
              id,
              result: textResult(
                `已按插件设置（enabled=${readDesiredEnabled()}）同步注册表，changed=${r.changed}。`,
                data,
              ),
            });
          } else {
            send({
              jsonrpc: "2.0",
              id,
              result: { content: [{ type: "text", text: `未知工具：${name}` }], isError: true },
            });
          }
        } catch (err) {
          send({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: `操作失败：${err.message}` }], isError: true },
          });
        }
      })();
      return;
    }
    case "resources/list":
      send({
        jsonrpc: "2.0",
        id,
        result: {
          resources: [{ uri: PANEL_URI, name: "开机自启面板", mimeType: HTML_MIME }],
        },
      });
      return;
    case "resources/read": {
      if (params?.uri !== PANEL_URI) {
        send({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: `未知资源：${params?.uri}` }], isError: true },
        });
        return;
      }
      send({
        jsonrpc: "2.0",
        id,
        result: {
          contents: [{ uri: PANEL_URI, mimeType: HTML_MIME, text: readFileSync(PANEL_PATH, "utf8") }],
        },
      });
      return;
    }
    default:
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

const { createInterface } = await import("node:readline");
const stdinLines = createInterface({ input: process.stdin });
stdinLines.on("line", line => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return;
  if (message.id === undefined || message.id === null) return;
  handleRequest(message);
});
