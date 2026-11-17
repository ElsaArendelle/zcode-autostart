#!/usr/bin/env node
/** 终验 Run 键状态（避免 shell 内联转义问题，唯一权威校验工具） */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
let value = null;
try {
  const out = execSync(`reg query "${KEY}" /v ZCode`, { encoding: "utf8" });
  const m = out.match(/REG_SZ\s+(.*)/);
  value = m ? m[1].trim() : null;
} catch {
  value = null;
}

let enabled;
try {
  const cfg = JSON.parse(readFileSync(join(homedir(), ".zcode", "cli", "config.json"), "utf8"));
  enabled = cfg?.plugins?.options?.["zcode-autostart@dev-draft-6261fd17-0a9f-4bb7-a47b-41c1368c38dd-a78cc25c"]?.enabled;
} catch {
  enabled = undefined;
}

console.log("设置期望 enabled =", enabled);
console.log("注册表 Run 键    =", value ?? "(不存在)");
console.log(
    enabled === true && value !== null ? '✓ 一致：自启已开启' :
    enabled === false && value === null ? '✓ 一致：自启已关闭' :
    enabled === undefined ? 'ℹ 设置未保存（默认开启），注册表：' + (value !== null ? '已写入 ✓' : '未写入') :
    '✗ 不一致（等 MCP 服务器下次启动同步）',
 );
