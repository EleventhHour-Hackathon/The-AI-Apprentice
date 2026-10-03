import json
import os
import subprocess
import uuid

from fastapi import APIRouter, Body, HTTPException, Request

from src.core.config import Config
from src.services.screen_vision import get_backend as get_vision_backend, log_frame
from src.utils.logger import logger

UPLOAD_DIR = Config.UPLOAD_DIR

router = APIRouter(
    prefix="/api/v1",
    tags=["Path"],
    responses={404: {"description": "Not found"}},
)


@router.post("/connect")
async def rtvi_connect(request: Request):
    manager = request.app.state.manager

    room_url, bot_token = await manager.create_room_and_token()
    session_id = str(uuid.uuid4())

    body = await request.json()
    job_id = body.get("job_id", None)
    candidate_id = body.get("candidate_id", None)

    try:
        # Build the command list first
        command = [
            "python3",
            "-m",
            "src.services.bot_defaults",
            "-u",
            room_url,
            "-t",
            bot_token,
            "-s",
            session_id,
        ]

        if job_id:
            command.extend(["-j", job_id])
        if candidate_id:
            command.extend(["-c", candidate_id])

        proc = subprocess.Popen(
            command,
            bufsize=1,
            cwd=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        )

        manager.add_process(proc.pid, proc)
    except Exception as e:
        logger.error(f"Error starting bot process: {e}")
        raise HTTPException(status_code=500, detail="Failed to process!")

    return {"room_url": room_url, "token": bot_token}


@router.post("/disconnect")
async def rtvi_disconnect(token: str, request: Request):
    """Disconnect the voice chat session and cleanup resources."""
    manager = request.app.state.manager
    try:
        # Since there's no DB, we can't check for room URL by token anymore
        # We'll just clean up processes

        for pid, proc in manager.processes.items():
            try:
                proc.terminate()
                proc.wait()
                logger.info(f"Process {pid} terminated successfully")
            except Exception as e:
                logger.error(f"Error terminating process {pid}: {e}")

        return {"message": "Disconnected successfully"}

    except Exception as e:
        logger.error(f"Error during disconnect: {e}")
        raise HTTPException(status_code=500, detail=f"Disconnect failed: {str(e)}")


@router.post("/screen_event")
async def screen_event(payload: dict = Body(...)):
    """Describe what changed on the expert's screen since the last frame.

    The client samples its screen share every couple of seconds and posts
    the frame here; we hand back an event it can drop into the live
    conversation so the agent knows what the expert is doing.
    """
    frame = payload.get("frame")
    if not frame:
        raise HTTPException(status_code=400, detail="Missing 'frame'")

    # Accept either a bare base64 payload or a full data: URL.
    if frame.startswith("data:"):
        frame = frame.split(",", 1)[-1]

    backend = get_vision_backend()
    try:
        result = await backend.describe(frame, payload.get("previous"))
    except Exception as e:
        logger.error(f"Screen understanding failed: {e}")
        raise HTTPException(status_code=502, detail="Screen understanding failed")

    log_frame(frame, result, type(backend).__name__)
    return result
