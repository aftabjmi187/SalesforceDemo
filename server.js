const express = require('express');
const path = require('path');
const { chromium } = require('playwright');
const app = express();
const PORT = process.env.PORT || 3000;

let currentBrowser = null;
let clients = [];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/delete', async (req, res) => {
  const { username, password } = req.body;
  broadcast('⏳ Logging into Salesforce...');

  try {
    // If browser is already running, close it
    if (currentBrowser) await currentBrowser.close();

    currentBrowser = await chromium.launch({ headless: false });
    const context = await currentBrowser.newContext();
    const page = await context.newPage();

    await page.goto('https://login.salesforce.com/');
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Log In' }).click();

    // Wait for login to complete
    await page.waitForSelector('text=Leads', { timeout: 30000 });
    broadcast('✅ Logged in. Navigating to Leads...');

    const deleteLeads = async () => {
      try {
        await page.click('text=Leads');
        await page.waitForTimeout(2000);

        await page.click('text=Mass Delete Leads');
        await page.waitForTimeout(2000);

        await page.getByLabel('Permanently delete the').check();
        await page.getByTitle('Search', { exact: true }).click();
        await page.waitForTimeout(2000);

        const noRecords = await page.locator('text=No records to display.').isVisible();
        if (noRecords) {
          broadcast('🎉 Finished: No more deletable leads.');
          return false;
        }

        await page.getByRole('checkbox', { name: 'Toggle All Rows' }).check();
        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: 'Delete' }).nth(2).click();

        broadcast('🗑️ Deleted a batch of leads...');
        await page.waitForTimeout(4000);
        await page.reload();
        return true;
      } catch (err) {
        broadcast(`⚠️ Error during deletion: ${err.message}`);
        return false;
      }
    };

    let round = 1;
    while (await deleteLeads()) {
      broadcast(`🔁 Completed round ${round}`);
      round++;
    }

    await context.close();
    await currentBrowser.close();
    currentBrowser = null;

    broadcast('🚀 Deletion complete.');
  } catch (err) {
    broadcast(`❌ Script failed: ${err.message}`);
    if (currentBrowser) {
      await currentBrowser.close();
      currentBrowser = null;
    }
  }

  res.sendStatus(200);
});

app.post('/cancel', async (req, res) => {
  if (currentBrowser) {
    await currentBrowser.close();
    currentBrowser = null;
    broadcast('❌ Operation cancelled by user.');
  }
  res.sendStatus(200);
});

app.get('/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  clients.push(res);
  req.on('close', () => {
    clients = clients.filter(c => c !== res);
  });
});

function broadcast(message) {
  console.log(message);
  clients.forEach(client => client.write(`data: ${message}\n\n`));
}

app.listen(PORT, () => {
  console.log(`🟢 Server running at http://localhost:${PORT}`);
});
