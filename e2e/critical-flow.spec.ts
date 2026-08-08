import { test, expect } from '@playwright/test';
import { loginAs } from './helpers';

test.describe('First-time setup and dashboard', () => {
  test('loading the app as the owner lands on a working dashboard', async ({ page }) => {
    await loginAs(page, 'owner');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Signed in as')).toBeVisible();
    await expect(page.getByText('owner@example.com')).toBeVisible();
    await expect(page.getByText('Store owner')).toBeVisible();
  });
});

test.describe('Browsing and importing designs', () => {
  test('browses designs, imports one, and observes it succeed with a mapping', async ({ page }) => {
    await loginAs(page, 'owner');
    await page.getByRole('link', { name: 'Designs' }).click();
    await expect(page.getByRole('heading', { name: 'Designs' })).toBeVisible();

    const firstRow = page.getByText('Custom Tee — Pattern 1', { exact: true });
    await expect(firstRow).toBeVisible();

    // Open the preview drawer for the first design.
    await firstRow.click();
    await expect(page.getByText('Design ID: design-1')).toBeVisible();
    await page.keyboard.press('Escape');

    // Import the first design.
    const importButtons = page.getByRole('button', { name: 'Import' });
    await importButtons.first().click();
    await expect(page.getByText('Import started.')).toBeVisible();

    // The worker process picks the job up asynchronously — poll by
    // refreshing until the design shows as imported.
    await expect
      .poll(
        async () => {
          await page.getByRole('button', { name: 'Refresh' }).click();
          return page.getByText('Imported', { exact: true }).count();
        },
        { timeout: 20_000, intervals: [1000, 1000, 2000, 2000] },
      )
      .toBeGreaterThan(0);
  });

  test('re-importing an unchanged design does not create a duplicate mapping', async ({ page }) => {
    await loginAs(page, 'owner');
    await page.getByRole('link', { name: 'Imports' }).click();
    await expect(page.getByRole('heading', { name: 'Import history' })).toBeVisible();

    await expect
      .poll(async () => page.getByText('SUCCEEDED').count(), {
        timeout: 20_000,
        intervals: [1000, 2000],
      })
      .toBeGreaterThan(0);

    await page.getByRole('link', { name: 'Designs' }).click();
    await expect(page.getByText('Custom Tee — Pattern 1', { exact: true })).toBeVisible();

    // design-1 is already imported and unchanged — its action button
    // should now read "Re-import", not "Import".
    await expect(page.getByRole('button', { name: 'Re-import' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Re-import' }).first().click();
    await expect(page.getByText('Import started.')).toBeVisible();

    await expect
      .poll(
        async () => {
          await page.getByRole('link', { name: 'Imports' }).click();
          return page.getByText('SKIPPED').count();
        },
        { timeout: 20_000, intervals: [1000, 1000, 2000, 2000] },
      )
      .toBeGreaterThan(0);
  });
});

test.describe('Settings', () => {
  test('the owner can update import defaults', async ({ page }) => {
    await loginAs(page, 'owner');
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByText('Connected')).toBeVisible();
    await expect(page.getByText('mock-tenant')).toBeVisible();

    const skuInput = page.getByLabel('SKU prefix');
    await skuInput.fill('E2ETEST');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Settings saved.')).toBeVisible();
  });

  test('a non-owner cannot see credential-rotation controls', async ({ page }) => {
    await loginAs(page, 'staff');
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(
      page.getByText('Only the store owner can change the Kickflip connection.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Disconnect' })).toHaveCount(0);
  });
});
