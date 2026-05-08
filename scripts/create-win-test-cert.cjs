"use strict";

const fs = require("node:fs");
const { mkdir } = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const CERT_DIR = path.join(PROJECT_ROOT, "build", "certs");
const DEFAULT_PUBLISHER = "DeepSeek TUI Desktop Local Test";
const DEFAULT_PASSWORD = "deepseek-tui-local-test";
const PASSWORD_ENV = "DEEPSEEK_TUI_WIN_CERT_PASSWORD";

function parseArgs(argv = process.argv.slice(2)) {
  return {
    dryRun: argv.includes("--dry-run"),
    json: argv.includes("--json"),
    force: argv.includes("--force"),
    publisher: valueAfter(argv, "--publisher") || DEFAULT_PUBLISHER
  };
}

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : "";
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "deepseek-tui-desktop-local-test";
}

function certificatePassword(env = process.env) {
  return env[PASSWORD_ENV] || DEFAULT_PASSWORD;
}

function certificatePlan(options = {}) {
  const publisher = options.publisher || DEFAULT_PUBLISHER;
  const baseName = slugify(publisher);
  return {
    ok: true,
    publisher,
    passwordEnv: PASSWORD_ENV,
    defaultPassword: DEFAULT_PASSWORD,
    certDir: CERT_DIR,
    keyPath: path.join(CERT_DIR, `${baseName}.key`),
    crtPath: path.join(CERT_DIR, `${baseName}.crt`),
    pfxPath: path.join(CERT_DIR, `${baseName}.pfx`)
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    stdio: options.stdio || "pipe"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

async function createCertificate(options = {}) {
  const plan = certificatePlan(options);
  if (!options.force && fs.existsSync(plan.pfxPath)) {
    return { ...plan, status: "cached" };
  }

  await mkdir(plan.certDir, { recursive: true });
  const password = certificatePassword(options.env || process.env);
  const subject = `/CN=${plan.publisher}`;

  run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:3072",
    "-sha256",
    "-nodes",
    "-days",
    "825",
    "-subj",
    subject,
    "-keyout",
    plan.keyPath,
    "-out",
    plan.crtPath
  ]);

  run("openssl", [
    "pkcs12",
    "-export",
    "-out",
    plan.pfxPath,
    "-inkey",
    plan.keyPath,
    "-in",
    plan.crtPath,
    "-name",
    plan.publisher,
    "-passout",
    `pass:${password}`
  ]);

  return { ...plan, status: "created" };
}

async function main() {
  const args = parseArgs();
  const plan = certificatePlan({ publisher: args.publisher });
  if (args.dryRun) {
    process.stdout.write(`${JSON.stringify(plan, null, args.json ? 2 : 0)}\n`);
    return;
  }

  const result = await createCertificate({
    publisher: args.publisher,
    force: args.force
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  console.log(`${result.status}: ${result.pfxPath}`);
  console.log(`Set ${PASSWORD_ENV} if you override the default local-test password.`);
}

module.exports = {
  DEFAULT_PASSWORD,
  PASSWORD_ENV,
  certificatePassword,
  certificatePlan,
  createCertificate
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`create-win-test-cert failed: ${error.message}`);
    process.exit(1);
  });
}
