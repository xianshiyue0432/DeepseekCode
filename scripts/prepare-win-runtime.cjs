"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const { createWriteStream } = require("node:fs");
const { mkdir, readFile, rename, stat, unlink, writeFile } = require("node:fs/promises");
const https = require("node:https");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEEPSEEK_TUI_ROOT = path.join(PROJECT_ROOT, "node_modules", "deepseek-tui");
const DOWNLOADS_DIR = path.join(DEEPSEEK_TUI_ROOT, "bin", "downloads");
const WINDOWS_ASSETS = [
  {
    assetName: "deepseek-windows-x64.exe",
    targetName: "deepseek.exe"
  },
  {
    assetName: "deepseek-tui-windows-x64.exe",
    targetName: "deepseek-tui.exe"
  }
];
const DOWNLOAD_TIMEOUT_MS = Number(process.env.DEEPSEEK_TUI_WIN_DOWNLOAD_TIMEOUT_MS) || 180000;

function parseArgs(argv = process.argv.slice(2)) {
  return {
    dryRun: argv.includes("--dry-run"),
    json: argv.includes("--json"),
    force: argv.includes("--force")
  };
}

function loadUpstreamMetadata() {
  let pkg;
  let artifacts;
  try {
    pkg = require(path.join(DEEPSEEK_TUI_ROOT, "package.json"));
    artifacts = require(path.join(DEEPSEEK_TUI_ROOT, "scripts", "artifacts.js"));
  } catch (error) {
    throw new Error(`deepseek-tui is not installed. Run npm install first. ${error.message}`);
  }

  return {
    version: pkg.deepseekBinaryVersion || pkg.version,
    repo: process.env.DEEPSEEK_TUI_REPO || "Hmbown/DeepSeek-TUI",
    checksumManifestUrl: artifacts.checksumManifestUrl,
    releaseAssetUrl: artifacts.releaseAssetUrl
  };
}

function buildPlan() {
  const metadata = loadUpstreamMetadata();
  return {
    ok: true,
    platform: "win32",
    arch: "x64",
    version: metadata.version,
    repo: metadata.repo,
    downloadsDir: DOWNLOADS_DIR,
    assets: WINDOWS_ASSETS.map((asset) => ({
      assetName: asset.assetName,
      targetPath: path.join(DOWNLOADS_DIR, asset.targetName),
      versionPath: path.join(DOWNLOADS_DIR, `${asset.targetName}.version`),
      url: metadata.releaseAssetUrl(asset.assetName, metadata.version, metadata.repo)
    }))
  };
}

function requestBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) {
      reject(new Error(`Too many redirects for ${url}`));
      return;
    }

    const request = https.get(url, (response) => {
      const statusCode = response.statusCode || 0;
      const location = response.headers.location;
      if (statusCode >= 300 && statusCode < 400 && location) {
        response.resume();
        requestBuffer(new URL(location, url).toString(), redirects + 1).then(resolve, reject);
        return;
      }
      if (statusCode !== 200) {
        response.resume();
        reject(new Error(`GET ${url} failed with HTTP ${statusCode}`));
        return;
      }

      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    });
    request.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
      request.destroy(new Error(`GET ${url} timed out after ${DOWNLOAD_TIMEOUT_MS} ms`));
    });
    request.on("error", reject);
  });
}

function downloadFile(url, destination, options = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) {
      reject(new Error(`Too many redirects for ${url}`));
      return;
    }

    const request = https.get(url, (response) => {
      const statusCode = response.statusCode || 0;
      const location = response.headers.location;
      if (statusCode >= 300 && statusCode < 400 && location) {
        response.resume();
        downloadFile(new URL(location, url).toString(), destination, options, redirects + 1).then(resolve, reject);
        return;
      }
      if (statusCode !== 200) {
        response.resume();
        reject(new Error(`GET ${url} failed with HTTP ${statusCode}`));
        return;
      }

      const total = Number(response.headers["content-length"]) || 0;
      let received = 0;
      let lastReported = 0;
      const sink = createWriteStream(destination);
      const fail = (error) => {
        sink.destroy();
        reject(error);
      };

      response.on("data", (chunk) => {
        received += chunk.length;
        if (options.onProgress && received - lastReported >= 5 * 1024 * 1024) {
          lastReported = received;
          options.onProgress({ received, total });
        }
      });
      response.on("error", fail);
      sink.on("error", reject);
      sink.on("finish", () => {
        if (options.onProgress) {
          options.onProgress({ received, total, done: true });
        }
        resolve();
      });
      response.pipe(sink);
    });

    request.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
      request.destroy(new Error(`GET ${url} timed out after ${DOWNLOAD_TIMEOUT_MS} ms`));
    });
    request.on("error", reject);
  });
}

