# eBay sales closed 2026-09-20: what we know, what is missing

Compiled 2026-09-21 from Seller Hub orders, the two listings, and the message inbox.

## The two orders

| | Order 108 | Order 109 |
|---|---|---|
| Buyer | Marshall Olsen | Brennen Heberlein |
| eBay username | mpro_1306 | hebe-2984 |
| Item | 287584842370 | 287584926257 |
| Property | 0.12 ac, Montello, Elko County NV | 2.27 ac, Elko County NV |
| APN | 015-101-059 | 011108042 |
| Repo task | task-1783741999340-sfsooi (Sage Basin) | task-1789343722480-fd524b (Homestead Corner) |
| Closed | Sep 20, 5:40 pm PDT | Sep 20, 6:27 pm PDT |
| Winning bid | $20.50 | $0.01 |
| eBay status | Awaiting payment | Awaiting payment |
| 72-hour deadline | Sep 23, 5:40 pm PDT | Sep 23, 6:27 pm PDT |

## The bid is the down payment, not the price

Both listings ran as no-reserve auctions where the winning bid sets the DOWN PAYMENT against a
fixed sales price. The nominal closes are therefore working as designed, not a failed auction.

Order 108, quoting the listing: "The sales price of the lot stays fixed at $1,500 wherever the
auction lands, and whatever you win at comes straight off that $1,500. The one-time $249
document and filing fee is added to your down payment and due along with it."

Order 109, quoting the listing: "The sales price here is $5,500 ... The winning bid is your down
payment and comes off that $5,500. The one-time $299 document and filing fee is added to the
down payment rather than taken out of it."

### Resulting numbers

Marshall Olsen, 0.12 ac:
- Cash route: $1,500 + $249 = $1,749 total
- Terms route: $20.50 down + $249 fee = $269.50 now, then balance $1,479.50 at about $75/mo
  for up to 24 months

Brennen Heberlein, 2.27 ac:
- Cash route: $5,500 + $299 = $5,799 total
- Terms route: $0.01 down + $299 fee = $299.01 now, then balance $5,499.99 at $150/mo for
  45 months

## Contact history

- mpro_1306: NO messages, ever. Won on a late bid with no pre-screen, which is the known gap
  named in knowledge-base/ebay/seller-terms.md. The same lot had order 107 cancelled on Sep 13
  (Gary Robert Turcotte, gaturc-64) for the same reason.
- hebe-2984: one message, Sep 21 4:16 pm, and it is on the 0.12 AC MONTELLO listing, NOT the
  2.27 ac lot he actually won: "Would love to buy this land. I am new to eBay but have been
  searching for land for a long time. So, my one question. When are payments due?"
  Worth resolving which lot he believes he bought. The "when are payments due" question leans
  toward financing but commits to nothing.

## Neither buyer has stated cash or terms

No written agreement from either buyer on price, payment method, or cash versus financing.

## Missing before paperwork can be completed

1. Cash or terms, per buyer.
2. Exact vesting name (how the name should read on the deed) and mailing address, per buyer.
   eBay withholds the buyer address until payment, and these listings take no eBay payment,
   so the address has to be asked for.
3. Legal description for both parcels. Elko County GIS (gis.elkocountynv.net) returned
   "Service Unavailable" on 2026-09-21 so nothing was verified there.
   NOTE: 015-101-059 is very likely "Sportsman's Lodge Trailer Estates: L159" by the pattern in
   the two example packages (015-101-079 = L179, 015-101-071 = L171). That is an INFERENCE from
   two data points and must be confirmed against the deed or the assessor before it goes into a
   contract.

## Decisions needed

1. INTEREST RATE. The advertised terms are not 0%, but the example terms package is built on a
   0% promissory note. The advertised monthlies imply:
   - 0.12 ac: $1,479.50 financed, $75 x 24 = $1,800, cost of credit $320.50, about 19.6% APR
   - 2.27 ac: $5,499.99 financed, $150 x 45 = $6,750, cost of credit $1,250.01, about 11.1% APR
   Either the note states a real rate, or the term shortens to keep it 0% (19.7 months and
   36.7 months respectively). This cannot be left as the example's "0% per annum" with these
   payment schedules, because the numbers contradict each other.
2. GUARANTEE LENGTH. Both example packages say 90-day satisfaction guarantee. seller-terms.md
   says 30-day, minus the document fee.
3. DOC FEE. seller-terms.md says $249 across the board. The 2.27 ac listing says $299 and that
   is what the buyer was shown, so $299 is what he agreed to.
4. PAYMENT RAIL. The cash example says "debit card through GeekPay". seller-terms.md says that
   rail is closed and the methods are now Zelle, PayPal, Venmo, Cash App, wire, ACH. The new
   packages must name whatever the buyer actually uses.
