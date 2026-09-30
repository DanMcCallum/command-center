from datetime import date

from land_comps.config import CountyConfig
from land_comps.dedupe import dedupe, is_same_parcel, match_reason, resolve_apns, source_urls
from land_comps.models import Candidate, Parcel
from land_comps.regrid import QuotaExceeded, RegridError

COUNTY = CountyConfig(
    fips="08093",
    apn_length=10,
    sales_file="s",
    parcels_file="p",
    column_mapping={},
    vacant_land_codes=[],
    excluded_deed_types=[],
)
LAT, LON = 39.0, -105.5
MI = 1 / 69.0912  # degrees of latitude per mile


def _cand(source: str, source_id: str, **fields: object) -> Candidate:
    base: dict[str, object] = {
        "source": source,
        "sources": [source],
        "source_id": source_id,
        "status": "active",
    }
    return Candidate.model_validate({**base, **fields})


def test_apn_duplicates_collapse_despite_formatting() -> None:
    county = _cand("county_sales", "a", status="sold", apn="0012345678", price=50000.0)
    listing = _cand("landwatch", "b", apn="12-345-678", price=60000.0)

    merged = dedupe([county, listing], COUNTY)

    assert len(merged) == 1
    assert match_reason(county, listing, COUNTY) == "apn"
    assert merged[0].apn == "0012345678"


def test_coordinate_duplicates_collapse_within_tolerance() -> None:
    a = _cand("landwatch", "a", lat=LAT, lon=LON, acreage=5.0, price=40000.0)
    b = _cand("realtor", "b", lat=LAT + 0.03 * MI, lon=LON, acreage=5.4, price=41000.0)

    merged = dedupe([a, b], COUNTY)

    assert len(merged) == 1
    assert match_reason(a, b, COUNTY) == "coordinate"
    assert sorted(merged[0].sources) == ["landwatch", "realtor"]


def test_address_duplicates_collapse_after_normalization() -> None:
    a = _cand("landwatch", "a", address="1234 County Road 18, Fairplay", price=40000.0)
    b = _cand("realtor", "b", address="1234 COUNTY ROAD 18 FAIRPLAY", price=40000.0)

    assert match_reason(a, b, COUNTY) == "address"
    assert len(dedupe([a, b], COUNTY)) == 1


def test_adjacent_distinct_parcels_stay_separate() -> None:
    a = _cand("county_sales", "a", status="sold", apn="0000000001", lat=LAT, lon=LON, acreage=5.0)
    b = _cand(
        "county_sales",
        "b",
        status="sold",
        apn="0000000002",
        lat=LAT + 0.02 * MI,
        lon=LON,
        acreage=5.0,
    )

    assert not is_same_parcel(a, b, COUNTY)
    assert len(dedupe([a, b], COUNTY)) == 2


def test_close_parcels_with_different_acreage_stay_separate() -> None:
    a = _cand("landwatch", "a", lat=LAT, lon=LON, acreage=5.0)
    b = _cand("realtor", "b", lat=LAT + 0.02 * MI, lon=LON, acreage=6.0)

    assert len(dedupe([a, b], COUNTY)) == 2


def test_far_parcels_with_same_acreage_stay_separate() -> None:
    a = _cand("landwatch", "a", lat=LAT, lon=LON, acreage=5.0)
    b = _cand("realtor", "b", lat=LAT + 0.2 * MI, lon=LON, acreage=5.0)

    assert not is_same_parcel(a, b, COUNTY)


def test_coordinate_match_needs_acreage_on_both() -> None:
    a = _cand("landwatch", "a", lat=LAT, lon=LON, acreage=5.0)
    b = _cand("realtor", "b", lat=LAT, lon=LON)

    assert not is_same_parcel(a, b, COUNTY)


def test_placeholder_zero_street_number_does_not_merge_distinct_lots() -> None:
    a = _cand("landwatch", "a", address="0 Elk Ridge Rd", acreage=5.0)
    b = _cand("realtor", "b", address="0 Elk Ridge Road", acreage=40.0)

    assert match_reason(a, b, COUNTY) is None


