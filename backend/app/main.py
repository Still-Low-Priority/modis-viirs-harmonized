from fastapi import FastAPI

from app.api.routes.ingestion import router as ingestion_router


app = FastAPI(title="MODIS/VIIRS Harmonized API")

app.include_router(ingestion_router)


@app.get("/api")
async def root() -> dict[str, str]:
    return {
        "service": "modis-viirs-harmonized",
        "status": "ok",
    }


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
