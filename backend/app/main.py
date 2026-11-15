from fastapi import FastAPI

from app.api.routes.ingestion import router as ingestion_router
from app.api.routes.meta import router as meta_router
from app.api.routes.detections import router as detections_router
from app.api.routes.timeseries import router as timeseries_router
from app.api.routes.hotspots import router as hotspots_router

app = FastAPI(
    title="MODIS/VIIRS Harmonized API",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url="/api/redoc",
)

app.include_router(ingestion_router)
app.include_router(meta_router)
app.include_router(detections_router)
app.include_router(timeseries_router)
app.include_router(hotspots_router)

@app.get("/api")
async def root() -> dict[str, str]:
    return {
        "service": "modis-viirs-harmonized",
        "status": "ok",
    }


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
