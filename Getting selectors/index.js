const fs = require("fs/promises");
const path = require("path");
const { chromium } = require("playwright");

const INPUT_PATH = path.join(__dirname, "input.json");
const OUTPUT_PATH = path.join(__dirname, "output.json");
const BROWSER_CLOSE_DELAY_MS = 5000;

function logStep(message) {
  console.log(`[selector-tool] ${message}`);
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function loadInput() {
  const raw = await fs.readFile(INPUT_PATH, "utf8");
  const input = JSON.parse(raw);

  if (!input || typeof input !== "object") {
    throw new Error("input.json must contain a JSON object.");
  }

  const { target, isWeb, elements } = input;

  if (typeof target !== "string" || target.trim() === "") {
    throw new Error("`target` must be a non-empty string.");
  }

  if (isWeb !== true) {
    throw new Error("This version is web-only, so `isWeb` must be true.");
  }

  if (!isValidHttpUrl(target)) {
    throw new Error("`target` must be a valid http or https URL.");
  }

  if (!Array.isArray(elements) || elements.length === 0) {
    throw new Error("`elements` must be a non-empty array of strings.");
  }

  const normalizedElements = elements
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  if (normalizedElements.length === 0) {
    throw new Error("`elements` must contain at least one non-empty string.");
  }

  return {
    target: target.trim(),
    isWeb,
    elements: normalizedElements,
  };
}

function escapeForCss(value) {
  if (typeof CSS !== "undefined" && CSS.escape) {
    return CSS.escape(value);
  }

  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function escapeForAttribute(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function buildBestSelector(page, handle, queryText) {
  return handle.evaluate(
    async (element, payload) => {
      const { queryText } = payload;

      const cssEscape =
        typeof CSS !== "undefined" && typeof CSS.escape === "function"
          ? CSS.escape.bind(CSS)
          : (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");

      const attributeEscape = (value) =>
        String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

      const canQueryUniquely = (selector) => {
        try {
          return document.querySelectorAll(selector).length === 1;
        } catch {
          return false;
        }
      };

      const classes = Array.from(element.classList || []).filter(Boolean);
      const stableAttributes = [
        "data-testid",
        "data-test",
        "data-qa",
        "data-cy",
        "aria-label",
        "placeholder",
        "title",
        "type",
        "role",
      ];

      if (element.id) {
        const selector = `#${cssEscape(element.id)}`;
        if (canQueryUniquely(selector)) {
          return selector;
        }
      }

      const dataTestId = element.getAttribute("data-testid");
      if (dataTestId) {
        const selector = `[data-testid='${attributeEscape(dataTestId)}']`;
        if (canQueryUniquely(selector)) {
          return selector;
        }
      }

      const name = element.getAttribute("name");
      if (name) {
        const selector = `[name='${attributeEscape(name)}']`;
        if (canQueryUniquely(selector)) {
          return selector;
        }
      }

      for (const attr of stableAttributes) {
        const value = element.getAttribute(attr);
        if (!value) {
          continue;
        }

        const selector = `[${attr}='${attributeEscape(value)}']`;
        if (canQueryUniquely(selector)) {
          return selector;
        }
      }

      if (classes.length > 0) {
        const selector = `.${classes.map((item) => cssEscape(item)).join(".")}`;
        if (canQueryUniquely(selector)) {
          return selector;
        }
      }

      if (element.tagName) {
        const tagSelector = element.tagName.toLowerCase();
        if (canQueryUniquely(tagSelector)) {
          return tagSelector;
        }
      }

      const exactText = queryText.trim();
      if (exactText) {
        return `text=${exactText}`;
      }

      return null;
    },
    { queryText }
  );
}

async function locateElement(page, elementName) {
  const strategies = [
    { label: "getByRole", locator: page.getByRole("button", { name: elementName, exact: true }) },
    { label: "getByLabel", locator: page.getByLabel(elementName, { exact: true }) },
    { label: "getByPlaceholder", locator: page.getByPlaceholder(elementName, { exact: true }) },
    { label: "getByText", locator: page.getByText(elementName, { exact: true }) },
    {
      label: "input/button attribute match",
      locator: page.locator(
        [
          `input[value="${elementName.replace(/"/g, '\\"')}"]`,
          `input[name="${elementName.replace(/"/g, '\\"')}"]`,
          `button[name="${elementName.replace(/"/g, '\\"')}"]`,
          `[aria-label="${elementName.replace(/"/g, '\\"')}"]`,
        ].join(", ")
      ),
    },
  ];

  for (const strategy of strategies) {
    const count = await strategy.locator.count();
    if (count < 1) {
      continue;
    }

    const first = strategy.locator.first();
    await first.scrollIntoViewIfNeeded().catch(() => {});
    const handle = await first.elementHandle();

    if (!handle) {
      continue;
    }

    const selector = await buildBestSelector(page, handle, elementName);
    await handle.dispose();

    if (selector) {
      return {
        selector,
        strategy: strategy.label,
      };
    }
  }

  return null;
}

async function writeOutput(result) {
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

async function main() {
  const input = await loadInput();
  const browser = await chromium.launch({ headless: false, channel: "chromium" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  page.on("console", (message) => {
    logStep(`browser console [${message.type()}]: ${message.text()}`);
  });

  const result = {
    mode: "web",
    target: input.target,
    matches: {},
    unmatched: [],
  };

  try {
    logStep(`Opening ${input.target}`);
    await page.goto(input.target, { waitUntil: "domcontentloaded", timeout: 60000 });
    logStep(`Page opened: ${page.url()}`);

    for (const elementName of input.elements) {
      logStep(`Searching for "${elementName}"`);
      const located = await locateElement(page, elementName);

      if (!located) {
        logStep(`No selector found for "${elementName}"`);
        result.unmatched.push(elementName);
        continue;
      }

      result.matches[elementName] = located.selector;
      logStep(
        `Found "${elementName}" using ${located.strategy}. Selected selector: ${located.selector}`
      );
    }

    await writeOutput(result);
    logStep(`Results written to ${OUTPUT_PATH}`);
    logStep(`Keeping Chromium open for ${BROWSER_CLOSE_DELAY_MS / 1000} seconds for review`);
    await page.waitForTimeout(BROWSER_CLOSE_DELAY_MS);
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch(async (error) => {
  console.error(`[selector-tool] ${error.message}`);
  process.exitCode = 1;
});