function parseChecksumManifest(text) {
  const checksums = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (!match) {
      throw new Error(`Invalid checksum manifest line: ${trimmed}`);
    }
    checksums.set(match[2], match[1].toLowerCase());
  }
  return checksums;
}

async function fileExists(filePath) {
  try {
    const result = await stat(filePath);
    return result.isFile();
  } catch {
    return false;
  }
}

async function readMarkerVersion(filePath) {
  try {
    return (await readFile(filePath, "utf8")).trim();
  } catch {
    return "";
  }
}

async function sha256File(filePath) {
  const content = await readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function downloadAsset(asset, expectedSha256, version, force, options = {}) {
  const existing = await fileExists(asset.targetPath);
  const markerVersion = await readMarkerVersion(asset.versionPath);
  if (!force && existing && markerVersion === String(version)) {
    return { ...asset, status: "cached" };
  }

  await mkdir(path.dirname(asset.targetPath), { recursive: true });
  const tempPath = `${asset.targetPath}.${process.pid}.${Date.now()}.download`;
  await downloadFile(asset.url, tempPath, {
    onProgress: options.onProgress
  });

  try {
    const actualSha256 = await sha256File(tempPath);
    if (actualSha256 !== expectedSha256) {
      throw new Error(`Checksum mismatch for ${asset.assetName}: expected ${expectedSha256}, got ${actualSha256}`);
    }
    await rename(tempPath, asset.targetPath);
    await writeFile(asset.versionPath, String(version), "utf8");
    return { ...asset, status: "downloaded", sha256: actualSha256 };
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function prepareWindowsRuntime(options = {}) {
  const metadata = loadUpstreamMetadata();
  const plan = buildPlan();
  const manifestText = await requestBuffer(metadata.checksumManifestUrl(metadata.version, metadata.repo));
  const checksums = parseChecksumManifest(manifestText.toString("utf8"));
  const assets = [];

  for (const asset of plan.assets) {
    const expectedSha256 = checksums.get(asset.assetName);
    if (!expectedSha256) {
      throw new Error(`Checksum manifest is missing ${asset.assetName}`);
    }
    assets.push(await downloadAsset(asset, expectedSha256, metadata.version, Boolean(options.force), {
      onProgress: options.onProgress ? (progress) => options.onProgress(asset, progress) : null
    }));
  }

  return { ...plan, assets };
}

async function main() {
  const args = parseArgs();
  const plan = buildPlan();
  if (args.dryRun) {
    process.stdout.write(`${JSON.stringify(plan, null, args.json ? 2 : 0)}\n`);
    return;
  }

  const result = await prepareWindowsRuntime({
    force: args.force,
    onProgress: args.json
      ? null
      : (asset, progress) => {
        const mb = (progress.received / 1024 / 1024).toFixed(1);
        const total = progress.total ? ` / ${(progress.total / 1024 / 1024).toFixed(1)} MB` : " MB";
        const status = progress.done ? "downloaded" : "downloading";
        console.log(`${status}: ${asset.assetName} ${mb}${total}`);
      }
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  for (const asset of result.assets) {
    console.log(`${asset.status}: ${asset.targetPath}`);
  }
}

module.exports = {
  buildPlan,
  prepareWindowsRuntime
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`prepare-win-runtime failed: ${error.message}`);
    process.exit(1);
  });
}
