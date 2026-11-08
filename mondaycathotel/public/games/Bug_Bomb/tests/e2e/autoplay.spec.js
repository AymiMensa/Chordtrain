import { test, expect } from '@playwright/test';

test('autonomous gameplay without errors (10 minute stress test)', async ({ page }) => {
  // 增加這組測試的 Timeout 到 650 秒，以免 Playwright 預設的 30s 逾時
  test.setTimeout(650000);

  const errors = [];
  
  page.on('pageerror', err => errors.push('PageError: ' + err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('404 (Not Found)')) {
        errors.push('ConsoleError: ' + text);
      }
    }
  });

  await page.goto('/');

  await expect(page.locator('.title-huge').first()).toBeVisible();
  
  // 點擊電腦對戰
  await page.click('text="電腦雙人對打"');
  
  // 等待 10 分鐘 (600 秒)
  await page.waitForTimeout(600000); 

  if (errors.length > 0) {
      console.error(errors);
  }
  expect(errors).toHaveLength(0);
});
