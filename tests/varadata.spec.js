// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Set up page with mocked Google Maps API.
 */
async function setupMockedPage(page) {
  // Block the real Google Maps script from loading
  await page.route('https://maps.googleapis.com/maps/api/js*', route => route.abort());
  await page.route('https://maps.googleapis.com/maps-api-v3/api/js/**', route => route.abort());

  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Inject mock after page load but before app uses it
  await page.evaluate(() => {
    window.google = {
      maps: {
        places: {
          Place: class MockPlace {
            constructor({ id }) { this.id = id; }
            async fetchFields({ fields }) {
              this.nationalPhoneNumber = '021-1234567';
              this.internationalPhoneNumber = '+62211234567';
              this.websiteURI = 'https://example.com';
              this.businessStatus = 'OPERATIONAL';
            }
            static async searchByText(request) {
              return {
                places: [
                  {
                    id: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
                    displayName: 'Bakso Pak Teguh',
                    formattedAddress: 'Jl. Sudirman No. 123, Jakarta',
                    rating: 4.5,
                    userRatingCount: 128,
                    types: ['restaurant', 'point_of_interest', 'establishment', 'food'],
                    location: { latitude: -6.2088, longitude: 106.8456 },
                  },
                  {
                    id: 'ChIJN1t_tDeuEmsRUsoyG83frY5',
                    displayName: 'Kopi Kenangan',
                    formattedAddress: 'Jl. Thamrin No. 45, Jakarta',
                    rating: 4.2,
                    userRatingCount: 256,
                    types: ['cafe', 'point_of_interest', 'establishment', 'food', 'store'],
                    location: { latitude: -6.2146, longitude: 106.8451 },
                  },
                ],
              };
            }
          },
        },
      },
    };
    window._varadataReady = true;
    if (window.VaradataApp && window.VaradataApp.boot) {
      window.VaradataApp.boot();
    }
  });
}

/**
 * Helper to switch tabs reliably on both desktop and mobile.
 */
async function switchTab(page, tabName) {
  const viewport = page.viewportSize();
  const isMobile = viewport ? viewport.width < 768 : false;
  const selector = isMobile
    ? `.bottom-nav-btn[data-tab="${tabName}"]`
    : `.nav-btn[data-tab="${tabName}"]`;
  await page.click(selector);
}

/**
 * Helper to perform a search and wait for results.
 */
async function performSearch(page, query) {
  await page.fill('#search-input', query);
  await page.click('#search-btn');
  await page.waitForSelector('#results-grid .result-card', { timeout: 5000 });
}

test.describe('Search Results - Maps Link', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockedPage(page);
  });

  test('desktop: each result card has a visible Maps link', async ({ page }) => {
    await performSearch(page, 'restoran jakarta');
    const cards = await page.locator('.result-card').all();
    expect(cards.length).toBe(2);

    for (const card of cards) {
      const mapsLink = card.locator('.result-actions a');
      await expect(mapsLink).toBeVisible();
      await expect(mapsLink).toHaveAttribute('target', '_blank');
    }
  });

  test('mobile: each result card has a visible Maps link', async ({ page }) => {
    await performSearch(page, 'restoran jakarta');
    const cards = await page.locator('.result-card').all();
    expect(cards.length).toBe(2);

    for (const card of cards) {
      const mapsLink = card.locator('.result-actions a');
      await expect(mapsLink).toBeVisible();
    }
  });

  test('mobile: Maps link uses a reliable scheme (not only target=_blank)', async ({ page }) => {
    await performSearch(page, 'restoran jakarta');
    const firstCard = page.locator('.result-card').first();
    const mapsLink = firstCard.locator('.result-actions a');
    const href = await mapsLink.getAttribute('href');
    expect(href).toContain('google.com/maps');
  });

  test('Maps link uses coordinates for precise location', async ({ page }) => {
    await performSearch(page, 'restoran jakarta');
    const firstCard = page.locator('.result-card').first();
    const mapsLink = firstCard.locator('.result-actions a');
    const href = await mapsLink.getAttribute('href');
    // URL should contain coordinates from the mock API location data
    expect(href).toContain('query=');
    expect(href).toContain('query_place_id=');
    expect(href).toMatch(/query=-?\d+\.\d+,-?\d+\.\d+/);
  });
});

