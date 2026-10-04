from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from src.router.path_router import _store_unavailable, _uuid
from src.services import agent_export, autopilot_decide
from storage import work_maps as work_map_store

router = APIRouter(prefix="/api/v1", tags=["Autopilot"])

# Extra fields are ignored (pydantic's default), so a supplier contact sent by mistake is dropped.


class LineIn(BaseModel):
    description: str = Field("", max_length=300)
    qty: float
    unit: float


class InvoiceIn(BaseModel):
    id: str = Field(..., min_length=1, max_length=50)
    supplier: str = Field(..., max_length=200)
    country: str = Field("", max_length=100)
    date: str = Field("", max_length=30)
    due: str = Field("", max_length=30)
    orderRef: str = Field("", max_length=100)  # noqa: N815 (the UI's field names)
    lines: List[LineIn] = Field(default_factory=list, max_length=50)
    costCenter: str = Field("", max_length=50)  # noqa: N815 (the UI's field names)
    costCenterName: str = Field("", max_length=200)  # noqa: N815 (the UI's field names)
    assetNumber: str = Field("", max_length=100)  # noqa: N815 (the UI's field names)
    comment: str = Field("", max_length=1000)


class PastInvoiceIn(BaseModel):
    id: str = Field(..., max_length=50)
    date: str = Field("", max_length=30)
    amount: float
    note: str = Field("", max_length=300)


class DecideIn(BaseModel):
    invoice: InvoiceIn
    history: List[PastInvoiceIn] = Field(default_factory=list, max_length=20)


@router.post("/work_maps/{work_map_id}/decide")
async def decide(work_map_id: str, body: DecideIn) -> Dict[str, Any]:
    """Routine or judgment for one open invoice, against this Work Map's guardrails."""
    work_map_id = _uuid(work_map_id, "Work Map")
    try:
        work_map = await run_in_threadpool(work_map_store.get, work_map_id)
    except Exception as e:
        raise _store_unavailable(e) from e
    if work_map is None:
        raise HTTPException(status_code=404, detail="Work Map not found")
    try:
        return await autopilot_decide.decide(
            body.invoice.model_dump(),
            [h.model_dump() for h in body.history],
            agent_export.to_json(work_map),
        )
    except autopilot_decide.Unavailable as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
