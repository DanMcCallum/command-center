"""Paged feature download from an ArcGIS REST layer (MapServer or FeatureServer).

Park County publishes its parcel and zoning polygons through ArcGIS Server.
Each layer caps a query at `maxRecordCount` rows (2,000 for Park County) and
supports `resultOffset` pagination, so `fetch_features` walks the pages and
returns plain feature dicts: `attributes` plus WGS84 `geometry` rings. Callers
map the layer's field names; this module knows nothing about parcels.
"""

from typing import Any

import httpx

Feature = dict[str, Any]

DEFAULT_PAGE_SIZE = 2000
DEFAULT_TIMEOUT_SECS = 120.0


class ArcGisError(Exception):
    """The layer could not be read (HTTP failure, error payload, or bad JSON)."""


def fetch_features(
    layer_url: str,
    out_fields: list[str],
    *,
    where: str = "1=1",
    order_by: str = "OBJECTID",
    page_size: int = DEFAULT_PAGE_SIZE,
    transport: httpx.BaseTransport | None = None,
    timeout: float = DEFAULT_TIMEOUT_SECS,
) -> list[Feature]:
    """Return every feature of `layer_url` matching `where`, with WGS84 geometry.

    Geometry is requested in EPSG:4326 at six decimal places (about 10 cm), so
    rings arrive as `[lon, lat]` pairs. Pages are requested in `order_by` order
    until the server stops reporting `exceededTransferLimit`.
    """
    query_url = layer_url.rstrip("/") + "/query"
    features: list[Feature] = []
    offset = 0
    with httpx.Client(transport=transport, timeout=timeout) as http:
        while True:
            payload = _query(
                http,
                query_url,
                {
                    "where": where,
                    "outFields": ",".join(out_fields),
                    "outSR": "4326",
                    "geometryPrecision": "6",
                    "orderByFields": order_by,
                    "resultOffset": str(offset),
                    "resultRecordCount": str(page_size),
                    "f": "json",
                },
            )
            page = payload.get("features")
            if not isinstance(page, list):
                raise ArcGisError(f"{query_url} returned no features list")
            features.extend(f for f in page if isinstance(f, dict))
            if not page or not payload.get("exceededTransferLimit"):
                return features
            offset += len(page)


def _query(http: httpx.Client, url: str, params: dict[str, str]) -> dict[str, Any]:
    try:
        response = http.get(url, params=params)
    except httpx.HTTPError as exc:
        raise ArcGisError(f"ArcGIS request to {url} failed: {type(exc).__name__}") from exc
    if response.is_error:
        raise ArcGisError(f"ArcGIS request to {url} failed with HTTP {response.status_code}")
    try:
        payload = response.json()
    except ValueError as exc:
        raise ArcGisError(f"ArcGIS returned invalid JSON for {url}") from exc
    if not isinstance(payload, dict):
        raise ArcGisError(f"ArcGIS returned a non-object payload for {url}")
    error = payload.get("error")
    if isinstance(error, dict):
        message = error.get("message") or "unknown error"
        raise ArcGisError(f"ArcGIS error for {url}: {message}")
    return payload
