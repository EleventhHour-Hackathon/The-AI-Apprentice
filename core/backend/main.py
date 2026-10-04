from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from src.core.config import Config
from src.router.path_router import router
from src.utils.logger import intercept_standard_logging, logger

intercept_standard_logging()

# The voice agent runs on ElevenLabs (src/services/apprentice_agent.py); this server
# only hands out conversation tokens, reads the screen and keeps the Work Maps.
app = FastAPI(title="AI Apprentice", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=Config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def root():
    return {"message": "Server is healthy", "version": "2.0.0"}


app.include_router(router)

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
