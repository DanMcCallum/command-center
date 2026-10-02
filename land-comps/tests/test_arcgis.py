import json

import httpx
import pytest

from land_comps.arcgis import ArcGisError, fetch_features

LAYER = "https://gis.example.test/server/rest/services/Parcels/MapServer/0"


def _feature(oid: int) -> dict[str, object]:
    return {"attributes": {"OBJECTID": oid}, "geometry": {"rings": [[[0, 0], [1, 0], [1, 1]]]}}


def test_walks_pages_until_transfer_limit_clears() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        offset = int(request.url.params["resultOffset"])
        if offset == 0:
            body = {"features": [_feature(1), _feature(2)], "exceededTransferLimit": True}
        else:
            body = {"features": [_feature(3)]}
        return httpx.Response(200, json=body)

    features = fetch_features(
        LAYER, ["OBJECTID"], page_size=2, transport=httpx.MockTransport(handler)
    )

    assert [f["attributes"]["OBJECTID"] for f in features] == [1, 2, 3]
    assert [r.url.params["resultOffset"] for r in requests] == ["0", "2"]
    first = requests[0].url
    assert first.path.endswith("/Parcels/MapServer/0/query")
    assert first.params["outSR"] == "4326"
    assert first.params["outFields"] == "OBJECTID"
    assert first.params["resultRecordCount"] == "2"
    assert first.params["f"] == "json"


def test_error_payload_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"error": {"code": 400, "message": "Invalid query"}})

    with pytest.raises(ArcGisError, match="Invalid query"):
        fetch_features(LAYER, ["OBJECTID"], transport=httpx.MockTransport(handler))


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(500, text="boom"),
        httpx.Response(200, text="<html>not json</html>"),
        httpx.Response(200, content=json.dumps({"fields": []})),
    ],
)
def test_http_failure_bad_json_and_missing_features_raise(response: httpx.Response) -> None:
    with pytest.raises(ArcGisError):
        fetch_features(LAYER, ["OBJECTID"], transport=httpx.MockTransport(lambda r: response))
