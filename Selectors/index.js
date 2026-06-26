const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");
const { chromium } = require("playwright");

const DEFAULT_INPUT_PATH = path.join(__dirname, "input.json");
const DEFAULT_OUTPUT_PATH = path.join(__dirname, "output.json");
const DESKTOP_CAPTURE_SCRIPT = path.join(__dirname, "capture-desktop.ps1");
const BROWSER_CLOSE_DELAY_MS = 5000;

function logStep(message) {
  console.log(`[selector-tool] ${message}`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchText(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compactText(value) {
  return normalizeSearchText(value).replace(/\s+/g, "");
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

function escapeForRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeForUiPath(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/'/g, "&apos;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function hasStableId(value) {
  if (!value) {
    return false;
  }

  const trimmed = String(value).trim();
  if (trimmed.length < 2 || trimmed.length > 40) {
    return false;
  }

  return /^[a-z][a-z0-9_-]*$/i.test(trimmed) && !/\d{4,}/.test(trimmed);
}

function isLikelyStableValue(value) {
  if (!value) {
    return false;
  }

  const trimmed = normalizeWhitespace(value);
  if (trimmed.length < 2 || trimmed.length > 80) {
    return false;
  }

  if (/\b[a-f0-9]{8,}\b/i.test(trimmed)) {
    return false;
  }

  if (/[_-]?\d{4,}/.test(trimmed)) {
    return false;
  }

  return true;
}

function buildFlexibleRegex(value) {
  const tokens = String(value)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(escapeForRegex);

  if (tokens.length === 0) {
    return null;
  }

  return new RegExp(tokens.join("\\s*"), "i");
}

function buildValueVariable(label, controlType) {
  const cleaned = String(label || "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");

  if (!cleaned) {
    return null;
  }

  if (["input", "textarea", "select", "password"].includes(controlType)) {
    return `in_${cleaned}`;
  }

  return null;
}

function inferIntent(label) {
  const value = normalizeSearchText(label);

  if (!value) {
    return "generic";
  }

  if (/\b(email|e mail|username|user name|login id|phone)\b/.test(value)) {
    return "username_or_email";
  }

  if (/\bpass(word)?|pin|secret\b/.test(value)) {
    return "password";
  }

  if (/\bsearch|find|lookup\b/.test(value)) {
    return "search";
  }

  if (/\b(login|log in|sign in|submit|continue|next|save|send)\b/.test(value)) {
    return "confirm";
  }

  return "generic";
}

function scoreCandidateValue(label, candidateValue) {
  const queryNormalized = normalizeSearchText(label);
  const queryCompact = compactText(label);
  const valueNormalized = normalizeSearchText(candidateValue);
  const valueCompact = compactText(candidateValue);

  if (!queryNormalized || !valueNormalized) {
    return 0;
  }

  if (valueNormalized === queryNormalized || valueCompact === queryCompact) {
    return 120;
  }

  if (
    valueNormalized.startsWith(queryNormalized) ||
    valueNormalized.includes(queryNormalized) ||
    valueCompact.includes(queryCompact)
  ) {
    return 90;
  }

  const queryTokens = queryNormalized.split(/\s+/).filter(Boolean);
  const matchedTokens = queryTokens.filter(
    (token) => valueNormalized.includes(token) || valueCompact.includes(token)
  ).length;

  if (matchedTokens === queryTokens.length && matchedTokens > 0) {
    return 75;
  }

  if (matchedTokens > 0) {
    return matchedTokens * 20;
  }

  return 0;
}

function buildOutputSkeleton(mode, target) {
  return {
    mode,
    target,
    elements: [],
    unmatched: [],
    warnings: [],
  };
}

async function loadInput(inputPath) {
  const raw = await fs.readFile(inputPath, "utf8");
  const input = JSON.parse(raw);

  if (!isPlainObject(input)) {
    throw new Error("input.json must contain a JSON object.");
  }

  const normalizedElements = Array.isArray(input.elements)
    ? input.elements
        .filter((item) => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

  if (normalizedElements.length === 0) {
    throw new Error("`elements` must be a non-empty array of strings.");
  }

  const explicitMode = typeof input.mode === "string" ? input.mode.trim().toLowerCase() : null;
  const resolvedMode =
    explicitMode === "desktop"
      ? "desktop"
      : explicitMode === "web" || input.isWeb === true
        ? "web"
        : "desktop";

  if (resolvedMode === "web") {
    if (typeof input.target !== "string" || input.target.trim() === "") {
      throw new Error("Web mode requires `target` to be a non-empty URL string.");
    }

    if (!isValidHttpUrl(input.target)) {
      throw new Error("Web mode requires `target` to be a valid http or https URL.");
    }

    return {
      mode: "web",
      target: input.target.trim(),
      elements: normalizedElements,
    };
  }

  if (typeof input.target === "string" && input.target.trim()) {
    return {
      mode: "desktop",
      target: {
        windowTitle: input.target.trim(),
      },
      elements: normalizedElements,
    };
  }

  if (!isPlainObject(input.target)) {
    throw new Error(
      "Desktop mode requires `target` to be a string window title or an object with desktop descriptors."
    );
  }

  const desktopTarget = {
    windowTitle:
      typeof input.target.windowTitle === "string" ? input.target.windowTitle.trim() : undefined,
    processName:
      typeof input.target.processName === "string" ? input.target.processName.trim() : undefined,
    executablePath:
      typeof input.target.executablePath === "string"
        ? input.target.executablePath.trim()
        : undefined,
  };

  if (!desktopTarget.windowTitle && !desktopTarget.processName && !desktopTarget.executablePath) {
    throw new Error(
      "Desktop mode target must include at least one of `windowTitle`, `processName`, or `executablePath`."
    );
  }

  return {
    mode: "desktop",
    target: desktopTarget,
    elements: normalizedElements,
  };
}

function addWarning(result, message) {
  if (!result.warnings.includes(message)) {
    result.warnings.push(message);
  }
}

function buildXmlFragment(tag, attributes) {
  const attributeParts = Object.entries(attributes)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
    .map(([key, value]) => `${key}='${escapeForUiPath(value)}'`);

  return `<${tag}${attributeParts.length > 0 ? ` ${attributeParts.join(" ")}` : ""} />`;
}

function detectWebControlType(candidate) {
  const tag = String(candidate.tag || "").toUpperCase();
  const type = normalizeSearchText(candidate.type);
  const role = normalizeSearchText(candidate.role);

  if (type === "password") {
    return "password";
  }

  if (tag === "TEXTAREA") {
    return "textarea";
  }

  if (tag === "SELECT") {
    return "select";
  }

  if (tag === "A" || role === "link") {
    return "link";
  }

  if (tag === "BUTTON" || role === "button" || ["submit", "button"].includes(type)) {
    return "button";
  }

  if (tag === "INPUT") {
    return "input";
  }

  return "generic";
}

function detectDesktopControlType(candidate) {
  const controlType = normalizeSearchText(candidate.controlType);

  if (controlType.includes("edit") || controlType.includes("document")) {
    return "input";
  }

  if (controlType.includes("button")) {
    return "button";
  }

  if (controlType.includes("hyperlink")) {
    return "link";
  }

  if (controlType.includes("combobox")) {
    return "select";
  }

  return "generic";
}

function getRecommendedAction(controlType) {
  if (["input", "password", "textarea", "select"].includes(controlType)) {
    return "Type Into";
  }

  if (["button", "link"].includes(controlType)) {
    return "Click";
  }

  return "Use Application/Browser";
}

function buildConfidence(score) {
  if (score >= 115) {
    return "high";
  }

  if (score >= 70) {
    return "medium";
  }

  return "low";
}

function buildWebUiPathSelectors(candidate) {
  const tag = String(candidate.tag || "").toUpperCase();
  const strictAttributes = { tag };
  const fallbackAttributes = { tag };
  const normalizedRole = normalizeSearchText(candidate.role);

  if (normalizedRole) {
    strictAttributes.role = normalizedRole;
    fallbackAttributes.role = normalizedRole;
  }

  if (isLikelyStableValue(candidate.name)) {
    strictAttributes.name = candidate.name;
  } else if (hasStableId(candidate.id)) {
    strictAttributes.id = candidate.id;
  } else if (isLikelyStableValue(candidate.ariaLabel)) {
    strictAttributes.aaname = candidate.ariaLabel;
  } else if (isLikelyStableValue(candidate.text)) {
    strictAttributes.innertext = candidate.text;
  } else if (isLikelyStableValue(candidate.placeholder)) {
    strictAttributes.placeholder = candidate.placeholder;
  }

  if (Object.keys(strictAttributes).length === 1) {
    return {
      strict: buildXmlFragment("webctrl", strictAttributes),
      fallback: null,
    };
  }

  if (strictAttributes.name) {
    if (hasStableId(candidate.id)) {
      fallbackAttributes.id = candidate.id;
    } else if (isLikelyStableValue(candidate.placeholder)) {
      fallbackAttributes.placeholder = candidate.placeholder;
    } else if (isLikelyStableValue(candidate.ariaLabel)) {
      fallbackAttributes.aaname = candidate.ariaLabel;
    }
  } else if (strictAttributes.id) {
    if (isLikelyStableValue(candidate.name)) {
      fallbackAttributes.name = candidate.name;
    } else if (isLikelyStableValue(candidate.ariaLabel)) {
      fallbackAttributes.aaname = candidate.ariaLabel;
    } else if (isLikelyStableValue(candidate.placeholder)) {
      fallbackAttributes.placeholder = candidate.placeholder;
    }
  } else if (strictAttributes.aaname) {
    if (isLikelyStableValue(candidate.text)) {
      fallbackAttributes.innertext = candidate.text;
    } else if (isLikelyStableValue(candidate.name)) {
      fallbackAttributes.name = candidate.name;
    }
  } else if (strictAttributes.innertext) {
    if (isLikelyStableValue(candidate.ariaLabel) && candidate.ariaLabel !== candidate.text) {
      fallbackAttributes.aaname = candidate.ariaLabel;
    } else if (isLikelyStableValue(candidate.name)) {
      fallbackAttributes.name = candidate.name;
    }
  } else if (strictAttributes.placeholder && isLikelyStableValue(candidate.name)) {
    fallbackAttributes.name = candidate.name;
  }

  const strict = buildXmlFragment("webctrl", strictAttributes);
  const fallback =
    Object.keys(fallbackAttributes).length > 1 ? buildXmlFragment("webctrl", fallbackAttributes) : null;

  return { strict, fallback };
}

function buildDesktopUiPathSelectors(candidate) {
  const wndAttributes = {};
  const ctrlStrict = {};
  const ctrlFallback = {};

  if (candidate.window?.processName) {
    wndAttributes.app = `${candidate.window.processName}.exe`;
  }

  if (isLikelyStableValue(candidate.window?.className)) {
    wndAttributes.cls = candidate.window.className;
  }

  if (isLikelyStableValue(candidate.window?.title)) {
    wndAttributes.title = candidate.window.title;
  }

  if (isLikelyStableValue(candidate.automationId)) {
    ctrlStrict.automationid = candidate.automationId;
  }

  if (candidate.controlType) {
    ctrlStrict.role = candidate.controlType;
    ctrlFallback.role = candidate.controlType;
  }

  if (isLikelyStableValue(candidate.name)) {
    if (!ctrlStrict.automationid) {
      ctrlStrict.name = candidate.name;
    }

    ctrlFallback.name = candidate.name;
  }

  if (isLikelyStableValue(candidate.className)) {
    if (!ctrlStrict.automationid && !ctrlStrict.name) {
      ctrlStrict.cls = candidate.className;
    }

    if (!ctrlFallback.name) {
      ctrlFallback.cls = candidate.className;
    }
  }

  if (isLikelyStableValue(candidate.parent?.name) && !ctrlFallback.name) {
    ctrlFallback.parentname = candidate.parent.name;
  }

  const wndFragment = buildXmlFragment("wnd", wndAttributes);
  const strictFragment = buildXmlFragment("ctrl", ctrlStrict);
  const fallbackFragment =
    Object.keys(ctrlFallback).length > 0 ? buildXmlFragment("ctrl", ctrlFallback) : null;

  return {
    strict: `${wndFragment}${strictFragment}`,
    fallback: fallbackFragment ? `${wndFragment}${fallbackFragment}` : null,
    anchorStrategy:
      fallbackFragment && candidate.parent?.name
        ? `Use window "${candidate.window?.title || candidate.window?.processName}" and parent "${candidate.parent.name}" as anchors.`
        : null,
  };
}

async function captureWebCandidates(page) {
  return page.locator("input, textarea, button, select, a, [role='button'], [role='link'], [role='textbox']").evaluateAll(
    (elements) => {
      const cssEscape =
        typeof CSS !== "undefined" && typeof CSS.escape === "function"
          ? CSS.escape.bind(CSS)
          : (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");

      const attributeEscape = (value) =>
        String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

      const hasStableIdLocal = (value) => {
        if (!value) {
          return false;
        }

        const trimmed = String(value).trim();
        if (trimmed.length < 2 || trimmed.length > 40) {
          return false;
        }

        return /^[a-z][a-z0-9_-]*$/i.test(trimmed) && !/\d{4,}/.test(trimmed);
      };

      const canQueryUniquely = (selector) => {
        try {
          return document.querySelectorAll(selector).length === 1;
        } catch {
          return false;
        }
      };

      const buildCssSelector = (element) => {
        if (element.id && hasStableIdLocal(element.id)) {
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

        const ariaLabel = element.getAttribute("aria-label");
        if (ariaLabel) {
          const selector = `[aria-label='${attributeEscape(ariaLabel)}']`;
          if (canQueryUniquely(selector)) {
            return selector;
          }
        }

        const placeholder = element.getAttribute("placeholder");
        if (placeholder) {
          const selector = `[placeholder='${attributeEscape(placeholder)}']`;
          if (canQueryUniquely(selector)) {
            return selector;
          }
        }

        const tag = element.tagName?.toLowerCase();
        if (tag && canQueryUniquely(tag)) {
          return tag;
        }

        return null;
      };

      return elements.map((element, index) => {
        const parent = element.parentElement;
        return {
          source: "web",
          sourceIndex: index,
          tag: element.tagName || null,
          type: element.getAttribute("type"),
          name: element.getAttribute("name"),
          id: element.getAttribute("id"),
          placeholder: element.getAttribute("placeholder"),
          ariaLabel: element.getAttribute("aria-label"),
          title: element.getAttribute("title"),
          role: element.getAttribute("role"),
          href: element.getAttribute("href"),
          text: (element.innerText || element.textContent || element.value || "").trim(),
          cssSelector: buildCssSelector(element),
          dataTestId: element.getAttribute("data-testid"),
          parentHints: parent
            ? {
                tag: parent.tagName || null,
                id: parent.getAttribute("id"),
                name: parent.getAttribute("name"),
                ariaLabel: parent.getAttribute("aria-label"),
                role: parent.getAttribute("role"),
              }
            : null,
        };
      });
    }
  );
}

function normalizeWebCandidate(candidate) {
  const controlType = detectWebControlType(candidate);
  return {
    ...candidate,
    controlType,
    matchDescriptors: [
      { value: candidate.placeholder, bonus: 30 },
      { value: candidate.ariaLabel, bonus: 25 },
      { value: candidate.name, bonus: 20 },
      { value: candidate.text, bonus: 15 },
      { value: candidate.title, bonus: 10 },
      { value: candidate.id, bonus: hasStableId(candidate.id) ? 15 : 0 },
      { value: candidate.href, bonus: 10 },
    ],
  };
}

function normalizeDesktopCandidate(candidate) {
  const controlType = detectDesktopControlType(candidate);
  return {
    ...candidate,
    source: "desktop",
    controlType,
    matchDescriptors: [
      { value: candidate.name, bonus: 30 },
      { value: candidate.automationId, bonus: isLikelyStableValue(candidate.automationId) ? 35 : 0 },
      { value: candidate.helpText, bonus: 20 },
      { value: candidate.className, bonus: isLikelyStableValue(candidate.className) ? 10 : 0 },
      { value: candidate.parent?.name, bonus: 10 },
      { value: candidate.window?.title, bonus: 5 },
    ],
  };
}

function rankCandidate(label, candidate) {
  let score = 0;

  for (const descriptor of candidate.matchDescriptors || []) {
    const descriptorScore = scoreCandidateValue(label, descriptor.value);
    if (descriptorScore > 0) {
      score = Math.max(score, descriptorScore + (descriptor.bonus || 0));
    }
  }

  if (score === 0) {
    return 0;
  }

  if (["input", "password", "textarea", "select"].includes(candidate.controlType)) {
    score += 15;
  }

  if (["button", "link"].includes(candidate.controlType)) {
    score += 10;
  }

  if (candidate.source === "desktop" && isLikelyStableValue(candidate.automationId)) {
    score += 15;
  }

  if (candidate.source === "web" && candidate.cssSelector) {
    score += 5;
  }

  return score;
}

function buildElementOutput(label, candidate, score, warnings) {
  const selectors =
    candidate.source === "web"
      ? {
          css: candidate.cssSelector,
          ...(() => {
            const emitted = buildWebUiPathSelectors(candidate);
            return {
              uipath_strict: emitted.strict,
              uipath_fallback: emitted.fallback,
            };
          })(),
        }
      : {
          ...(() => {
            const emitted = buildDesktopUiPathSelectors(candidate);
            return {
              uipath_strict: emitted.strict,
              uipath_fallback: emitted.fallback,
              anchorStrategy: emitted.anchorStrategy,
            };
          })(),
        };

  return {
    label,
    intent: inferIntent(label),
    controlType: candidate.controlType,
    sourceAttributes:
      candidate.source === "web"
        ? {
            tag: candidate.tag,
            type: candidate.type,
            name: candidate.name,
            id: candidate.id,
            placeholder: candidate.placeholder,
            ariaLabel: candidate.ariaLabel,
            text: candidate.text,
            role: candidate.role,
            href: candidate.href,
            title: candidate.title,
            parentHints: candidate.parentHints,
          }
        : {
            processName: candidate.processName,
            automationId: candidate.automationId,
            name: candidate.name,
            className: candidate.className,
            controlType: candidate.controlType,
            helpText: candidate.helpText,
            frameworkId: candidate.frameworkId,
            parent: candidate.parent,
            window: candidate.window,
          },
    selectors,
    recommendedAction: getRecommendedAction(candidate.controlType),
    valueVariable: buildValueVariable(label, candidate.controlType),
    confidence: buildConfidence(score),
    warnings,
  };
}

function locateBestMatch(label, candidates) {
  let bestCandidate = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const score = rankCandidate(label, candidate);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (!bestCandidate || bestScore < 45) {
    return null;
  }

  const warnings = [];

  if (bestScore < 70) {
    warnings.push("Low-confidence match based on weak or partial attributes.");
  }

  if (bestCandidate.source === "web" && !bestCandidate.cssSelector) {
    warnings.push("No stable CSS debug selector was found; rely on UiPath selectors.");
  }

  if (bestCandidate.source === "desktop" && !isLikelyStableValue(bestCandidate.automationId)) {
    warnings.push("Desktop match does not have a stable AutomationId; fallback selectors are more important.");
  }

  return {
    candidate: bestCandidate,
    score: bestScore,
    warnings,
  };
}

async function writeOutput(outputPath, result) {
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

async function runDesktopCapture(inputPath) {
  const outputPath = path.join(
    os.tmpdir(),
    `selector-desktop-capture-${process.pid}-${Date.now()}.json`
  );
  const command = [
    `powershell -NoProfile -ExecutionPolicy Bypass`,
    `-File "${DESKTOP_CAPTURE_SCRIPT}"`,
    `-InputPath "${inputPath}"`,
    `| Set-Content -Path "${outputPath}"`,
  ].join(" ");

  execSync(command, {
    cwd: __dirname,
    stdio: "ignore",
    shell: "powershell.exe",
  });

  const raw = await fs.readFile(outputPath, "utf8");
  await fs.unlink(outputPath).catch(() => {});
  return JSON.parse(raw);
}

async function processWeb(input, outputPath) {
  const browser = await chromium.launch({ headless: false, channel: "chromium" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const result = buildOutputSkeleton("uipath_web", input.target);

  page.on("console", (message) => {
    logStep(`browser console [${message.type()}]: ${message.text()}`);
  });

  try {
    logStep(`Opening ${input.target}`);
    await page.goto(input.target, { waitUntil: "domcontentloaded", timeout: 60000 });
    logStep(`Page opened: ${page.url()}`);

    const candidates = (await captureWebCandidates(page)).map(normalizeWebCandidate);

    for (const label of input.elements) {
      logStep(`Searching for "${label}"`);
      const match = locateBestMatch(label, candidates);

      if (!match) {
        logStep(`No selector found for "${label}"`);
        result.unmatched.push(label);
        continue;
      }

      const elementOutput = buildElementOutput(label, match.candidate, match.score, match.warnings);
      result.elements.push(elementOutput);
      logStep(
        `Found "${label}" with confidence ${elementOutput.confidence}. UiPath selector: ${elementOutput.selectors.uipath_strict}`
      );

      if (!elementOutput.selectors.uipath_fallback) {
        addWarning(result, `Element "${label}" does not have a strong fallback selector.`);
      }
    }

    if (result.unmatched.length > 0) {
      addWarning(result, "Some requested elements could not be matched with enough confidence.");
    }

    await writeOutput(outputPath, result);
    logStep(`Results written to ${outputPath}`);
    logStep(`Keeping Chromium open for ${BROWSER_CLOSE_DELAY_MS / 1000} seconds for review`);
    await page.waitForTimeout(BROWSER_CLOSE_DELAY_MS);
  } finally {
    await browser.close();
  }

  return result;
}

async function processDesktop(input, inputPath, outputPath) {
  logStep("Enumerating Windows UI Automation tree for the requested desktop target");
  const captured = await runDesktopCapture(inputPath);
  const result = buildOutputSkeleton("uipath_desktop", captured.targetWindow || input.target);

  const candidates = Array.isArray(captured.candidates)
    ? captured.candidates.map(normalizeDesktopCandidate)
    : [];

  if (!captured.targetWindow) {
    addWarning(result, "Desktop target metadata is incomplete; selectors may be weaker than expected.");
  }

  for (const label of input.elements) {
    logStep(`Searching desktop controls for "${label}"`);
    const match = locateBestMatch(label, candidates);

    if (!match) {
      logStep(`No selector found for "${label}"`);
      result.unmatched.push(label);
      continue;
    }

    const elementOutput = buildElementOutput(label, match.candidate, match.score, match.warnings);
    result.elements.push(elementOutput);
    logStep(
      `Found "${label}" with confidence ${elementOutput.confidence}. UiPath selector: ${elementOutput.selectors.uipath_strict}`
    );

    if (!elementOutput.selectors.uipath_fallback) {
      addWarning(result, `Element "${label}" does not have a strong fallback selector.`);
    }
  }

  if (captured.warnings) {
    for (const warning of captured.warnings) {
      addWarning(result, warning);
    }
  }

  if (result.unmatched.length > 0) {
    addWarning(result, "Some requested desktop elements could not be matched with enough confidence.");
  }

  await writeOutput(outputPath, result);
  logStep(`Results written to ${outputPath}`);
  return result;
}

async function main() {
  const inputPath = path.resolve(process.argv[2] || DEFAULT_INPUT_PATH);
  const outputPath = path.resolve(process.argv[3] || DEFAULT_OUTPUT_PATH);
  const input = await loadInput(inputPath);

  const result =
    input.mode === "web"
      ? await processWeb(input, outputPath)
      : await processDesktop(input, inputPath, outputPath);

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(`[selector-tool] ${error.message}`);
  process.exitCode = 1;
});
