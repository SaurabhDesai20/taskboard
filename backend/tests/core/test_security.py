"""Password hashing and access tokens. No database needed."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
import pytest

from app.core.security import (
    InvalidTokenError,
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)

# 64+ bytes, so even the HS512 case below signs without an InsecureKeyLengthWarning.
SECRET = "unit-test-secret-" + "0123456789abcdef" * 4


def test_hash_password_produces_verifiable_argon2id_hash() -> None:
    hashed = hash_password("correct-horse-battery")

    assert hashed.startswith("$argon2id$")
    assert "correct-horse-battery" not in hashed
    assert hashed != hash_password("correct-horse-battery")  # salted
    assert verify_password(hashed, "correct-horse-battery")
    assert not verify_password(hashed, "wrong-password")


def test_verify_password_rejects_malformed_hash() -> None:
    assert not verify_password("not-an-argon2-hash", "whatever")


def test_access_token_round_trip() -> None:
    user_id = uuid4()

    token = create_access_token(user_id, secret=SECRET, expires_minutes=5)

    assert decode_access_token(token, secret=SECRET) == user_id


def test_access_token_claims_and_algorithm() -> None:
    user_id = uuid4()
    now = datetime(2026, 1, 1, 9, 0, tzinfo=UTC)

    token = create_access_token(user_id, secret=SECRET, expires_minutes=60, now=now)

    assert jwt.get_unverified_header(token)["alg"] == "HS256"
    claims = jwt.decode(
        token, SECRET, algorithms=["HS256"], options={"verify_exp": False, "verify_iat": False}
    )
    assert claims == {
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=60)).timestamp()),
    }


def test_expired_token_is_rejected() -> None:
    issued = datetime.now(UTC) - timedelta(minutes=6)
    token = create_access_token(uuid4(), secret=SECRET, expires_minutes=5, now=issued)

    with pytest.raises(InvalidTokenError):
        decode_access_token(token, secret=SECRET)


def _claims(**overrides: object) -> dict[str, object]:
    now = datetime.now(UTC)
    claims: dict[str, object] = {
        "sub": str(uuid4()),
        "iat": now,
        "exp": now + timedelta(minutes=5),
    }
    claims.update(overrides)
    return {key: value for key, value in claims.items() if value is not None}


@pytest.mark.parametrize(
    "token",
    [
        pytest.param(jwt.encode(_claims(), "x" * 40, algorithm="HS256"), id="wrong-secret"),
        pytest.param(jwt.encode(_claims(), SECRET, algorithm="HS512"), id="disallowed-alg"),
        pytest.param(jwt.encode(_claims(), None, algorithm="none"), id="alg-none"),
        pytest.param(jwt.encode(_claims(sub=None), SECRET, algorithm="HS256"), id="no-sub"),
        pytest.param(jwt.encode(_claims(exp=None), SECRET, algorithm="HS256"), id="no-exp"),
        pytest.param(jwt.encode(_claims(iat=None), SECRET, algorithm="HS256"), id="no-iat"),
        pytest.param(jwt.encode(_claims(sub="42"), SECRET, algorithm="HS256"), id="non-uuid-sub"),
        pytest.param("not-a-jwt", id="garbage"),
        pytest.param("", id="empty"),
    ],
)
def test_invalid_tokens_are_rejected(token: str) -> None:
    with pytest.raises(InvalidTokenError):
        decode_access_token(token, secret=SECRET)
