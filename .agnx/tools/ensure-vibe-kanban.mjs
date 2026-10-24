#!/usr/bin/env node
/**
 * 场景：Agnx 子应用 vibe-kanban 的受管 sidecar 启动脚本。
 * 用法：node .agnx/tools/ensure-vibe-kanban.mjs --port 8120 --work-dir <dataRoot> [--supervised]
 * 输出（stdout 最后一行 JSON）：
 *   - 已就绪复用：{"ok":true,"reused":true,"origin":"http://127.0.0.1:8120","pid":N}
 *   - 需拉起：    {"ok":true,"reused":false,"plan":{command,args,cwd,env,fingerprint,healthUrl,port}}
 *
 * 上游端口约定（不改业务代码，纯环境变量，依据 crates/server/src/main.rs）：
 *   BACKEND_PORT / PORT → 监听端口；HOST → 绑定地址（默认 127.0.0.1）。
 *   PREVIEW_PROXY_PORT → 预览反代端口，不给则上游随机取（0 = 自动分配），与主端口无关，故不占用批次端口。
 * 上游数据目录（依据 crates/utils/src/assets.rs，directories::ProjectDirs("ai","bloop","vibe-kanban")）：
 *   macOS → ~/Library/Application Support/ai.bloop.vibe-kanban
 *   用 XDG_DATA_HOME 把 macOS 的 Application Support 基址重定向到 $AGNX_APP_DATA_ROOT 下，不改上游代码。
 *
 * 已知上游行为（无法用启动参数关闭，见 EMBED.md 缺口表）：release 版启动成功后无条件调用
 *   utils::browser::open_browser()，macOS 上硬编码 /usr/bin/open；失败仅 warn，不影响服务。
 */
import { spawn } from "node:child_process";
import { access, constants as fsConstants, mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const APP_ID = "vibe-kanban";
const STATE_FILE = "vibe-kanban.json";
const DEFAULT_PORT = 8120;
const BINARY_REL = path.join(".agnx", "bin", "vibe-kanban");

function parseArgs(argv) {
  const out = {
    port: Number(process.env.VIBE_KANBAN_PORT ?? DEFAULT_PORT),
    workDir: process.env.AGNX_APP_DATA_ROOT || "",
    supervised: false,
    forceRestart: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--port" && next) {
      const n = Number(next);
      if (Number.isFinite(n) && n > 0) out.port = n;
      i += 1;
    } else if ((arg === "--work-dir" || arg === "--workDir") && next) {
      out.workDir = String(next).trim();
      i += 1;
    } else if (arg === "--supervised") {
      out.supervised = true;
    } else if (arg === "--force-restart") {
      out.forceRestart = true;
    }
  }
  return out;
}

async function exists(p) {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function statePath(workDir) {
  return path.join(workDir, STATE_FILE);
}

async function readState(workDir) {
  try {
    return JSON.parse(await readFile(statePath(workDir), "utf8"));
  } catch {
    return null;
  }
}

function healthOnce(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

async function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await healthOnce(url)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/** 数据根：宿主注入 --work-dir；缺失就是宿主协议不一致，必须显式报错，不能瞎写到 repo 里。 */
function resolveWorkDir(args) {
  if (!args.workDir) return null;
  return path.resolve(args.workDir);
}

function buildEnv(workDir, port) {
  // XDG_DATA_HOME 在 macOS 上不被 directories 的 ProjectDirs 使用（它走 ~/Library/Application Support），
  // 因此真正的重定向由 HOME 完成：把 HOME 指到数据根，ProjectDirs 就会解析到
  // <dataRoot>/Library/Application Support/ai.bloop.vibe-kanban。
  const home = path.join(workDir, "home");
  return {
    HOME: home,
    // XDG 一并给上：Linux 上 ProjectDirs 走这里（同一份 ensure 脚本跨平台可用）。
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    BACKEND_PORT: String(port),
    PORT: String(port),
    HOST: "127.0.0.1",
    RUST_LOG: "info",
    // 避免上游把任何 Tauri/桌面端路径当默认浏览器目标。
    BROWSER: "/usr/bin/true",
    PATH: process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin",
  };
}

function fingerprintOf(port, workDir) {
  return createHash("sha256").update(`${APP_ID}:${port}:${workDir}`).digest("hex").slice(0, 16);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const port = args.port;
  const origin = `http://127.0.0.1:${port}`;
  const healthUrl = `${origin}/api/health`;

  const workDir = resolveWorkDir(args);
  if (!workDir) {
    console.error("ENSURE_MISSING_DATA_ROOT: 需要 --work-dir 或 AGNX_APP_DATA_ROOT");
    process.exit(2);
  }
  await mkdir(workDir, { recursive: true });

  const binaryPath = path.join(repoRoot, BINARY_REL);
  if (!(await exists(binaryPath))) {
    console.error(`ENSURE_BINARY_MISSING: ${binaryPath}`);
    process.exit(3);
  }

  // 1) 端口已就绪 → 复用（避免重复 spawn 撞端口）
  if (await healthOnce(healthUrl)) {
    const state = await readState(workDir);
    console.log(JSON.stringify({ ok: true, reused: true, origin, pid: state?.pid ?? null, port }));
    return;
  }

  const env = buildEnv(workDir, port);
  const fingerprint = fingerprintOf(port, workDir);
  const runtimeDir = path.join(repoRoot, ".agnx-runtime");
  await mkdir(runtimeDir, { recursive: true });
  const logFile = path.join(runtimeDir, `${APP_ID}.log`);

  if (args.supervised) {
    // 只输出 plan，交给 daemon supervisor 拉起（它负责 pid / 日志 / 退出清理）
    console.log(
      JSON.stringify({
        ok: true,
        reused: false,
        plan: {
          command: binaryPath,
          args: [],
          cwd: repoRoot,
          env,
          fingerprint,
          healthUrl,
          port,
          logFile,
        },
      }),
    );
    return;
  }

  // 2) 短跑模式：自己 spawn（stdio 重定向到日志文件，绝不用 pipe）
  const out = await import("node:fs").then((m) => m.openSync(logFile, "a"));
  const child = spawn(binaryPath, [], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();

  const ok = await waitForHealth(healthUrl, 180_000);
  if (!ok) {
    console.error(`ENSURE_HEALTH_TIMEOUT: ${healthUrl}（日志：${logFile}）`);
    process.exit(4);
  }
  await writeFile(
    statePath(workDir),
    JSON.stringify({ appId: APP_ID, port, pid: child.pid, fingerprint, logFile }, null, 2),
    "utf8",
  );
  console.log(JSON.stringify({ ok: true, reused: false, origin, pid: child.pid, port }));
}

main().catch((err) => {
  console.error(`ENSURE_FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
