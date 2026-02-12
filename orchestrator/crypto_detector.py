import base64
import binascii
import math
import re
from collections import Counter
from typing import Dict, Tuple

from flask import Flask, jsonify, request

app = Flask(__name__)

HEX_RE = re.compile(r"^[0-9a-fA-F]+$")
BCRYPT_RE = re.compile(r"^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$")
ARGON2_RE = re.compile(r"^\$argon2(?:id|i|d)\$v=\d+\$[^\s]+\$[^\s]+\$[^\s]+$")
JWT_SEGMENT_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def is_hex(value: str) -> bool:
    if not value or len(value) % 2 != 0:
        return False
    return HEX_RE.fullmatch(value) is not None


def compute_entropy(value: str) -> float:
    if not value:
        return 0.0
    counts = Counter(value)
    length = len(value)
    entropy = 0.0
    for count in counts.values():
        p = count / length
        entropy -= p * math.log2(p)
    return entropy


def _add_base64_padding(value: str) -> str:
    missing = len(value) % 4
    if missing:
        value += "=" * (4 - missing)
    return value


def is_base64(value: str) -> Tuple[bool, str]:
    if not value or len(value) < 8:
        return False, ""

    candidate = value.strip()
    candidate_padded = _add_base64_padding(candidate)

    try:
        decoded = base64.b64decode(candidate_padded, validate=True)
        if len(decoded) == 0:
            return False, ""
        return True, f"decoded_len={len(decoded)}"
    except (binascii.Error, ValueError):
        return False, ""


def is_jwt(value: str) -> Tuple[bool, str]:
    parts = value.split(".")
    if len(parts) != 3:
        return False, ""

    if not all(parts) or not all(JWT_SEGMENT_RE.fullmatch(p) for p in parts):
        return False, ""

    try:
        header_raw = base64.urlsafe_b64decode(_add_base64_padding(parts[0]))
        payload_raw = base64.urlsafe_b64decode(_add_base64_padding(parts[1]))
        header_text = header_raw.decode("utf-8", errors="strict")
        payload_text = payload_raw.decode("utf-8", errors="strict")

        if "{" in header_text and "alg" in header_text and "{" in payload_text:
            return True, "valid JWT-like structure"
    except Exception:
        return False, ""

    return False, ""


def detect_hash(value: str) -> Tuple[str, str]:
    raw = value.strip()

    if not raw:
        return "Unknown", "empty input"

    if BCRYPT_RE.fullmatch(raw):
        return "bcrypt", "modular crypt format"

    if ARGON2_RE.fullmatch(raw):
        return "Argon2", "modular crypt format"

    if is_hex(raw):
        length = len(raw)
        mapping: Dict[int, str] = {
            32: "MD5",
            40: "SHA1",
            56: "SHA224",
            64: "SHA256",
            96: "SHA384",
            128: "SHA512",
        }
        if length in mapping:
            return mapping[length], "hex digest length match"
        return "Hex", f"hex string length={length}"

    jwt_ok, jwt_details = is_jwt(raw)
    if jwt_ok:
        return "JWT", jwt_details

    b64_ok, b64_details = is_base64(raw)
    if b64_ok:
        return "Base64", b64_details

    entropy = compute_entropy(raw)
    if entropy >= 4.0 and len(raw) >= 16:
        return "Unknown", f"high entropy ({entropy:.2f} bits/char), likely random"

    return "Unknown", f"unrecognized pattern, entropy={entropy:.2f} bits/char"


@app.post("/crypto/detect")
def detect_crypto():
    try:
        if not request.is_json:
            return (
                jsonify(
                    {
                        "input": "",
                        "type": "Unknown",
                        "details": "request must be JSON",
                    }
                ),
                400,
            )

        payload = request.get_json(silent=True) or {}
        input_value = payload.get("input")

        if not isinstance(input_value, str):
            return (
                jsonify(
                    {
                        "input": "",
                        "type": "Unknown",
                        "details": "field 'input' must be a string",
                    }
                ),
                400,
            )

        detected_type, details = detect_hash(input_value)
        return jsonify({"input": input_value, "type": detected_type, "details": details})

    except Exception as exc:
        return (
            jsonify(
                {
                    "input": "",
                    "type": "Unknown",
                    "details": f"internal error: {str(exc)}",
                }
            ),
            500,
        )


@app.get("/health")
def health_check():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
