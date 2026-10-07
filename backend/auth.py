import hashlib
import hmac
import os
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session as DbSession

from database import SessionLocal, get_db
from models import Session, User
from schemas import LoginIn

router = APIRouter(prefix="/auth", tags=["auth"])


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or os.urandom(16).hex()
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 100_000).hex()
    return f"{salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    salt, digest = stored.split("$")
    return hmac.compare_digest(hash_password(password, salt).split("$")[1], digest)


def seed_admin():
    """Create the single mock user on first start."""
    with SessionLocal() as db:
        if not db.query(User).filter_by(username="admin").first():
            db.add(User(username="admin", password_hash=hash_password("admin123")))
            db.commit()


def _token_from(authorization: str | None) -> str | None:
    if authorization and authorization.startswith("Bearer "):
        return authorization[7:]
    return None


def current_user(authorization: str | None = Header(None), db: DbSession = Depends(get_db)) -> User:
    token = _token_from(authorization)
    session = db.get(Session, token) if token else None
    if not session:
        raise HTTPException(401, "Not authenticated")
    return db.get(User, session.user_id)


@router.post("/login")
def login(data: LoginIn, db: DbSession = Depends(get_db)):
    user = db.query(User).filter_by(username=data.username).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, "Incorrect username or password")
    token = secrets.token_hex(32)
    db.add(Session(token=token, user_id=user.id))
    db.commit()
    return {"token": token, "username": user.username}


@router.post("/logout", status_code=204)
def logout(authorization: str | None = Header(None), db: DbSession = Depends(get_db)):
    session = db.get(Session, _token_from(authorization) or "")
    if session:
        db.delete(session)
        db.commit()


@router.get("/me")
def me(user: User = Depends(current_user)):
    return {"username": user.username}
