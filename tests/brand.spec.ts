import { test, expect } from '@playwright/test';

test('production brand uses semantic colors, local fonts and the original wordmark', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).hostname !== '127.0.0.1') externalRequests.push(request.url());
  });
  await page.addInitScript(() => localStorage.setItem('ruang-renewal.tour.v1', 'seen'));
  await page.goto('/');
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      body: getComputedStyle(document.body).fontFamily,
      heading: getComputedStyle(document.querySelector('h1')!).fontFamily,
      loaded: [...document.fonts].filter(font => font.status === 'loaded').map(font => font.family),
      canvas: getComputedStyle(document.body).backgroundColor,
    };
  });
  expect(fonts.body).toContain('Inter');
  expect(fonts.heading).toContain('Plus Jakarta Sans');
  expect(fonts.loaded.join(' ')).toContain('Inter');
  expect(fonts.loaded.join(' ')).toContain('Plus Jakarta Sans');
  expect(fonts.canvas).toBe('rgb(246, 248, 252)');
  await expect(page.getByTestId('send-quote')).toHaveCSS('background-color', 'rgb(81, 75, 232)');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/assets/logos/logomark-flat.svg');
  const logo = page.locator('.sidebar').getByAltText('Rekonvia');
  await expect(logo).toHaveAttribute('src', '/assets/logos/logotype-light-mode.svg');
  const dimensions = await logo.evaluate(image => {
    const element = image as HTMLImageElement;
    const bounds = element.getBoundingClientRect();
    return { naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight, ratio: bounds.width / bounds.height };
  });
  expect(dimensions.naturalWidth).toBe(435);
  expect(dimensions.naturalHeight).toBe(85);
  expect(dimensions.ratio).toBeCloseTo(435 / 85, 2);
  const gradient = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'rk-brand-gradient';
    document.body.append(probe);
    const value = getComputedStyle(probe).backgroundImage;
    probe.remove();
    return value;
  });
  expect(gradient).toContain('135deg');
  expect(gradient).toContain('rgb(81, 75, 232)');
  expect(gradient).toContain('rgb(63, 54, 204)');
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(page.locator('.topbar').getByAltText('Rekonvia')).toBeVisible();
  await expect(page.getByLabel('Peran simulasi')).toHaveCSS('font-size', '16px');
  const countLines = await page.getByText('8 dokumen', { exact: true }).evaluate(element => {
    const tops = [...element.childNodes]
      .filter(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
      .flatMap(node => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return [...range.getClientRects()].map(rect => Math.round(rect.top));
      });
    return new Set(tops).size;
  });
  expect(countLines).toBe(1);
  const placeholder = await page.locator('#review-note-clause-1').evaluate(element => {
    element.setAttribute('placeholder', 'Contoh sumber');
    const style = getComputedStyle(element, '::placeholder');
    const result = { color: style.color, opacity: style.opacity };
    element.removeAttribute('placeholder');
    return result;
  });
  expect(placeholder).toEqual({ color: 'rgb(86, 100, 121)', opacity: '1' });
  expect(externalRequests).toEqual([]);
});

test('Preflight preserves centered dialogs, clause numbering, focus and reduced motion', async ({ page }) => {
  await page.goto('/');
  const tour = page.locator('.tour-dialog');
  await expect(tour).toBeVisible();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = (await tour.boundingBox())!;
    expect(Math.abs(bounds.x + bounds.width / 2 - width / 2)).toBeLessThan(2);
    expect(Math.abs(bounds.y + bounds.height / 2 - 450)).toBeLessThan(2);
  }
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Lihat dokumen', exact: true }).first().click();
  const source = page.getByRole('dialog', { name: 'Final slip 2026' });
  await expect(source).toBeVisible();
  const bounds = (await source.boundingBox())!;
  expect(Math.abs(bounds.x + bounds.width / 2 - 720)).toBeLessThan(2);
  await expect(source.locator('.clause-list')).toHaveCSS('list-style-type', 'decimal');
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const button = page.locator('#review-clause-1').getByRole('button', { name: 'Simpan review wording', exact: true });
  await button.focus();
  await expect(button).toHaveCSS('outline-color', 'rgb(63, 54, 204)');
  await expect(button).toHaveCSS('outline-width', '3px');
  await expect(button).toHaveCSS('transition-duration', '0s');
});