5. ACH FORM. The terms example's recurring-payment form and the note both assume GeekPay bank
   draft autopay. If either buyer finances, that form needs rethinking rather than reusing.

## Minor

- eBay item specifics on the 2.27 ac list Zoning as "Mixed"; task metadata says
  Agricultural/Residential. The ad copy uses Agricultural/Residential.
- Repo gap now closable: task-1783741999340-sfsooi carries "APN: operator to fill". The APN is
  015-101-059 per the live listing. Not written to task metadata, that is an operator call.

## Messages sent 2026-09-21

Both sent from danielmccallum, approved by the operator.

- hebe-2984 (Brennen Heberlein), 8:16 pm, as a reply in his existing thread. Opens by sorting
  out which parcel he actually won, answers his payments question, lays out cash vs terms with
  the real numbers, asks for vesting name and mailing address, states the Sep 23 6:27 pm PDT
  deadline and offers flexibility.
- mpro_1306 (Marshall Olsen), 8:19 pm, via Seller Hub > order 108 > More actions > Message
  buyer, attached to item 287584842370. Same structure, Sep 23 5:40 pm PDT deadline.

Operational note: eBay caps a member message at 2000 characters and silently truncates at the
limit rather than warning. The first Heberlein draft was 2028 characters and was cut mid-word
at "Danie". Both sent versions were trimmed and verified before sending. Keep future templated
buyer messages under about 1900 characters.

Also note: "Message buyer" from the orders LIST row does not open its modal. The working path is
order number > order details > the "..." button beside Send invoice > Message buyer.

## Update 2026-09-24: Heberlein switches to a 0.12 ac lot, Olsen still silent

hebe-2984 replied to the 8:16 pm message: "Thank you for getting back to me! If you have more
0.12 acre lots, that's probably more my speed. I'm new to land investing and so I figure a small
plot might be best." He wants a 0.12 acre lot instead of the 2.27 acre parcel he won (order 109,
item 287584926257).

The 0.12 ac lot that was actually live on eBay (Sage Basin, item 287584842370) is the one mpro_1306
won, so it is not available to offer Heberlein. The lot to offer him is Desert Basecamp
(`montello-nv-89830-0.12ac-rv-basecamp` in knowledge-base/property-nicknames.md), a second 0.12 ac
Montello parcel with ad copy already generated (task-1780891259218-ppunbv,
workers/workspace/outputs/task-1780891259218-ppunbv/) but never listed on eBay. Same price point as
Sage Basin: $1,500 cash, or the ad's own financing terms of $1 down and $75/month for 24 months.
No APN on file for Desert Basecamp yet; still needs confirming before a contract goes out.

Decision: sell this one to Heberlein directly rather than run it through a new auction, since he
already knows what he wants. His original order 109 should be cancelled in Seller Hub (reason
"Buyer asked to cancel," per the late-bid-cancellation guidance in seller-terms.md; no metrics
hit) once he confirms cash or terms on the 0.12 ac lot.

Drafted, not yet sent: `draft-message-heberlein-2.txt`. Confirms the switch, states the 2.27 ac
order will be cancelled, gives cash ($1,749 total) vs terms ($250 now then $75/mo x 24) on Desert
Basecamp, and asks for deed name, mailing address, and a cash-or-terms answer.

Separately, mpro_1306 (Marshall Olsen) has still sent no messages and the Sep 23 5:40 pm PDT
payment deadline on order 108 has now passed with no payment and no reply. Drafted, not yet sent:
`draft-message-olsen-followup.txt`. Recaps the terms, asks him to confirm he still wants the lot,
and states the lot goes back up for sale if there is no reply within 48 hours.

Both drafts are operator review only; nothing has been sent to either buyer since the 2026-09-21
round.

## Still open

- Both 2026-09-24 drafts above need operator review and sending.
- Order 109 (Heberlein, 2.27 ac) needs cancelling in Seller Hub once he confirms cash/terms on
  the 0.12 ac lot, so the cancellation reason matches what actually happened.
- Desert Basecamp has no APN on file and has never been listed; needs both before a contract can
  go out, and a decision on whether it gets a proper eBay listing or is sold as a private-treaty
  deal referencing the existing ad copy.
- If Olsen does not respond within 48 hours of the follow-up, decide whether to cancel order 108
  and relist Sage Basin, per the same late-bid-cancellation pattern as order 107.
- The interest-rate decision in "Decisions needed" above is still unresolved and now also applies
  to Desert Basecamp's terms, not just the original two lots.
- Legal descriptions for all three lots (Sage Basin, Homestead Corner, Desert Basecamp) still need
  confirming against the deed or assessor once Elko County GIS is back up.
