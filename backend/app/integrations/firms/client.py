from typing import Literal

import httpx
from pydantic import SecretStr
from datetime import date, datetime, timedelta, timezone

from app.core.exceptions import FIRMSConnectionError, FIRMSHTTPError, FIRMSTimeoutError
from app.integrations.firms.enums import FIRMSProduct

class FIRMSClient:
    BASE_URL = "https://firms.modaps.eosdis.nasa.gov/api"

    def __init__(self, firms_map_key: SecretStr, timeout: float = 30.0) -> None:
        self._client = httpx.AsyncClient(timeout=timeout)
        self._firms_map_key = firms_map_key

    async def __aenter__(self):
        await self._client.__aenter__()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self._client.__aexit__(exc_type, exc_val, exc_tb)

    async def _get_csv(self, url: str) -> str:
        try:
            response = await self._client.get(url)
            response.raise_for_status()
            return response.text
        except httpx.TimeoutException:
            raise FIRMSTimeoutError("FIRMS timeout Error") from None
        except httpx.HTTPStatusError as exc:
            raise FIRMSHTTPError("FIRMS HTTP error", exc.response.status_code) from None
        except httpx.RequestError:
            raise FIRMSConnectionError("FIRMS connection error") from None

    async def get_data_availability_csv(self, source: FIRMSProduct | Literal["ALL"] = "ALL") -> str:
        return await self._get_csv(f'{self.BASE_URL}/data_availability/csv/{self._firms_map_key.get_secret_value()}/{source.value if isinstance(source, FIRMSProduct) else source}')

    async def get_area_csv(
        self,
        *,
        source: FIRMSProduct,
        west: float,
        south: float,
        east: float,
        north: float,
        day_range: int = 1,
        start_date: date | None = None
    ) -> str:
        # Validate day_range
        if isinstance(day_range, bool) or not isinstance(day_range, int):
            raise TypeError("day_range must be an integer.")

        if not 1 <= day_range <= 5:
            raise ValueError("day_range must be between 1 and 5.")

        # Validate longitude
        if not -180 <= west <= 180 or not -180 <= east <= 180:
            raise ValueError("Longitude must be between -180 and 180.")

        if west >= east:
            raise ValueError("west must be less than east.")

        # Validate latitude
        if not -90 <= south <= 90 or not -90 <= north <= 90:
            raise ValueError("Latitude must be between -90 and 90.")

        if south >= north:
            raise ValueError("south must be less than north.")

        # Validate date
        if start_date is not None:
            if isinstance(start_date, datetime) or not isinstance(start_date, date):
                raise TypeError("start_date must be a date.")

            end_date = start_date + timedelta(days=day_range - 1)
            today = datetime.now(timezone.utc).date()

            if end_date > today:
                raise ValueError("The requested period cannot end in the future.")

        # Build URL
        coordinates = f"{west},{south},{east},{north}"
        base_url = (
            f"{self.BASE_URL}/area/csv/"
            f"{self._firms_map_key.get_secret_value()}/"
            f"{source.value}/{coordinates}/{day_range}"
        )

        if start_date is not None:
            base_url += f"/{start_date.isoformat()}"

        return await self._get_csv(base_url)

