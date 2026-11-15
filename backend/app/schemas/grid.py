from pydantic import BaseModel, ConfigDict


class GridCell(BaseModel):
    model_config = ConfigDict(frozen=True)

    lat: float
    lon: float
    count: int
    frp_sum: float
