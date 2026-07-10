const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..", "..");

module.exports = {
  ROOT_DIR,
  DEFAULT_INPUT_PATH: path.join(ROOT_DIR, "input.json"),
  DEFAULT_OUTPUT_PATH: path.join(ROOT_DIR, "output.json"),
  DESKTOP_CAPTURE_SCRIPT: path.join(ROOT_DIR, "capture-desktop.ps1"),
  BROWSER_CLOSE_DELAY_MS: 5000,
};
