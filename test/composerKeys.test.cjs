const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function loadComposerKeys() {
  const sourcePath = path.resolve(__dirname, "../src/composerKeys.ts");
  const source = fs.readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    }
  }).outputText;

  const module = { exports: {} };
  const load = new Function("module", "exports", compiled);
  load(module, module.exports);
  return module.exports;
}

test("composer shortcut submits on plain Enter only", () => {
  const { shouldSubmitComposerShortcut } = loadComposerKeys();

  assert.equal(shouldSubmitComposerShortcut({ key: "Enter" }), true);
  assert.equal(shouldSubmitComposerShortcut({ key: "Enter", shiftKey: true }), false);
  assert.equal(shouldSubmitComposerShortcut({ key: "Enter", nativeEvent: { isComposing: true } }), false);
  assert.equal(shouldSubmitComposerShortcut({ key: "a" }), false);
});
