# RISE Fibre Door-to-Door Tracker

A deliberately simple, large-print web app for one door-to-door agent. It does
three things and nothing else:

1. Shows which RISE Fibre packages are available at an address.
2. Logs what happened at each door.
3. Tracks progress through the assigned streets.

It does **not** sign anyone up — the on-screen reminder after a sale points the
agent back to the company sign-up app.

## Live site

**https://callum-dev-x.github.io/rise-fibre-tracker/**

Deployed from the `main` branch of `Callum-Dev-x/rise-fibre-tracker` via GitHub
Pages. To ship a change: edit, **bump `CACHE` in `sw.js`**, commit, push. Phones
that have it installed pick the new version up the next time they open the app.

## Running it locally

No build step, no server code, no accounts. Either:

* Open `index.html` directly in a browser, **or**
* Serve the folder from any static host (GitHub Pages, Netlify, S3, a plain
  `python3 -m http.server`).

Use a real host (`https://…`) if you want the offline/installable behaviour —
service workers do not run from `file://`.

```bash
python3 -m http.server 8765 -d .
```

## Putting it on the phone

* **iPhone (Safari):** open the site → Share → *Add to Home Screen*.
* **Android (Chrome):** open the site → menu → *Install app* / *Add to Home screen*.

It then opens full screen with no browser bar, and works with no signal.

## What is in here

```
index.html              app shell
css/styles.css          all styling; every size derives from --scale
js/data-lists.js        which address lists are available
js/data-packages.js     the five RISE Fibre packages and their prices
js/app.js               all app logic: screens, saving, routing
tools/build-data.py     turns a spreadsheet into one of the data files above
manifest.json           PWA manifest (standalone, portrait)
sw.js                   service worker — caches the app shell for offline use
icons/                  app icons (192, 512, maskable, apple-touch, favicon)
```


## The data

## The address list

The tracker contains **PE – NTN CF**: 20,525 addresses across 517 streets.
The flow is Areas → Streets → Doors, with the largest towns first.

Ian's and Russell's lists have been removed. On update, their saved door
records, events and last-street pointers are removed from each device.
PE – NTN CF progress and text-size preferences are preserved.

### Adding or replacing a list

```bash
python3 tools/build-data.py <key> "<Display Name>" <spreadsheet.xlsx>
```

Headerless NTN exports with a network column after UPRN are also supported.

Then add the new file to `RISE_LIST_INDEX` in `js/data-lists.js` and to `SHELL`
in `sw.js`, and bump `CACHE`. The generator expects the columns these
spreadsheets use: UPRN, FullAddress, AddressLine1-5, Postcode, Sector, Outcode,
Region. It derives street names from the address lines, groups doors by town,
sorts each street by house number, and writes a compact format (streets stored
once, postcodes in a table, UPRNs delta-encoded) — Russell's 99,220 doors come to
3.7MB, about 600KB over the wire once the host gzips it.

**Packages** in `js/data-packages.js` are transcribed from the pricing screens:

| Speed | First 4 months | Discount | Badge | Feb 2027 | Mar 2027 | Mar 2028 |
|-------|----------------|----------|-------|----------|----------|----------|
| 1 Gbps | £5.00 p/m | £18.00 | Most Popular | £23.00 | £27.00 | £31.00 |
| 2.3 Gbps | £5.00 p/m | £25.00 | Fastest | £30.00 | £34.00 | £38.00 |
| 500 Mbps | £5.00 p/m | £20.00 | — | £25.00 | £29.00 | £33.00 |
| 250 Mbps | £5.00 p/m | £19.50 | — | £24.50 | £28.50 | £32.50 |
| 150 Mbps | £5.00 p/m | £18.50 | — | £23.50 | £27.50 | £31.50 |

Prices transcribed from the five screenshots supplied on 12 October 2026.
Every tier has a 4 month intro price, followed by the dated increases above.
Each card's "More information" holds the printed feature list (free activation,
unlimited data, symmetric download/upload, 24 months minimum term).

Notes on the source material:

* All prices are the **24 month contract** prices. The 12 Months and 30 Days
  tabs were not supplied, so those terms are not in the app.
* Every price and increase schedule above is transcribed from a supplied
  pricing screen — none of them are derived any more.
* The one gap: the **2.3 Gbps feature list** was never shown. Its "free
  activation / unlimited data / 24 months minimum term" lines are identical on
  every other tier, and its 2300Mbps symmetric speeds follow the pattern of all
  four tiers that were shown, but check that card before quoting the features.

**Availability.** The spreadsheet has no per-address package column, so
availability falls back to postcode, as specified. Every postcode in the list is
RH13, where all five packages are offered. To restrict one later, add an entry to
`RISE_AVAILABILITY.byPostcode` in `js/data-packages.js`:

```js
byPostcode: { 'RH13 5AW': ['g1', 'm500', 'm150'] }
```

## What is saved, and where

Everything lives in this phone's `localStorage` under `riseFibreTracker.v1`.
Nothing is sent anywhere; there is no account and no server.

```js
{
  records: {
    "100061809491": {
      status: "sold",              // new | noans | notint | call | sold | dnk
      updated: "2026-08-27T14:44:13.331Z",
      notes: "...",
      name: "Mrs Patel",           // if given
      phone: "07700 900123",       // if given
      callbackDate: "2026-09-03",  // callbacks only
      pkg: "g1"                    // sales only
    }
  },
  events:   [ { id, status, at } ],  // one per logged outcome — drives "Today so far"
  settings: { textSize: "normal" },  // normal | large | xl
  lastStreet: "Elm Grove"            // for the "Carry on" button on the home screen
}
```

It survives closing the app, closing the browser and restarting the phone. It is
cleared only by *Settings → Clear all data* (which asks twice) or by the user
clearing site data in their browser settings.

## Accessibility choices

* Body text 20px minimum, headings 28px+, prices 46px. *Large* multiplies every
  size by 1.22 and *Extra Large* by 1.45 — buttons, inputs and spacing included,
  because everything is derived from the single `--scale` variable.
* Every tap target is at least 62px tall with 16px between targets.
* Dark text on light backgrounds throughout; status is shown by colour **and**
  words, never colour alone.
* Tap-only: no swipes, no long presses, no drag. Every screen has a Back button.
* Every button has an icon and a text label.
* Notes are a plain `<textarea>`, so the phone's own keyboard microphone works.
* Destructive actions confirm first; clearing all data confirms twice.

## Updating the data later

* **Prices:** edit `js/data-packages.js`.
* **Addresses:** regenerate the list with `tools/build-data.py` (see above).
* After changing any file, bump `CACHE` in `sw.js` (e.g. `v1` → `v2`) so
  installed phones pick up the new version.
