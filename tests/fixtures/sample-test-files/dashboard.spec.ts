import { test, expect } from '@playwright/test';

test('should display dashboard widgets', async ({ page }) => {
  await page.goto('https://example.com/dashboard');
  await page.locator('.widget-container').first().click();
  await page.locator('div.chart >> canvas').waitFor();
  await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
});
