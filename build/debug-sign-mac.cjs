"use strict";

const { signAsync } = require("@electron/osx-sign");

/**
 * electron-builder calls this hook after packaging the .app and before creating
 * dmg/zip artifacts. It keeps real identities usable, but defaults local builds
 * to an ad-hoc identity so debug packages are consistently codesigned.
 */
exports.sign = async function signDebugMacApp(options) {
  if (process.platform !== "darwin") {
    return;
  }

  const identity =
    process.env.DEEPSEEK_TUI_MAC_SIGN_IDENTITY || options.identity || "-";
  const isAdHoc = identity === "-";

  await signAsync({
    ...options,
    identity,
    identityValidation: false,
    preAutoEntitlements: isAdHoc ? false : options.preAutoEntitlements,
  });
};
