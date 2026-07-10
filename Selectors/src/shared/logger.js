function logStep(message) {
  console.log(`[selector-tool] ${message}`);
}

function logError(message) {
  console.error(`[selector-tool] ${message}`);
}

module.exports = {
  logStep,
  logError,
};
