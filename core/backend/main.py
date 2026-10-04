import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from src.core import access
from src.core.config import Config
from src.router.path_router import router
from src.router import tutor_kb_router
from src.router import work_map_diff_router
from src.router import follow_ups_router
from src.router import living_map_router
from src.router import autopilot_router
from src.router import coverage_router
from src.services import privacy, recordings
from storage import work_maps as work_map_store
from src.utils.logger import intercept_standard_logging, logger

intercept_standard_logging()

# The voice agent runs on ElevenLabs (src/services/apprentice_agent.py); this server
# only hands out conversation tokens, reads the screen and keeps the Work Maps.
app = FastAPI(title="AI Apprentice", version="2.0.0")

# Added before CORS so CORS wraps it: a 401 still carries the CORS headers the app needs to read it.
app.add_middleware(access.AccessKeyMiddleware)
# The desktop app sends the access key in a header, not a cookie, so any origin is safe.
app.add_middleware(
    CORSMiddleware,
    allow_origins=Config.CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=[access.HEADER, "Content-Type", "*"],
)


@app.get("/health")
async def root():
    # The first call loads spaCy (when the privacy extra is installed), so it runs off the loop.
    return {
        "message": "Server is healthy",
        "version": "2.0.0",
        "privacy": await asyncio.to_thread(privacy.status),
        "access": access.mode(),
    }


app.include_router(router)
app.include_router(tutor_kb_router.router)
app.include_router(work_map_diff_router.router)
app.include_router(follow_ups_router.router)
app.include_router(living_map_router.router)
app.include_router(autopilot_router.router)
app.include_router(coverage_router.router)


@app.on_event("startup")
async def push_pending_media():
    # Recordings or clips that couldn't reach Supabase Storage last time go up now, off the request path.
    async def push():
        try:
            pushed = await asyncio.to_thread(recordings.push_pending)
            if pushed:
                logger.info(f"Uploaded {pushed} waiting recordings and clips to Storage")
        except Exception as e:
            logger.warning(f"Couldn't push waiting recordings and clips: {e}")

    asyncio.get_running_loop().create_task(push())


# Unconfirmed Work Maps are kept this long (the Work Maps page counts down to it).
UNCONFIRMED_RETENTION_DAYS = 30


def purge_unconfirmed() -> int:
    """Delete Work Maps the expert never confirmed, with their video, once they expire."""
    purged = 0
    for work_map_id in work_map_store.expired_unconfirmed(UNCONFIRMED_RETENTION_DAYS):
        try:
            recordings.delete(work_map_id)  # video first: the row says where it is
            purged += work_map_store.delete(work_map_id)
        except Exception as e:
            logger.warning(f"Couldn't delete expired Work Map {work_map_id}: {e}")
    return purged


@app.on_event("startup")
async def purge_expired_work_maps():
    async def loop():
        while True:
            try:
                purged = await asyncio.to_thread(purge_unconfirmed)
                if purged:
                    logger.info(f"Deleted {purged} unconfirmed Work Maps older than {UNCONFIRMED_RETENTION_DAYS} days")
            except Exception as e:
                logger.warning(f"Couldn't purge expired Work Maps: {e}")
            await asyncio.sleep(24 * 3600)

    asyncio.get_running_loop().create_task(loop())

if __name__ == "__main__":
    logger.info(f"Starting application server in {Config.ENVIRONMENT} mode")
    uvicorn.run(
        "main:app",
        host=Config.HOST,
        port=Config.PORT,
        reload=Config.RELOAD,
        proxy_headers=True,
        forwarded_allow_ips="*",
        reload_excludes=[
            ".venv",
            ".venv/*",
            "venv",
            "venv/*",
            "env",
            "env/*",
            "__pycache__",
            "__pycache__/*",
            "*.pyc",
            "*.pyo",
            "*.pyd",
            ".git",
            ".git/*",
            "node_modules",
            "node_modules/*",
            ".pytest_cache",
            ".pytest_cache/*",
            "*.log",
            "*.sqlite",
            "*.db",
            ".DS_Store",
            "Thumbs.db",
            "*.tmp",
            "*.temp",
            ".coverage",
            "htmlcov",
            "htmlcov/*",
            "dist",
            "dist/*",
            "build",
            "build/*",
            "*.egg-info",
            "*.egg-info/*",
        ],
    )
