from datetime import date, timedelta, timezone, datetime

import httpx
import pytest
from pydantic import SecretStr

from app.core.exceptions import FIRMSConnectionError, FIRMSHTTPError, FIRMSTimeoutError
from app.integrations.firms.client import FIRMSClient
from app.integrations.firms.enums import FIRMSProduct


async def make_client(handler: httpx.MockTransport) -> FIRMSClient:
    client = FIRMSClient(SecretStr("test-map-key"))
    client._client = httpx.AsyncClient(transport=handler)
    return client


async def test_requests_availability_csv_for_selected_product() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, text="data_id,min_date,max_date\n", request=request)

    client = await make_client(httpx.MockTransport(handler))
    try:
        assert await client.get_data_availability_csv(FIRMSProduct.MODIS_NRT) == "data_id,min_date,max_date\n"
    finally:
        await client._client.aclose()

    assert requests[0].url.path == "/api/data_availability/csv/test-map-key/MODIS_NRT"


async def test_requests_area_csv_with_coordinates_day_range_and_start_date() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, text="csv", request=request)

    client = await make_client(httpx.MockTransport(handler))
    try:
        response = await client.get_area_csv(
            source=FIRMSProduct.VIIRS_NOAA21_SP,
            west=20.5,
            south=40.0,
            east=30.5,
            north=50.0,
            day_range=3,
            start_date=date(2026, 1, 2),
        )
    finally:
        await client._client.aclose()

    assert response == "csv"
    assert requests[0].url.path == "/api/area/csv/test-map-key/VIIRS_NOAA21_SP/20.5,40.0,30.5,50.0/3/2026-01-02"


@pytest.mark.parametrize("status_code", [401, 429, 500])
async def test_converts_http_errors(status_code: int) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code, request=request)

    client = await make_client(httpx.MockTransport(handler))
    try:
        with pytest.raises(FIRMSHTTPError) as error:
            await client.get_data_availability_csv()
    finally:
        await client._client.aclose()

    assert error.value.upstream_status_code == status_code


async def test_converts_timeout_errors() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    client = await make_client(httpx.MockTransport(handler))
    try:
        with pytest.raises(FIRMSTimeoutError):
            await client.get_data_availability_csv()
    finally:
        await client._client.aclose()


async def test_converts_connection_errors() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline", request=request)

    client = await make_client(httpx.MockTransport(handler))
    try:
        with pytest.raises(FIRMSConnectionError):
            await client.get_data_availability_csv()
    finally:
        await client._client.aclose()


@pytest.mark.parametrize("day_range,error", [(0, "between 1 and 5"), (6, "between 1 and 5"), (True, "must be an integer")])
async def test_rejects_invalid_area_day_range_before_http_request(day_range: int, error: str) -> None:
    client = FIRMSClient(SecretStr("test-map-key"))
    with pytest.raises((TypeError, ValueError), match=error):
        await client.get_area_csv(source=FIRMSProduct.MODIS_NRT, west=20, south=40, east=30, north=50, day_range=day_range)
    await client._client.aclose()


async def test_rejects_future_area_period_before_http_request() -> None:
    client = FIRMSClient(SecretStr("test-map-key"))
    tomorrow = datetime.now(timezone.utc).date() + timedelta(days=1)
    with pytest.raises(ValueError, match="cannot end in the future"):
        await client.get_area_csv(source=FIRMSProduct.MODIS_NRT, west=20, south=40, east=30, north=50, start_date=tomorrow)
    await client._client.aclose()
