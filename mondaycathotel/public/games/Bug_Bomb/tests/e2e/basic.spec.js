import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
  await page.goto('http://localhost:5173/');
  await expect(page).toHaveTitle(/Bomber Arena Ultimate/);
});

test('main menu is visible', async ({ page }) => {
  await page.goto('http://localhost:5173/');
  const menu = page.locator('#main-menu');
  await expect(menu).toBeVisible();
});
