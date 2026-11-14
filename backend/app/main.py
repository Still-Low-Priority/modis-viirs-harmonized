# TODO(backend): TEMPORARY STUB so the backend container starts on the server.
# Added by DevOps until the real main.py lands; replace this file with yours.
# Please keep GET /api/health: the CI/CD health check calls it.
#
# nginx proxies /api/ to the backend without stripping the prefix, so every
# route lives under /api.
from fastapi import FastAPI

app = FastAPI(title="MODIS/VIIRS Harmonized API (stub)")


@app.get("/api")
async def root() -> dict[str, str]:
    return {"service": "modis-viirs-harmonized", "status": "stub"}


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
