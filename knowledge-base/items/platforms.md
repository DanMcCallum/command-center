---
type: platform-notes
scope: items (consumer goods)
researched: 2026-11-09
---

# Platform notes for item listings

Caps are enforced from `config/item-ad-platforms.json`; this file explains where they came from and how each site is used. Anything marked "unconfirmed" was not found in an official source on 2026-11-09 and should be checked on the live posting form.

## eBay (`ebay_item`)

- Title: 80 characters, eBay's hard limit. Keywords are what the search engine indexes, so the title is Brand + Model + searched specs + condition word and nothing else. eBay's search-manipulation policy forbids unrelated brand names and keyword stuffing.
- Description: no practical limit; our cap is 5000 as a sanity ceiling. We write it as plain ALL-CAPS header blocks (see `listing-template.md`), no HTML, no markdown `#` headings (the file renderer stops at the first one).
- Contact and payment: eBay's contact-information policy bars phone numbers, email addresses and web links in listings; the off-eBay-sales policy bars naming other payment methods. Contact line is "message us through eBay", payment is eBay checkout.
- Condition: a listing has a structured condition (New, New: Open box or New other, Used, Acceptable, For parts or not working) plus a free-text condition description. Map from the task's `condition` field per the config's `condition_values`. The condition description is where `defects` and `condition_notes` go, and the CONDITION block repeats them.
- Item specifics: Brand, Model, Type, Color, Material, and the category's own required specifics. MPN and UPC are "Does not apply" when unknown; never guess them.
- Best Offer: a toggle on fixed-price listings. When the task's `accept_offers` is true the copy says "Best Offer welcome" and the operator turns the toggle on (auto-decline floors are set on the form, not in copy).
- Photos: 24 free per listing. Primary photo first (`00_` in the task's photos folder).
- Shipping: calculated shipping uses the package dimensions and weight from the task's `dimensions`; free shipping bakes the estimate into the price; local pickup only is a listing option and the copy must say where in plain words.
- Returns: set on the listing; the copy's line must match `seller-terms.md`.
- Fees (confirmed 2026-11-09 on eBay's selling fees page): final value fee 13.6% of the total sale (item plus shipping) up to $7,500 per item, then 2.35% above that; per-order fee $0.30 at or under $10, $0.40 over $10; first 250 listings a month free, then $0.35 each. Below Standard accounts pay more. The BuyWander bid rule in `dashboard/lib/buywander-types.ts` assumes 13.6%.
- Sources: eBay Help, contact-information policy (https://www.ebay.com/help/policies/listing-policies/contact-information-policy?id=4249); selling fees (https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822).

## Facebook Marketplace (`fb_item`)

- Posted by hand, same as the land side: Meta's terms forbid automated posting and no seller API exists for individuals. The dashboard's Post by hand card supplies the copy and photos; the operator pastes.
- Title: 99 characters. Our evidence: a 90-character title went in on 2026-10-13 and a 100-character one was refused with "Please enter a shorter title" on 2026-11-02 (both land listings). Meta publishes no figure; third-party guides claim 100, 150 or 200. Visible in the grid: about the first 60 to 65 characters, so the plain-words description of the item leads.
- Description: 2000 characters, our conservative cap (a 1998-character description went in unchanged on 2026-10-13; one third-party guide claims 5000, unconfirmed). Phones show about 200 characters before "See more", so the first two lines carry what it is, the price and the pickup area.
- Photos: 10 per listing on the create form seen 2026-10-12, plus one video.
- Form fields seen 2026-10-12: photos, title, price, category, condition (New, Used - Like New, Used - Good, Used - Fair), description, location (defaults to the account's home town; set to the pickup area), availability, optional tags, hide-from-friends toggle, shipping toggle.
- Condition mapping: no open-box option, so "Appears new / open box" posts as Used - Like New and the first description line says open box.
- Category and condition are form dropdowns, not copy: `fb_item.md` carries a `## CATEGORY` section (one entry from the `categories` list in the config, "Group > Category") and a `## CONDITION` section (the mapped option), and the Post by hand card shows both. The category list was written from memory of the form on 2026-11-10 and not re-read live; correct the config if the form differs.
- Payment and fees: local pickup with cash, Venmo or Zelle at pickup costs nothing. Marketplace shipping (checkout through Meta) carries a selling fee and a label flow; we do not use it unless the task's `shipping` says otherwise.
- Never any financing words (down payment, monthly, payments, no credit check): Meta's review treats them as financial products. Items are rarely affected, but the rule from the land side stands.
- Sources: this repo's `config/ad-platforms.json` (facebook_marketplace entry) and AGENTS.md; The Drum's guide (https://www.thedrum.com/news/how-use-facebook-marketplace-step-step-guide) for the 100 figure.

## KSL Classifieds (`ksl`)

- Utah's local classifieds (Deseret Digital Media). Audience is the Wasatch Front; buyers expect to drive to the item and pay in person. Free for individuals in General merchandise categories per KSL's getting-started page (2026); some categories (vehicles, real estate, services, business accounts) carry fees, and posting in the wrong category to avoid one gets the listing removed.
- Title: 95 characters per KSL's own 2022 blog post "Pro tips for creating listings that sell on KSL Classifieds" (https://classifieds.ksl.com/resources/helpful-tips/pro-tips-for-creating-listings-that-sell-on-ksl-classifieds). The page returns 403 to this server, so the figure came through the search snippet; confirm on the form.
- Description: no published limit found. Our cap is 2000, conservative, unconfirmed.
- Photos: an older KSL help article says you can add about as many as you want, preferred size 640 x 480. Our cap is 10, conservative, unconfirmed.
- Posting flow (from KSL's how-to-sell page and the form as remembered; unconfirmed detail): sign in with a KSL account, Post a listing, pick category then subcategory, title, description, price (with a "price negotiable" style toggle), condition (read on the live form 2026-11-10: New; Used - Excellent, like new; Used - Good, minimal wear; Used - Fair, normal wear; Used - Poor; Used - Damaged, parts only; Not Applicable; `ksl.md` carries the mapped one in a `## CONDITION` section), photos, location by city and ZIP, contact preferences (KSL messaging, phone, text). Listings run for a set period and can be renewed from My Listings.
- Rules from KSL's Terms of Use (https://www.ksl.com/article/50077580/ksl-classifieds-terms-of-use): listing content must be concise and limited to the goods offered; individuals may post unlimited General listings, business accounts are capped at five at a time unless approved; posting multiple listings to take over a search page is prohibited.
- Payment: cash or Venmo at pickup; KSL offers no checkout. Phone number is normal here and the buyers use it.
- Shipping: a local site; mention shipping only when the task's `shipping` field is not local pickup only.
- Fraud guidance from KSL's own articles: meet in a public place, do not accept overpayment or checks, keep the conversation on KSL messaging until a meet is set. Our ads say "cash or Venmo at pickup" and never ask for a deposit.

## What was not confirmed on 2026-11-09

- KSL description character limit and photo cap (we chose 2000 and 10).
- Facebook Marketplace's true title and description caps (we use 99 and 2000 from our own evidence).
- Whether the KSL 95-character title figure from 2022 still matches the live form.
