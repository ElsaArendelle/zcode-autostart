#!/usr/bin/env node
// 对照实验：三种方式查询 Run 键，dump 真实输出（GBK 解码）
import { spawn, execSync } from "node:child_process";

const KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

function decode(buf) {
  try { return buf.toString("utf8"); } catch { return buf.toString(); }
}
function decodeGbk(buf) {
  try { return buf.toString("latin1"); } catch { return String(buf); }
}

console.log("=== A. spawn 数组形式（服务器现行方式）===");
await new Promise(resolve => {
  const c = spawn("reg", ["query", KEY, "/v", "ZCode"], { windowsHide: true });
  let out = "", err = "";
  c.stdout.on("data", d => (out += decodeGbk(d)));
  c.stderr.on("data", d => (err += decodeGbk(d)));
  c.on("close", code => {
    console.log("exit:", code, "| stdout:", JSON.stringify(out.slice(0, 200)), "| stderr:", JSON.stringify(err.slice(0, 200)));
    resolve();
  });
});

console.log("=== B. cmd /c 包装 ===");
await new Promise(resolve => {
  const c = spawn("cmd.exe", ["/c", "reg", "query", KEY, "/v", "ZCode"], { windowsHide: true });
  let out = "", err = "";
  c.stdout.on("data", d => (out += decodeGbk(d)));
  c.stderr.on("data", d => (err += decodeGbk(d)));
  c.on("close", code => {
    console.log("exit:", code, "| stdout:", JSON.stringify(out.slice(0, 200)), "| stderr:", JSON.stringify(err.slice(0, 200)));
    resolve();
  });
});

console.log("=== C. execSync 字符串形式 ===");
try {
  const out = execSync(`reg query "${KEY}" /v ZCode`, { encoding: "utf8" });
  console.log("exit 0 | stdout:", JSON.stringify(out.slice(0, 200)));
} catch (e) {
  console.log("exit", e.status, "| stdout:", JSON.stringify((e.stdout ?? "").slice(0, 200)));
}

console.log("=== D. PowerShell 读取 ===");
try {
  const out = execSync(
    'powershell -NoProfile -Command "$v=(Get-ItemProperty \'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\').ZCode; if($null -ne $v){$v}else{\'<null>\'}"',
    { encoding: "utf8" },
  );
  console.log("PowerShell 读到:", JSON.stringify(out.trim()));
} catch (e) {
  console.log("PowerShell 失败:", e.message.slice(0, 120));
}
