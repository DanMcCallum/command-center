# Operator input drop-offs

This directory receives the two human-prerequisite artifacts for the land.com
access spike (`specs/land-com-connect.md`). Everything in here except this README
is **gitignored** — raw cookie exports are session secrets and must never reach
git, the report, logs, or chat.

## OT-A — home network probes

From a home/residential connection, run the probe script at `../home-probe.sh`
and save its output here as:

```
home-probes.txt
```

The report's Block Scope table incorporates it as the "home" column.

## OT-B — land.com cookie export

Export your logged-in land.com session using a cookie-export extension. The
extension route is the one that works: land.com's session cookies are `HttpOnly`,
which page JavaScript (and any bookmarklet) cannot read, but the extension
`chrome.cookies` API can — see the report's
[Capture From the User's Browser](../report.md#capture-from-the-users-browser)
section for why.

**Browser:** Google Chrome (or any Chromium-based browser — Edge/Brave work the
same; Firefox also works, the extension exists for both). Use your normal
day-to-day browser profile — the point is to capture the session from your real
residential IP and browser.

### Steps

1. Install the **Cookie-Editor** extension from the
   [Chrome Web Store](https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm)
   (or [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/cookie-editor/)
   if you use Firefox). It's free; when Chrome asks, the only permission it needs
   is to read cookies on sites you visit.
2. Go to `https://www.land.com` and **log in** with your land.com account. If
   you're already logged in, just confirm it — load your account/dashboard page
   and check you're not bounced to the login screen.
3. Stay on a `www.land.com` tab (any page, as long as you're logged in). Click
   the Cookie-Editor icon in the toolbar — it opens showing the cookies for the
   current site. Do **not** filter or delete anything: the export must include
   every cookie for the site, both `www.land.com` host cookies and the
   domain-wide `.land.com` ones (the `HttpOnly` session cookies among them are
   the whole point).
4. Click **Export → Export as JSON** (bottom bar of the extension popup). This
   copies a JSON array of cookie objects to your clipboard.
5. Paste the clipboard into a new file in **this directory** — and only this
   directory — saved exactly as:

   ```
   land_com-cookies.json
   ```

6. Sanity-check the file (don't read values, just shape): it should be a JSON
   array of a handful of objects with `name`, `value`, `domain`, `path`,
   `expirationDate`, `httpOnly`, `secure`, `sameSite` fields, and at least one
   entry with `"httpOnly": true`. If **no** entry has `httpOnly: true`, the
   export came from something running with page-script privileges — redo it
   with the extension.
7. Tell Ralph/the next spike iteration that the export is in place. US-007
   converts it to `workers/posting/auth/land_com.json` (chmod 600) and validates
   it, then **deletes** `land_com-cookies.json`.

Don't worry about `sameSite` values like `no_restriction` or `unspecified` in
the export — the converter normalizes them. If validation later shows cookies
alone don't authenticate (land.com keeping auth state in `localStorage`),
US-007 will come back with one extra DevTools step; skip it for now.

### Safety rules (always apply)

- The export is saved **only** in this directory, which is gitignored — never
  anywhere else on disk, never in a gist/paste/chat.
- It is **deleted immediately after conversion** to
  `workers/posting/auth/land_com.json`.
- Cookie **values** are never pasted into the report, logs, chat, or commit
  messages. Expiry timestamps are the only cookie metadata the report may
  record.
- If you suspect the export leaked anywhere, log out of land.com (which
  invalidates the session server-side) and re-export after logging back in.
