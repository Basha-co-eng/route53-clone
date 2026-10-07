from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

RecordType = Literal["A", "AAAA", "CNAME", "TXT", "MX", "NS", "PTR", "SRV", "CAA"]


class LoginIn(BaseModel):
    username: str
    password: str


class ZoneIn(BaseModel):
    name: str = Field(min_length=3, max_length=253)
    type: Literal["Public", "Private"] = "Public"
    description: str = Field(default="", max_length=255)


class ZoneUpdate(BaseModel):
    description: str = Field(default="", max_length=255)


class ZoneOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    type: str
    description: str
    created_at: datetime
    record_count: int = 0


class RecordIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    type: RecordType
    value: str = Field(min_length=1, max_length=2000)
    ttl: int = Field(default=300, ge=0, le=2147483647)
    routing_policy: str = "Simple"


class RecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    zone_id: int
    name: str
    type: str
    value: str
    ttl: int
    routing_policy: str


class ZonePage(BaseModel):
    items: list[ZoneOut]
    total: int


class RecordPage(BaseModel):
    items: list[RecordOut]
    total: int
