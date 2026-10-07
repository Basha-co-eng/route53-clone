from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session as DbSession

from auth import current_user
from database import get_db
from models import HostedZone, Record
from schemas import ZoneIn, ZoneOut, ZonePage, ZoneUpdate

router = APIRouter(prefix="/zones", tags=["hosted zones"], dependencies=[Depends(current_user)])

NAME_SERVERS = [
    "ns-1536.awsdns-00.co.uk.",
    "ns-0.awsdns-00.com.",
    "ns-1024.awsdns-00.org.",
    "ns-512.awsdns-00.net.",
]
SOA_VALUE = "ns-1536.awsdns-00.co.uk. awsdns-hostmaster.amazon.com. 1 7200 900 1209600 86400"


def to_out(zone: HostedZone) -> ZoneOut:
    out = ZoneOut.model_validate(zone)
    out.record_count = len(zone.records)
    return out


def get_zone_or_404(zone_id: int, db: DbSession) -> HostedZone:
    zone = db.get(HostedZone, zone_id)
    if not zone:
        raise HTTPException(404, "Hosted zone not found")
    return zone


@router.get("", response_model=ZonePage)
def list_zones(
    search: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    db: DbSession = Depends(get_db),
):
    q = db.query(HostedZone)
    if search:
        like = f"%{search.strip()}%"
        q = q.filter(or_(HostedZone.name.ilike(like), HostedZone.description.ilike(like), HostedZone.type.ilike(like)))
    total = q.count()
    rows = q.order_by(HostedZone.name).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": [to_out(z) for z in rows], "total": total}


@router.post("", response_model=ZoneOut, status_code=201)
def create_zone(data: ZoneIn, db: DbSession = Depends(get_db)):
    name = data.name.strip().lower().rstrip(".")
    if db.query(HostedZone).filter_by(name=name).first():
        raise HTTPException(409, "A hosted zone with this domain name already exists")
    zone = HostedZone(name=name, type=data.type, description=data.description)
    # Like real Route 53: every new zone gets default NS and SOA records.
    zone.records = [
        Record(name=name, type="NS", value="\n".join(NAME_SERVERS), ttl=172800),
        Record(name=name, type="SOA", value=SOA_VALUE, ttl=900),
    ]
    db.add(zone)
    db.commit()
    db.refresh(zone)
    return to_out(zone)


@router.get("/{zone_id}", response_model=ZoneOut)
def get_zone(zone_id: int, db: DbSession = Depends(get_db)):
    return to_out(get_zone_or_404(zone_id, db))


@router.put("/{zone_id}", response_model=ZoneOut)
def update_zone(zone_id: int, data: ZoneUpdate, db: DbSession = Depends(get_db)):
    zone = get_zone_or_404(zone_id, db)
    zone.description = data.description
    db.commit()
    return to_out(zone)


@router.delete("/{zone_id}", status_code=204)
def delete_zone(zone_id: int, db: DbSession = Depends(get_db)):
    db.delete(get_zone_or_404(zone_id, db))
    db.commit()
