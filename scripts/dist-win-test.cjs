"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  DEFAULT_PASSWORD,
  PASSWORD_ENV,
  certificatePassword,
  certificatePlan
} = require("./create-win-test-cert.cjs");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  return {
    dryRun: argv.includes("--dry-run"),
    json: argv.includes("--json")
  };
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function buildPlan(env = process.env) {
  const cert = certificatePlan();
  const password = certificatePassword(env);
  return {
    ok: true,
    cert,
    passwordEnv: PASSWORD_ENV,
    usesDefaultPassword: password === DEFAULT_PASSWORD,
    commands: [
      {
        command: npmCommand(),
        args: ["run", "cert:win:self-signed"]
      },
      {
        command: npmCommand(),
        args: ["run", "dist:win"],
        env: {
          CSC_LINK: cert.pfxPath,
          WIN_CSC_LINK: cert.pfxPath,
          CSC_KEY_PASSWORD: `<${PASSWORD_ENV}>`,
          WIN_CSC_KEY_PASSWORD: `<${PASSWORD_ENV}>`
        }
      }
    ]
  };
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    env,
    stdio: "inherit"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status}`);
  }
}

function signingEnv(env = process.env) {
  const cert = certificatePlan();
  const password = certificatePassword(env);
  return {
    ...env,
    [PASSWORD_ENV]: password,
    CSC_LINK: cert.pfxPath,
    WIN_CSC_LINK: cert.pfxPath,
    CSC_KEY_PASSWORD: password,
    WIN_CSC_KEY_PASSWORD: password
  };
}

function main() {
  const args = parseArgs();
  const plan = buildPlan();
  if (args.dryRun) {
    process.stdout.write(`${JSON.stringify(plan, null, args.json ? 2 : 0)}\n`);
    return;
  }

  const env = signingEnv();
  run(npmCommand(), ["run", "cert:win:self-signed"], env);
  run(npmCommand(), ["run", "dist:win"], env);
}

module.exports = {
  buildPlan,
  signingEnv
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`dist-win-test failed: ${error.message}`);
    process.exit(1);
  }
}
