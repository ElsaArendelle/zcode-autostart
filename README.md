# zcode-autostart

ZCode 开机自启开关插件：装上后在 **设置 → 插件 → 开机自启** 中提供开关，写入 Windows 当前用户启动项（HKCU Run 键），登录后自动启动 ZCode。附带侧栏控制中心面板，可即时查看与切换状态。

## 功能

- **设置开关**：`设置 → 插件 → 开机自启 → 高级信息 → 配置` 中的「开机自启」开关，保存后自动应用到系统启动项
- **控制中心面板**：详情页「打开」展开——大开关即时切换、状态徽章、启动命令、与插件设置不一致时一键「应用设置」
- **Agent 工具**：会话内可调用 `get_status` / `set_autostart` / `sync_from_config`
- 无需管理员权限；用户级启动项，随时可撤销

## 目录结构

```
zcode-autostart/
├── .zcode-plugin/plugin.json   # 插件清单（userConfig + MCP 服务器 + 面板声明）
├── assets/icon.png             # 插件图标
├── dist/server.mjs             # MCP 服务器（stdio）
├── dist/ui/panel.html          # 控制中心面板（MCP Apps，单文件）
├── smoke.mjs                   # 冒烟测试（真实读写注册表，测完恢复）
├── verify.mjs                  # Run 键与配置一致性校验
└── diag-reg.mjs                # 注册表查询方式对照诊断
```

## 安装（本地市场）

仓库根目录即市场根（含 `marketplace.json`）：

1. ZCode → 插件市场 → 添加 → 添加插件市场，选择本仓库根目录
2. 个人 → ZCode Autostart → 安装
3. 新建任务，详情页「打开」即可打开控制中心

## 数据流

```
设置开关(userConfig.enabled) ──保存──▶ config.json ──启动同步──▶ HKCU Run 键
面板开关 ────set_autostart──────────────────────────────────▶ HKCU Run 键（立即）
```

- 真源是 `~/.zcode/cli/config.json` 的 `plugins.options["zcode-autostart@<市场>"].enabled`
- MCP 服务器每次启动按真源对齐注册表；面板开关立即写入

## 开发

- 修改代码后递增 `.zcode-plugin/plugin.json` 与 `marketplace.json` 的版本号
- 插件市场 → 市场源 → 刷新本市场 → 个人页点「更新」
- 冒烟测试：`node smoke.mjs`；状态校验：`node verify.mjs`

## 注意

- 启动项写入 `HKCU\...\Run`，值名 `ZCode`，值 `"C:\Program Files\ZCode\ZCode.exe"`（可在插件设置中改路径）
- 卸载插件会从启动项移除该值
