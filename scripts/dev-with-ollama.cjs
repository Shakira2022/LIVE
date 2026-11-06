const { existsSync } = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const { loadEnvConfig } = require("@next/env");

loadEnvConfig(process.cwd());

let baseUrl = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const model = process.env.OLLAMA_MODEL || "qwen2.5:1.5b-instruct";
const translationBaseUrl = (process.env.LIVE_TRANSLATION_BASE_URL || "http://127.0.0.1:9931").replace(/\/$/, "");
const translationModel = process.env.LIVE_TRANSLATION_MODEL || "qvac/TranslatePsy-AfriSLM-0.8B-Q4-GGUF:Q4_K_M";

function isLocalEndpoint(value) {
  try {
    return ["localhost", "127.0.0.1", "::1"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

async function getInstalledModels() {
  const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`);
  const payload = await response.json();
  return Array.isArray(payload.models) ? payload.models : [];
}

function canBindLocalPort(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      probe.close(() => resolve(true));
    });
  });
}

function ollamaPortCandidates() {
  const configured = Number(new URL(baseUrl).port || 11434);
  const candidates = [configured, 11434];
  // Windows may reserve blocks of ports for system networking. Probe a range
  // and skip ports that cannot be bound instead of assuming 11434 is free.
  for (let port = Math.max(1024, configured); port <= Math.min(65535, configured + 1000); port += 1) {
    candidates.push(port);
  }
  return [...new Set(candidates)];
}

function ollamaExecutable() {
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const installedPath = path.join(process.env.LOCALAPPDATA, "Programs", "Ollama", "ollama.exe");
    if (existsSync(installedPath)) return installedPath;
  }
  return process.platform === "win32" ? "ollama.exe" : "ollama";
}

async function ensureOllama() {
  try {
    return await getInstalledModels();
  } catch {
    if (!isLocalEndpoint(baseUrl)) {
      throw new Error(`Cannot reach Ollama at ${baseUrl}. This is not a local Ollama address, so LIVE cannot start it automatically.`);
    }

    const executable = ollamaExecutable();
    const originalUrl = new URL(baseUrl);
    const host = originalUrl.hostname === "localhost" ? "127.0.0.1" : originalUrl.hostname;
    let lastFailure = "No available local port was found.";
    const startupDeadline = Date.now() + 45_000;

    for (const port of ollamaPortCandidates()) {
      if (Date.now() >= startupDeadline) break;
      if (!(await canBindLocalPort(port))) continue;

      baseUrl = `${originalUrl.protocol}//${host}:${port}`;
      process.env.OLLAMA_BASE_URL = baseUrl;
      process.env.OLLAMA_HOST = `${host}:${port}`;
      console.log(`Starting Ollama at ${baseUrl}...`);

      const server = spawn(executable, ["serve"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: process.env,
      });
      let startError;
      let exitCode;
      server.once("error", (error) => {
        startError = error;
      });
      server.once("exit", (code) => {
        exitCode = code;
      });
      server.unref();

      const deadline = Math.min(Date.now() + 15_000, startupDeadline);
      while (Date.now() < deadline && !startError && exitCode === undefined) {
        await delay(750);
        try {
          return await getInstalledModels();
        } catch {
          // Keep waiting while Ollama initializes, then move on if it exits.
        }
      }

      if (startError) {
        lastFailure = `Could not start Ollama (${startError.message}).`;
      } else if (exitCode !== undefined) {
        lastFailure = `Ollama exited with code ${exitCode} on port ${port}.`;
      } else {
        lastFailure = `Ollama did not respond on port ${port} within 15 seconds.`;
        server.kill();
      }
    }

    throw new Error(`${lastFailure} Tried available local ports starting at ${originalUrl.port || "11434"}.`);
  }
}

async function getTranslationModels() {
  const response = await fetch(`${translationBaseUrl}/v1/models`, { signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error(`Translation server returned HTTP ${response.status}.`);
  const payload = await response.json();
  return Array.isArray(payload.data) ? payload.data : [];
}

function llamaServerExecutable() {
  return process.platform === "win32" ? "llama-server.exe" : "llama-server";
}

async function ensureTranslationServer() {
  try {
    return await getTranslationModels();
  } catch {
    if (!isLocalEndpoint(translationBaseUrl)) {
      throw new Error(`Cannot reach the translation server at ${translationBaseUrl}. This is not a local address, so LIVE cannot start it automatically.`);
    }

    const translationUrl = new URL(translationBaseUrl);
    const port = translationUrl.port || "9931";
    const host = translationUrl.hostname === "localhost" ? "127.0.0.1" : translationUrl.hostname;
    console.log(`Translation server is not running at ${translationBaseUrl}; starting llama.cpp with ${translationModel}...`);
    const server = spawn(llamaServerExecutable(), [
      "--hf-repo", translationModel,
      "--alias", translationModel,
      "--host", host,
      "--port", port,
    ], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    let startError;
    server.once("error", (error) => {
      startError = error;
    });
    server.unref();

    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      await delay(1000);
      try {
        return await getTranslationModels();
      } catch {
        if (startError) break;
      }
    }

    if (startError) {
      throw new Error(`Could not start llama.cpp (${startError.message}). Install llama.cpp and ensure llama-server is on PATH, then run npm run dev again.`);
    }
    throw new Error(`Started llama.cpp, but the translation API did not respond at ${translationBaseUrl} within 180 seconds. Check the model download and available memory, then try again.`);
  }
}

async function main() {
  try {
    const [models] = await Promise.all([ensureOllama(), ensureTranslationServer()]);
    const installed = models.some((item) => item.name === model || item.model === model);
    if (!installed) {
      throw new Error(`Ollama is running, but ${model} is not installed. Run "ollama pull ${model}" once, then retry.`);
    }

    console.log(`Ollama ready · ${model}`);
    console.log(`Translation server ready for ${translationModel}`);
    const nextBin = require.resolve("next/dist/bin/next");
    const next = spawn(process.execPath, [nextBin, "dev", ...process.argv.slice(2)], {
      stdio: "inherit",
      env: process.env,
      windowsHide: false,
    });

    next.once("error", (error) => {
      console.error(`Could not start Next.js: ${error.message}`);
      process.exitCode = 1;
    });
    next.once("close", (code) => {
      process.exitCode = code ?? 1;
    });
  } catch (error) {
    console.error(`LIVE AI startup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

void main();