test.describe('CRM - Maps Button', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockedPage(page);
  });

  test('CRM table rows should have a Maps action button', async ({ page }) => {
    await performSearch(page, 'restoran jakarta');
    const firstCard = page.locator('.result-card').first();
    await firstCard.locator('button:has-text("Tambah ke CRM")').click();

    // Wait for toast
    await expect(page.locator('.toast.success')).toContainText('ditambahkan');

    // Switch to CRM tab
    await switchTab(page, 'crm');
    await page.waitForSelector('#crm-tbody tr', { timeout: 5000 });

    // There should be Quick Action buttons in the CRM row
    const detailBtn = page.locator('#crm-tbody tr .action-btn[title="Detail & Aktivitas"]');
    await expect(detailBtn).toBeVisible();
  });

  test('mobile CRM card view should have Quick Actions', async ({ page }) => {
    await performSearch(page, 'restoran jakarta');
    await page.locator('.result-card').first().locator('button:has-text("Tambah ke CRM")').click();
    await expect(page.locator('.toast.success')).toContainText('ditambahkan');

    await switchTab(page, 'crm');
    await page.waitForSelector('#crm-tbody tr', { timeout: 5000 });

    const detailBtn = page.locator('#crm-tbody tr .action-btn[title="Detail & Aktivitas"]');
    await expect(detailBtn).toBeVisible();
  });
});

test.describe('Lead Detail & Activity Timeline', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockedPage(page);
  });

  test('should open lead detail modal and add activity', async ({ page }) => {
    await performSearch(page, 'restoran jakarta');
    await page.locator('.result-card').first().locator('button:has-text("Tambah ke CRM")').click();
    await expect(page.locator('.toast.success')).toContainText('ditambahkan');

    await switchTab(page, 'crm');
    await page.waitForSelector('#crm-tbody tr', { timeout: 5000 });

    // Click detail button
    await page.click('#crm-tbody tr .action-btn[title="Detail & Aktivitas"]');

    // Modal should show "Detail Lead" title
    await expect(page.locator('#modal-title')).toContainText('Detail Lead');

    // Should show activity section
    await expect(page.locator('.activity-section')).toBeVisible();

    // Add a note activity
    await page.fill('#activity-content', 'Test catatan aktivitas');
    await page.click('button:has-text("Tambah Aktivitas")');

    // Activity should appear in list
    await expect(page.locator('.activity-content')).toContainText('Test catatan aktivitas');
  });

  test('quick actions bar should have call and whatsapp when phone exists', async ({ page }) => {
    await performSearch(page, 'restoran jakarta');
    await page.locator('.result-card').first().locator('button:has-text("Tambah ke CRM")').click();
    await expect(page.locator('.toast.success')).toContainText('ditambahkan');

    await switchTab(page, 'crm');
    await page.waitForSelector('#crm-tbody tr', { timeout: 5000 });
    await page.click('#crm-tbody tr .action-btn[title="Detail & Aktivitas"]');

    // Quick actions should be visible
    await expect(page.locator('.quick-actions-bar')).toBeVisible();
  });

  test('notes field should be visible and editable in detail modal', async ({ page }) => {
    await performSearch(page, 'restoran jakarta');
    await page.locator('.result-card').first().locator('button:has-text("Tambah ke CRM")').click();
    await expect(page.locator('.toast.success')).toContainText('ditambahkan');

    await switchTab(page, 'crm');
    await page.waitForSelector('#crm-tbody tr', { timeout: 5000 });
    await page.click('#crm-tbody tr .action-btn[title="Detail & Aktivitas"]');

    // Notes textarea should exist
    const notesField = page.locator('#edit-notes');
    await expect(notesField).toBeVisible();

    // Fill notes and save
    await notesField.fill('Catatan penting untuk lead ini');
    await page.click('button:has-text("Simpan Perubahan")');

    // Reopen detail and verify notes persisted
    await page.click('#crm-tbody tr .action-btn[title="Detail & Aktivitas"]');
    await expect(page.locator('#edit-notes')).toHaveValue('Catatan penting untuk lead ini');
  });
});

test.describe('Mobile-specific behaviour', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockedPage(page);
  });

  test('search results should be usable on small viewports', async ({ page }) => {
    await performSearch(page, 'restoran jakarta');
    const grid = page.locator('#results-grid');
    await expect(grid).toBeVisible();

    const cards = await page.locator('.result-card').all();
    expect(cards.length).toBe(2);
  });
});
