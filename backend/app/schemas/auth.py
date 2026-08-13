from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MeResponse(BaseModel):
    email: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    # max_length is CHARS, not bytes — UX guard only; the endpoint's ValueError catch is
    # the authoritative bcrypt 72-BYTE enforcement (e.g. 40 accented chars = 80 bytes).
    new_password: str = Field(min_length=8, max_length=72)
