import { test, expect } from "@playwright/test";

test("new test page renders configuration", async ({ page }) => {
  await page.goto("/testing/new");
  await expect(page.getByRole("heading", { name: "New Test" })).toBeVisible();
  await expect(page.getByText("Run Test")).toBeVisible();
});
