from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel


class SourceMetadata(BaseModel):
    source_product: str
    processing: Literal["SP", "NRT"]
    instrument: str
    satellites: list[str]
    date_min: date
    date_max: date


class MetaResponse(BaseModel):
    sources: list[SourceMetadata]
    date_min: date | None
    date_max: date | None
    last_ingested_at: datetime | None
