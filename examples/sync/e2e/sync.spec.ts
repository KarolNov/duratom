import { expect, test, type Browser, type Page } from '@playwright/test'

// Every test is in a room of its own, so tests don't see each other's todos. Each browser context
// is a separate device: its own IndexedDB, and no BroadcastChannel to the others.

const newRoom = () => `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function device(browser: Browser, room: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`/?room=${room}`)
  await expect(page.getByTestId('room')).toHaveText(room)
  return page
}

const status = (page: Page) => page.getByTestId('status')
const todoTitles = (page: Page) => page.getByTestId('todo').getByLabel('Title')

async function add(page: Page, title: string) {
  await page.getByLabel('New todo').fill(title)
  await page.getByRole('button', { name: 'Add' }).click()
}

/** Waits until the device's IndexedDB holds `title`, so a reload is sure to find it. */
async function savedLocally(page: Page, room: string, title: string) {
  await expect
    .poll(() =>
      page.evaluate(
        ([name, text]) =>
          new Promise<boolean>((resolve) => {
            const open = indexedDB.open(name!)
            open.onsuccess = () => {
              const db = open.result
              const all = db.transaction('updates').objectStore('updates').getAll()
              all.onsuccess = () => {
                // Yjs stores text as UTF-8 inside the binary update, so search its bytes.
                const bytes = all.result.map((u: Uint8Array) => new TextDecoder().decode(u))
                db.close()
                resolve(bytes.some((u) => u.includes(text!)))
              }
            }
          }),
        [`duratom-sync:${room}`, title],
      ),
    )
    .toBe(true)
}

test('edits sync between two devices through the server', async ({ browser }) => {
  const room = newRoom()
  const alice = await device(browser, room)
  const bob = await device(browser, room)
  await expect(status(alice)).toHaveText('Synced')
  await expect(status(bob)).toHaveText('Synced')

  await add(alice, 'Buy milk')
  await expectTitles(bob, ['Buy milk'])

  await bob.getByTestId('todo').getByLabel('Done').check()
  await expect(alice.getByTestId('todo').getByLabel('Done')).toBeChecked()
  await expect(alice.getByTestId('progress')).toHaveText('1 of 1 done')

  await alice.getByTestId('todo').getByLabel('Title').fill('Buy oat milk')
  await expectTitles(bob, ['Buy oat milk'])

  await bob.getByRole('button', { name: 'Delete' }).click()
  await expect(alice.getByText('Nothing to do.')).toBeVisible()
})

test('offline edits survive a reload and are sent on reconnect', async ({ browser }) => {
  const room = newRoom()
  const alice = await device(browser, room)
  const bob = await device(browser, room)
  await expect(status(alice)).toHaveText('Synced')

  await alice.getByRole('button', { name: 'Go offline' }).click()
  await expect(status(alice)).toHaveText('Offline')

  await add(alice, 'Written offline')
  await add(bob, 'Written online')
  // Neither side sees the other's edit while Alice is offline.
  await expectTitles(alice, ['Written offline'])
  await expectTitles(bob, ['Written online'])

  // The offline edit is in IndexedDB, so a reload brings it back, still offline.
  await savedLocally(alice, room, 'Written offline')
  await alice.reload()
  await expect(status(alice)).toHaveText('Offline')
  await expectTitles(alice, ['Written offline'])

  await alice.getByRole('button', { name: 'Go online' }).click()
  await expect(status(alice)).toHaveText('Synced')
  // Ids sort by creation time, so both devices list the todos in the same order.
  const both = ['Written offline', 'Written online']
  await expectTitles(alice, expect.arrayContaining(both))
  await expectTitles(bob, expect.arrayContaining(both))
})

test('concurrent offline edits to one title both survive', async ({ browser }) => {
  const room = newRoom()
  const alice = await device(browser, room)
  const bob = await device(browser, room)
  await add(alice, 'Plan trip')
  await expectTitles(bob, ['Plan trip'])

  await alice.getByRole('button', { name: 'Go offline' }).click()
  await bob.getByRole('button', { name: 'Go offline' }).click()

  // Alice types at the start of the title and Bob at the end, each without seeing the other.
  const aliceTitle = todoTitles(alice)
  await aliceTitle.click()
  await aliceTitle.press('Home')
  await aliceTitle.pressSequentially('Alice: ')
  const bobTitle = todoTitles(bob)
  await bobTitle.click()
  await bobTitle.press('End')
  await bobTitle.pressSequentially(' to Rome')
  // Bob ticks it too; Alice's title edit doesn't undo that, nor his title edit hers.
  await bob.getByTestId('todo').getByLabel('Done').check()

  await alice.getByRole('button', { name: 'Go online' }).click()
  await bob.getByRole('button', { name: 'Go online' }).click()

  for (const page of [alice, bob]) {
    await expectTitles(page, ['Alice: Plan trip to Rome'])
    await expect(page.getByTestId('todo').getByLabel('Done')).toBeChecked()
  }
})

test('a new device gets the room from the server', async ({ browser }) => {
  const room = newRoom()
  const alice = await device(browser, room)
  await expect(status(alice)).toHaveText('Synced')
  await add(alice, 'First')
  await add(alice, 'Second')
  await alice.context().close()

  // A fresh context has an empty IndexedDB: everything it shows came from the Durable Object.
  const carol = await device(browser, room)
  await expect(status(carol)).toHaveText('Synced')
  await expectTitles(carol, ['First', 'Second'])
})

test('forgetting the device reloads the room from the server', async ({ browser }) => {
  const room = newRoom()
  const alice = await device(browser, room)
  await expect(status(alice)).toHaveText('Synced')
  await add(alice, 'Kept on the server')
  const bob = await device(browser, room)
  await expectTitles(bob, ['Kept on the server'])

  await alice.getByRole('button', { name: 'Forget this device' }).click()
  await expect(status(alice)).toHaveText('Synced')
  await expectTitles(alice, ['Kept on the server'])
})

/** Waits until the page lists exactly these titles, in order. */
async function expectTitles(page: Page, titles: unknown) {
  await expect
    .poll(() =>
      todoTitles(page).evaluateAll((inputs) =>
        inputs.map((input) => (input as HTMLInputElement).value),
      ),
    )
    .toEqual(titles)
}