def test_two_sales_of_one_apn_merge_to_the_recent_sale_in_either_order() -> None:
    old = _cand(
        "county_sales",
        "old",
        status="sold",
        apn="0000000001",
        price=50000.0,
        sold_price=50000.0,
        event_date=date(2024, 1, 1),
    )
    new = _cand(
        "county_sales",
        "new",
        status="sold",
        apn="0000000001",
        price=90000.0,
        sold_price=90000.0,
        event_date=date(2025, 6, 1),
    )

    for order in ([old, new], [new, old]):
        (merged,) = dedupe(order, COUNTY)
        assert merged.sold_price == 90000.0
        assert merged.event_date == date(2025, 6, 1)


def test_road_only_addresses_do_not_merge_distinct_lots() -> None:
    a = _cand("landwatch", "a", address="County Road 18")
    b = _cand("realtor", "b", address="County Road 18")

    assert not is_same_parcel(a, b, COUNTY)


def test_listing_without_apn_matches_county_parcel_by_coordinates() -> None:
    county = _cand(
        "county_sales", "a", status="sold", apn="0000000001", lat=LAT, lon=LON, acreage=5.0
    )
    listing = _cand("landwatch", "b", lat=LAT + 0.01 * MI, lon=LON, acreage=5.1)

    merged = dedupe([county, listing], COUNTY)

    assert len(merged) == 1
    assert merged[0].apn == "0000000001"


def test_merge_prefers_county_sold_price_and_keeps_list_price() -> None:
    county = _cand(
        "county_sales",
        "c",
        status="sold",
        apn="0000000001",
        acreage=5.0,
        price=48000.0,
        sold_price=48000.0,
        event_date=date(2026, 3, 1),
        deed_type="Warranty Deed",
    )
    listing = _cand(
        "landwatch",
        "l",
        status="active",
        apn="0000000001",
        acreage=5.0,
        price=55000.0,
        list_price=55000.0,
        road_access="Road frontage: 400 ft",
        utilities=["electric"],
        description="Nice lot",
        url="https://example.test/l",
        event_date=date(2026, 1, 10),
    )

    (merged,) = dedupe([listing, county], COUNTY)

    assert merged.status == "sold"
    assert merged.price == 48000.0
    assert merged.sold_price == 48000.0
    assert merged.list_price == 55000.0
    assert merged.price_per_acre == 48000.0 / 5.0
    assert merged.event_date == date(2026, 3, 1)
    assert merged.sources == ["county_sales", "landwatch"]
    assert merged.deed_type == "Warranty Deed"
    assert merged.road_access == "Road frontage: 400 ft"
    assert merged.utilities == ["electric"]
    assert merged.description == "Nice lot"
    assert merged.url == "https://example.test/l"
    assert merged.raw["merged_from"] == [
        {"source": "county_sales", "source_id": "c"},
        {"source": "landwatch", "source_id": "l"},
    ]


def test_merge_keeps_every_source_url() -> None:
    a = _cand("landwatch", "a", apn="0000000001", url="https://lw.test/a")
    b = _cand("realtor", "b", apn="0000000001", url="https://rt.test/b")
    c = _cand("realtor", "c", apn="0000000001")

    (merged,) = dedupe([a, b, c], COUNTY)

    assert source_urls(merged) == ["https://lw.test/a", "https://rt.test/b"]
    assert source_urls(c) == []


def test_active_and_pending_listings_merge_as_pending() -> None:
    a = _cand("landwatch", "a", apn="0000000001", price=10000.0, list_price=10000.0)
    b = _cand("realtor", "b", apn="0000000001", status="pending", price=10000.0)

    (merged,) = dedupe([a, b], COUNTY)

    assert merged.status == "pending"
    assert merged.sold_price is None


