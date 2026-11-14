# TODO(backend): ТИМЧАСОВА ЗАТИЧКА, щоб контейнер бекенду стартував на сервері.
# Додана DevOps до появи справжнього main.py — замініть цей файл своїм.
# Бажано зберегти GET /api/health: на нього дивиться health check у CI/CD.
#
# nginx проксює /api/ на бекенд без зрізання префікса, тому всі роути під /api.
from fastapi import FastAPI

app = FastAPI(title="MODIS/VIIRS Harmonized API (stub)")


@app.get("/api")
async def root() -> dict[str, str]:
    return {"service": "modis-viirs-harmonized", "status": "stub"}


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
