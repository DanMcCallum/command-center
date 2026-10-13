import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  LANDLISTINGS_LIMITS,
  describeMembership,
  descriptionForLandListings,
  directionsFor,
  findListing,
  generalLocationFor,
  labelXpath,
  listingIdFromUrl,
  membershipFromText,
  parseListingCard,
  photoCapFor,
  pickCounty,
  publicListingUrl,
  roundAcres,
  statusOf,
  titleForLandListings,
} from './post-land_listings'

const task = (metadata: Record<string, unknown>) => ({ id: 'task-x', title: 't', metadata })

test('parseListingCard reads id, title, price, acres and status from a listing card', () => {
  const c = parseListingCard(
    'https://www.land-listings.com/listing/24839',
    'Listing id : #24839\nListed on : 29 Jul 2024\n2071 Al Gulch Rd\nJefferson, Colorado\n$80,000\n3.00 Acres +\\-\nMLS # : 4978299\nStatus : Active\nLooking for the heart of Park County...\nView Details',
    'https://www.land-listings.com/listing/24839/edit'
  )
  assert.ok(c)
  assert.equal(c.id, '24839')
  assert.equal(c.title, '2071 Al Gulch Rd')
  assert.equal(c.price, 80000)
  assert.equal(c.acres, 3)
  assert.equal(c.status, 'active')
  assert.equal(c.editUrl, 'https://www.land-listings.com/listing/24839/edit')
  assert.equal(parseListingCard('https://www.land-listings.com/listings/state/CO', 'x'), null)
})

test('statusOf maps the site words; no status word is unknown', () => {
  assert.equal(statusOf('Active'), 'active')
  assert.equal(statusOf('Unlisted'), 'unlisted')
  assert.equal(statusOf('Sold'), 'sold')
  assert.equal(statusOf('Under Contract'), 'pending')
  assert.equal(statusOf(''), 'unknown')
})

test('findListing matches by title first, then price + acres, preferring the Active card', () => {
  const unlisted = parseListingCard('/listing/1', '1 Acre in Park County, CO. Wooded\n$35,000\n1.00 Acres +/-\nStatus : Unlisted')!
  const active = parseListingCard('/listing/2', '1 Acre in Park County, CO. Wooded\n$35,000\n1.00 Acres +/-\nStatus : Active')!
  const other = parseListingCard('/listing/3', 'Something else\n$35,000\n1.00 Acres +/-\nStatus : Active')!
  assert.equal(findListing([unlisted, active], '1 acre in park county co wooded', 1, 1)?.id, '2')
  assert.equal(findListing([unlisted], '1 Acre in Park County, CO. Wooded', 1, 1)?.matchedOn, 'title')
  assert.equal(findListing([other], 'nope', 35000, 1)?.matchedOn, 'price + acres')
  assert.equal(findListing([other], 'nope', 36000, 1), null)
})

test('membershipFromText reads the dashboard wording and ignores upsell links', () => {
  assert.equal(membershipFromText('Welcome back. Premium Standard Seller. Upgrade to Premium Deluxe for Tier 1 placement.'), 'standard')
  assert.equal(membershipFromText('Premium Deluxe Seller. Your automatic seller website is live.'), 'deluxe')
  assert.equal(membershipFromText('Free Account. A seller membership is required to publish listings. Start Premium Standard'), 'free')
  assert.equal(membershipFromText('My Listings (0)'), 'unknown')
  assert.equal(describeMembership('free'), 'Free Account (cannot publish)')
})

test('photoCapFor follows the membership and an explicit metadata cap never exceeds it', () => {
  assert.equal(photoCapFor('free'), 1)
  assert.equal(photoCapFor('standard'), 20)
  assert.equal(photoCapFor('deluxe'), 100)
  assert.equal(photoCapFor('unknown'), LANDLISTINGS_LIMITS.photosByMembership.unknown)
  assert.equal(photoCapFor('standard', task({ land_listings_max_photos: 5 })), 5)
  assert.equal(photoCapFor('free', task({ land_listings_max_photos: 5 })), 1)
})

test('pickCounty returns the canonical spelling or null', () => {
  const co = ['Adams', 'Clear Creek', 'Park', 'Saint Johns']
  assert.equal(pickCounty(co, 'Park'), 'Park')
  assert.equal(pickCounty(co, 'park county'), 'Park')
  assert.equal(pickCounty(co, 'clear  creek'), 'Clear Creek')
  assert.equal(pickCounty(co, 'St. Johns County'), 'Saint Johns')
  assert.equal(pickCounty(co, 'Elko'), null)
  assert.equal(pickCounty([], 'Elko'), null)
})

test('titleForLandListings uses the override and trims to the column width', () => {
  assert.equal(titleForLandListings(task({}), '  1 Acre in   Park County '), '1 Acre in Park County')
  assert.equal(titleForLandListings(task({ land_listings_headline: 'Custom' }), 'x'), 'Custom')
  assert.equal(titleForLandListings(task({}), 'a'.repeat(300)).length, 255)
})

test('descriptionForLandListings keeps the text and caps it at the column width', () => {
  const text = 'Lead line.\n\n- one\n- two\n\nClose. (Property: Timber Park)'
  assert.equal(descriptionForLandListings(text), text)
  const long = 'x'.repeat(60_000)
  const notes: string[] = []
  assert.equal(descriptionForLandListings(long, (m) => notes.push(m)).length, 50_000)
  assert.equal(notes.length, 1)
})

test('generalLocationFor and directionsFor read the task metadata with sensible fallbacks', () => {
  const loc = { county: 'Park', stateAbbr: 'CO' }
  assert.equal(generalLocationFor(task({}), loc), 'Park County, CO')
  assert.equal(generalLocationFor(task({ general_location: '11 miles to Fairplay' }), loc), '11 miles to Fairplay')
  assert.equal(generalLocationFor(task({ location_description: 'Redhill Forest Filing 3' }), loc), 'Redhill Forest Filing 3')
  assert.equal(directionsFor(task({})), undefined)
  assert.equal(directionsFor(task({ directions: 'From Fairplay take 285 south' })), 'From Fairplay take 285 south')
})

test('listingIdFromUrl and publicListingUrl', () => {
  assert.equal(listingIdFromUrl('https://www.land-listings.com/listing/26851'), '26851')
  assert.equal(listingIdFromUrl('https://www.land-listings.com/listing/26851/edit'), '26851')
  assert.equal(listingIdFromUrl('https://www.land-listings.com/edit-listing/77'), '77')
  assert.equal(listingIdFromUrl('https://www.land-listings.com/dashboard?id=9'), '9')
  assert.equal(listingIdFromUrl('https://www.land-listings.com/dashboard'), null)
  assert.equal(publicListingUrl(26851), 'https://www.land-listings.com/listing/26851')
})

test('roundAcres keeps two decimals; labelXpath stays relative to its scope', () => {
  assert.equal(roundAcres(1.005), 1.01)
  assert.equal(roundAcres(42.4349), 42.43)
  const xp = labelXpath('Title')
  assert.ok(xp.startsWith('xpath=(.//'))
  assert.ok(!xp.includes('current()'))
})