def test_merge_is_transitive_across_rules() -> None:
    a = _cand("county_sales", "a", status="sold", apn="0000000001", address="9 Elk Ln")
    b = _cand("landwatch", "b", apn="0000000001")
    c = _cand("realtor", "c", address="9 Elk Lane")

    (merged,) = dedupe([a, b, c], COUNTY)

    assert sorted(merged.sources) == ["county_sales", "landwatch", "realtor"]


def test_unrelated_candidates_pass_through_in_order() -> None:
    items = [
        _cand("landwatch", "1", apn="0000000001"),
        _cand("landwatch", "2", apn="0000000002"),
        _cand("landwatch", "3", apn="0000000003"),
    ]

    assert [c.source_id for c in dedupe(items, COUNTY)] == ["1", "2", "3"]


class FakePointLookup:
    def __init__(self, apns: dict[int, str | None], fail_at: int | None = None) -> None:
        self.apns = apns
        self.fail_at = fail_at
        self.calls = 0

    def by_apn(self, apn: str, county_fips: str) -> Parcel | None:
        raise AssertionError("by_apn is not used for resolution")

    def by_address(self, address: str) -> Parcel | None:
        raise AssertionError("by_address is not used for resolution")

    def by_point(self, lat: float, lon: float) -> Parcel | None:
        self.calls += 1
        if self.fail_at == self.calls:
            raise QuotaExceeded("cap reached")
        apn = self.apns.get(self.calls)
        if apn is None:
            return None
        return Parcel(apn=apn, lat=lat, lon=lon, county_fips="08093")


def test_resolve_apn_lets_listing_dedupe_by_apn() -> None:
    county = _cand("county_sales", "c", status="sold", apn="0000000001", price=1000.0)
    listing = _cand(
        "landwatch", "l", lat=LAT + 0.3, lon=LON, price=2000.0
    )  # far from county coords

    lookup = FakePointLookup({1: "1"})
    (merged,) = dedupe([county, listing], COUNTY, apn_resolver=lookup)

    assert merged.apn == "0000000001"
    assert lookup.calls == 1


def test_resolve_apn_skips_candidates_with_apn_or_without_coordinates() -> None:
    lookup = FakePointLookup({})
    items = [
        _cand("landwatch", "1", apn="0000000001", lat=LAT, lon=LON),
        _cand("landwatch", "2"),
    ]

    result = resolve_apns(items, lookup, COUNTY)

    assert lookup.calls == 0
    assert result.attempted == 0


def test_resolve_apn_stops_on_quota_and_reports_it() -> None:
    lookup = FakePointLookup({1: "1", 2: "2", 3: "3"}, fail_at=2)
    items = [_cand("landwatch", str(i), lat=LAT + i * 0.1, lon=LON) for i in range(3)]

    result = resolve_apns(items, lookup, COUNTY)

    assert lookup.calls == 2  # no third call after the quota error
    assert [c.apn for c in result.candidates] == ["0000000001", None, None]
    assert result.resolved == 1
    assert result.stopped_early is not None
    assert "QuotaExceeded" in result.stopped_early


def test_resolve_apn_ignores_parcel_outside_county() -> None:
    class OtherCounty(FakePointLookup):
        def by_point(self, lat: float, lon: float) -> Parcel | None:
            return Parcel(apn="9", lat=lat, lon=lon, county_fips="08999")

    result = resolve_apns([_cand("landwatch", "1", lat=LAT, lon=LON)], OtherCounty({}), COUNTY)

    assert result.candidates[0].apn is None


def test_resolve_apn_stops_on_other_regrid_errors() -> None:
    class Broken(FakePointLookup):
        def by_point(self, lat: float, lon: float) -> Parcel | None:
            raise RegridError("HTTP 500")

    items = [_cand("landwatch", str(i), lat=LAT, lon=LON) for i in range(2)]
    result = resolve_apns(items, Broken({}), COUNTY)

    assert result.attempted == 1
    assert result.resolved == 0
