from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


def now():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True)
    password_hash: Mapped[str] = mapped_column(String(200))


class Session(Base):
    __tablename__ = "sessions"
    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class HostedZone(Base):
    __tablename__ = "hosted_zones"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    type: Mapped[str] = mapped_column(String(10), default="Public")  # Public | Private
    description: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    records: Mapped[list["Record"]] = relationship(back_populates="zone", cascade="all, delete-orphan")


class Record(Base):
    __tablename__ = "records"
    __table_args__ = (UniqueConstraint("zone_id", "name", "type"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    zone_id: Mapped[int] = mapped_column(ForeignKey("hosted_zones.id"), index=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    type: Mapped[str] = mapped_column(String(10))
    value: Mapped[str] = mapped_column(String(2000))  # multiple values separated by newline
    ttl: Mapped[int] = mapped_column(Integer, default=300)
    routing_policy: Mapped[str] = mapped_column(String(30), default="Simple")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    zone: Mapped[HostedZone] = relationship(back_populates="records")
