import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const standaloneDir = resolve(rootDir, ".next/standalone");
const standaloneServer = resolve(standaloneDir, "server.js");
const standaloneNextDir = resolve(standaloneDir, ".next");

const sourceStaticDir = resolve(rootDir, ".next/static");
const targetStaticDir = resolve(standaloneNextDir, "static");

const sourcePublicDir = resolve(rootDir, "public");
const targetPublicDir = resolve(standaloneDir, "public");

if (!existsSync(standaloneServer)) {
  console.error("[startup] Missing .next/standalone/server.js. Run `npm run build` first.");
  process.exit(1);
}

if (!existsSync(sourceStaticDir)) {
  console.error("[startup] Missing .next/static. Run `npm run build` first.");
  process.exit(1);
}

mkdirSync(standaloneNextDir, { recursive: true });
rmSync(targetStaticDir, { force: true, recursive: true });
cpSync(sourceStaticDir, targetStaticDir, { recursive: true });

if (existsSync(sourcePublicDir)) {
  rmSync(targetPublicDir, { force: true, recursive: true });
  cpSync(sourcePublicDir, targetPublicDir, { recursive: true });
}

console.info("[startup] Synced standalone static/public assets");

const child = spawn(process.execPath, [standaloneServer], {
  env: process.env,
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
