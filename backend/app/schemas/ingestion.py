from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.integrations.firms.enums import FIRMSProduct


class IngestionJobCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: FIRMSProduct

    west: float = Field(ge=-180, le=180, allow_inf_nan=False)
    south: float = Field(ge=-90, le=90, allow_inf_nan=False)
    east: float = Field(ge=-180, le=180, allow_inf_nan=False)
    north: float = Field(ge=-90, le=90, allow_inf_nan=False)

    start_date: date
    end_date: date

    @model_validator(mode="after")
    def validate_ranges(self):
        if self.west == self.east:
            raise ValueError("West and east must be different.")

        if self.south >= self.north:
            raise ValueError("South must be less than north.")

        if self.start_date > self.end_date:
            raise ValueError("start_date cannot be later than end_date.")

        return self


class IngestionJobAccepted(BaseModel):
    task_id: str
    status: Literal["PENDING"] = "PENDING"


class IngestionJobStatus(BaseModel):
    task_id: str
    status: str
    result: dict[str, str] | None = None
    error: str | None = None

