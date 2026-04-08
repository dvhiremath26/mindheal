import { test, expect } from '@playwright/test';

test('should login successfully', async ({ page }) => {
  await page.goto('https://example.com/login');
  await page.locator('#username').fill('testuser');
  await page.locator('#password').fill('password123');
  await page.locator('#login-btn').click();
  await expect(page.getByText('Welcome')).toBeVisible();
});

test('should show error on invalid login', async ({ page }) => {
  await page.goto('https://example.com/login');
  await page.getByRole('textbox', { name: 'Username' }).fill('invalid');
  await page.getByRole('textbox', { name: 'Password' }).fill('wrong');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByTestId('error-message')).toContainText('Invalid credentials');
});
