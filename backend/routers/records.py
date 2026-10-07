import ipaddress
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session as DbSession

from auth import current_user
from database import get_db
from models import Record
from routers.zones import get_zone_or_404
from schemas import RecordIn, RecordOut, RecordPage

router = APIRouter(prefix="/zones/{zone_id}/records", tags=["records"], dependencies=[Depends(current_user)])

PATTERNS = {
    "MX": (r"^\d+\s+\S+$", "MX format: priority domain"),
    "SRV": (r"^\d+\s+\d+\s+\d+\s+\S+$", "SRV format: priority weight port target"),
    "CAA": (r"^\d+\s+(issue|issuewild|iodef)\s+.+$", "CAA format: flags tag value"),
}


def validate_value(rtype: str, value: str) -> None:
    lines = [l.strip() for l in value.splitlines() if l.strip()]
    if not lines:
        raise HTTPException(400, "Value is required")
    if rtype == "CNAME" and len(lines) > 1:
        raise HTTPException(400, "CNAME allows only one value")
    for line in lines:
        try:
            if rtype == "A":
                ipaddress.IPv4Address(line)
            elif rtype == "AAAA":
                ipaddress.IPv6Address(line)
        except ValueError:
            raise HTTPException(400, f"{rtype} record needs a valid {'IPv4' if rtype == 'A' else 'IPv6'} address")
        if rtype in PATTERNS and not re.match(PATTERNS[rtype][0], line):
            raise HTTPException(400, PATTERNS[rtype][1])


def is_protected(zone, rec: Record) -> bool:
    return rec.name == zone.name and rec.type in ("NS", "SOA")


def check_record(zone, data: RecordIn, db: DbSession, ignore_id: int | None = None) -> str:
    name = data.name.strip().lower().rstrip(".")
    if name != zone.name and not name.endswith("." + zone.name):
        raise HTTPException(400, f"Record name must end with {zone.name}")
    validate_value(data.type, data.value)
    others = db.query(Record).filter(Record.zone_id == zone.id, Record.name == name)
    if ignore_id:
        others = others.filter(Record.id != ignore_id)
    others = others.all()
    if any(o.type == data.type for o in others):
        raise HTTPException(409, "A record with this name and type already exists")
    if others and (data.type == "CNAME" or any(o.type == "CNAME" for o in others)):
        raise HTTPException(409, "A CNAME record cannot coexist with other records of the same name")
    return name


def get_record_or_404(zone_id: int, rid: int, db: DbSession) -> Record:
    rec = db.query(Record).filter_by(id=rid, zone_id=zone_id).first()
    if not rec:
        raise HTTPException(404, "Record not found")
    return rec


@router.get("", response_model=RecordPage)
def list_records(
    zone_id: int,
    search: str = "",
    type: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    db: DbSession = Depends(get_db),
):
    get_zone_or_404(zone_id, db)
    q = db.query(Record).filter(Record.zone_id == zone_id)
    if type:
        q = q.filter(Record.type == type.upper())
    if search:
        like = f"%{search.strip()}%"
        q = q.filter(or_(Record.name.ilike(like), Record.value.ilike(like), Record.type.ilike(like)))
    total = q.count()
    rows = q.order_by(Record.name, Record.type).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": rows, "total": total}


@router.post("", response_model=RecordOut, status_code=201)
def create_record(zone_id: int, data: RecordIn, db: DbSession = Depends(get_db)):
    zone = get_zone_or_404(zone_id, db)
    name = check_record(zone, data, db)
    rec = Record(zone_id=zone_id, name=name, type=data.type, value=data.value.strip(),
                 ttl=data.ttl, routing_policy=data.routing_policy)
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


@router.put("/{rid}", response_model=RecordOut)
def update_record(zone_id: int, rid: int, data: RecordIn, db: DbSession = Depends(get_db)):
    zone = get_zone_or_404(zone_id, db)
    rec = get_record_or_404(zone_id, rid, db)
    if is_protected(zone, rec):
        raise HTTPException(400, "The default NS and SOA records cannot be edited")
    rec.name = check_record(zone, data, db, ignore_id=rid)
    rec.type, rec.value, rec.ttl = data.type, data.value.strip(), data.ttl
    rec.routing_policy = data.routing_policy
    db.commit()
    return rec


@router.delete("/{rid}", status_code=204)
def delete_record(zone_id: int, rid: int, db: DbSession = Depends(get_db)):
    zone = get_zone_or_404(zone_id, db)
    rec = get_record_or_404(zone_id, rid, db)
    if is_protected(zone, rec):
        raise HTTPException(400, "The default NS and SOA records cannot be deleted")
    db.delete(rec)
    db.commit()
