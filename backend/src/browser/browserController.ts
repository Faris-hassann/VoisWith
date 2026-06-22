import { chromium, Browser, Page } from '@playwright/test';

let browser: Browser | undefined;
let page: Page | undefined;

export async function openBrowser(url = 'about:blank') {
  browser ??= await chromium.launch({ headless: false });
  page = await browser.newPage();
  await page.goto(url);
  return { url: page.url() };
}

export async function sendPromptToAiPage(prompt: string, aiPageUrl = process.env.AI_PAGE_URL ?? 'https://copilot.microsoft.com/') {
  if (!page) await openBrowser(aiPageUrl);
  if (!page) throw new Error('Browser page was not initialized.');
  await page.goto(aiPageUrl);
  const textbox = page.getByRole('textbox').first();
  await textbox.fill(prompt, { timeout: 15000 });
  return { url: page.url(), typed: true };
}
