const readline = require("readline");

function waitForEnter(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`${message}\nPress Enter to continue... `, () => {
      rl.close();
      resolve();
    });
  });
}

function createEnterWaiter(message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let settled = false;
  let resolver = null;

  const promise = new Promise((resolve) => {
    resolver = resolve;
    rl.question(`${message}\nPress Enter to continue... `, () => {
      if (!settled) {
        settled = true;
        rl.close();
        resolve("enter");
      }
    });
  });

  return {
    promise,
    cancel() {
      if (!settled) {
        settled = true;
        rl.close();
        if (resolver) {
          resolver("cancelled");
        }
      }
    },
  };
}

module.exports = {
  waitForEnter,
  createEnterWaiter,
};
