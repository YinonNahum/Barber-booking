// Offline UI walkthrough of the customer site with screenshots.
const { chromium, devices } = require('playwright');
const path = require('path');
const { handle } = require('./mock');
const root = 'file://' + path.resolve(__dirname, '..');
const out = process.argv[2] || '/tmp';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts|net::ERR/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.route('**/*', (r) => r.request().url().startsWith('file:') ? r.continue() : handle(r));

  await page.goto(root + '/index.html');
  await page.waitForSelector('.svc');
  await page.screenshot({ path: out + '/m1-home.png', fullPage: false });
  await page.screenshot({ path: out + '/m2-full.png', fullPage: true });

  await page.$eval('.svc[data-id="s1"]', (e) => e.click());
  await page.waitForSelector('.slot');
  await page.waitForTimeout(400);
  await page.screenshot({ path: out + '/m3-when.png' });

  await page.$eval('[data-view="month"]', (e) => e.click()); await page.waitForTimeout(200);
  await page.$eval('#when', (e) => e.scrollIntoView()); await page.screenshot({ path: out + '/m3b-month.png' });
  await page.$eval('[data-view="day"]', (e) => e.click()); await page.waitForTimeout(200);
  await page.$eval('#when', (e) => e.scrollIntoView()); await page.screenshot({ path: out + '/m3c-day.png' });
  await page.$eval('#cal-next', (e) => e.click()); await page.waitForTimeout(600); await page.waitForTimeout(200);
  await page.$eval('#when', (e) => e.scrollIntoView()); await page.screenshot({ path: out + '/m3d-day-next.png' });
  await page.$eval('[data-view="week"]', (e) => e.click()); await page.waitForTimeout(200);
  await page.$eval('#contact', (e) => e.scrollIntoView()); await page.screenshot({ path: out + '/m9-footer.png' });
  // full day -> waitlist
  const fullDay = await page.$('.cell.full');
  if (fullDay) { await page.$eval('.cell.full', (e) => { e.scrollIntoView({block:'center'}); e.click(); }); await page.waitForSelector('#wl-form'); await page.waitForTimeout(300); await page.screenshot({ path: out + '/m4-waitlist.png' }); }
  // back to a day with slots
  await page.$eval('.cell.free', (e) => e.click());
  await page.waitForSelector('.slot');
  await page.$$eval('.slot', (els) => els[4].click());
  await page.waitForTimeout(500);
  await page.fill('#f-name', 'ישראל ישראלי');
  await page.fill('#f-phone', '050-1234567');
  await page.$eval('#f-agree', (e) => e.click()); await page.waitForTimeout(600);
  await page.screenshot({ path: out + '/m5-details.png' });
  await page.$eval('#confirm-arrow', (e) => e.click());
  await page.waitForSelector('#done:not([hidden]) .summary');
  await page.waitForTimeout(500);
  await page.screenshot({ path: out + '/m6-done.png' });

  // manage page, normal + late
  await page.goto(root + '/manage.html?t=590e043c-4698-4e41-bd38-fcdb474cc46d');
  await page.waitForSelector('.summary');
  await page.screenshot({ path: out + '/m7-manage.png' });
  await page.unroute('**/*');
  await page.route('**/*', (r) => r.request().url().startsWith('file:') ? r.continue() : handle(r, { late: true }));
  await page.reload();
  await page.waitForSelector('.summary');
  await page.screenshot({ path: out + '/m8-manage-late.png' });

  // desktop
  const d = await browser.newPage({ viewport: { width: 1366, height: 860 } });
  await d.route('**/*', (r) => r.request().url().startsWith('file:') ? r.continue() : handle(r));
  await d.goto(root + '/index.html');
  await d.waitForSelector('.svc');
  await d.screenshot({ path: out + '/d1-home.png' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  console.log(JSON.stringify({ errors, mobileHorizontalOverflow: overflow }, null, 1));
  await browser.close();
})();
