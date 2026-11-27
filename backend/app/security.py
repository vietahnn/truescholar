"""Vùng kín AES-256-GCM tương thích byte-for-byte với định dạng hex `iv.tag.ciphertext`."""

import os
import re

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import get_settings

_HEX_64_RE = re.compile(r"^[0-9a-fA-F]{64}$")


def _resolve_key(key_hex: str | None = None) -> bytes:
    raw = key_hex if key_hex is not None else get_settings().sealed_key
    if not raw or raw == "changeme" or not _HEX_64_RE.fullmatch(raw):
        raise ValueError("SEALED_KEY chưa cấu hình hợp lệ (cần đúng 64 ký tự hex).")
    return bytes.fromhex(raw)


def encrypt_sealed(plaintext: str, key_hex: str | None = None) -> str:
    key = _resolve_key(key_hex)
    iv = os.urandom(12)
    ct_and_tag = AESGCM(key).encrypt(iv, plaintext.encode("utf-8"), None)
    ct, tag = ct_and_tag[:-16], ct_and_tag[-16:]
    return f"{iv.hex()}.{tag.hex()}.{ct.hex()}"


def decrypt_sealed(payload: str, key_hex: str | None = None) -> str:
    parts = payload.split(".")
    if len(parts) != 3:
        raise ValueError("Định dạng dữ liệu mã hóa không hợp lệ.")
    iv_hex, tag_hex, enc_hex = parts
    if len(iv_hex) != 24 or len(tag_hex) != 32 or not enc_hex:
        raise ValueError("Dữ liệu mã hóa không đúng độ dài IV/AuthTag.")
    key = _resolve_key(key_hex)
    try:
        iv = bytes.fromhex(iv_hex)
        ct_and_tag = bytes.fromhex(enc_hex) + bytes.fromhex(tag_hex)
        plain = AESGCM(key).decrypt(iv, ct_and_tag, None)
    except Exception as exc:
        raise ValueError("Giải mã vùng kín thất bại.") from exc
    return plain.decode("utf-8")
