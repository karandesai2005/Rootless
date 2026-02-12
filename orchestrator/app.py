from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import httpx
import json
import uvicorn
import os
import tempfile
from typing import Optional, Tuple

from crypto_detector import detect_hash

app = FastAPI()

GO_SANDBOX_URL = "http://127.0.0.1:9000"
ROCKYOU_WORDLIST = "/usr/share/wordlists/rockyou.txt"

# -------------------- CORS --------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------- Load legacy tools.json --------------------

def load_tools():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(base_dir, "tools.json")
    with open(path) as f:
        return json.load(f)

TOOLS = load_tools()

def find_tool(tool_id: str):
    for category in TOOLS.values():
        for t in category:
            if t["id"] == tool_id:
                return t
    return None

def load_tool_definition(tool_id: str):
    base_dir = os.path.dirname(os.path.abspath(__file__))
    tool_path = os.path.join(base_dir, "..", "tools", f"{tool_id}.json")
    if not os.path.exists(tool_path):
        return None
    with open(tool_path) as f:
        return json.load(f)

# -------------------- Hash / John Helpers --------------------

def map_detected_to_john_format(detected_type: str) -> Optional[str]:
    mapping = {
        "MD5": "raw-md5",
        "SHA1": "raw-sha1",
        "SHA224": "raw-sha224",
        "SHA256": "raw-sha256",
        "SHA384": "raw-sha384",
        "SHA512": "raw-sha512",
        "bcrypt": "bcrypt",
        "Argon2": "argon2",
    }
    return mapping.get(detected_type)

def parse_sse_response(text: str) -> Tuple[str, int]:
    lines = []
    exit_code = 0
    for raw in text.splitlines():
        if not raw.startswith("data:"):
            continue
        value = raw[5:].strip()
        if not value or value in {"start", "DONE"}:
            continue
        if value.startswith("EXIT_CODE:"):
            try:
                exit_code = int(value.split(":", 1)[1].strip())
            except ValueError:
                exit_code = 1
            continue
        lines.append(value)
    return "\n".join(lines).strip(), exit_code

async def run_john_via_sandbox(cmd: list[str]) -> Tuple[str, int]:
    payload = {"cmd": cmd}
    async with httpx.AsyncClient(timeout=180) as client:
        response = await client.post(f"{GO_SANDBOX_URL}/run-john", json=payload)

    if response.status_code != 200:
        raise HTTPException(
            status_code=500,
            detail=f"sandbox-go error ({response.status_code}): {response.text}",
        )

    output, exit_code = parse_sse_response(response.text)
    return output, exit_code

def parse_john_show_output(show_output: str) -> str:
    if not show_output:
        return "No password cracked"

    for line in show_output.splitlines():
        l = line.strip()
        if not l:
            continue

        lower = l.lower()

        # Ignore sandbox noise
        if l.startswith("ERR:"):
            continue
        if "opal_ifinit" in lower or "ucx" in lower or "pmix" in lower:
            continue
        if "warn" in lower:
            continue
        if "using default input encoding" in lower:
            continue
        if "password hash" in lower:
            continue

        if ":" in l:
            return l

    if "0 password hashes cracked" in show_output.lower():
        return "No password cracked"

    return "No password cracked"

# -------------------- Stream Endpoint --------------------

@app.get("/stream")
async def stream(tool: str, target: str = "", scan: str = ""):
    tool_def = load_tool_definition(tool)

    if tool_def:
        if scan not in tool_def["scans"]:
            raise HTTPException(status_code=400, detail="Invalid scan type")

        scan_def = tool_def["scans"][scan]
        payload = {
            "tool": tool_def["id"],
            "binary": tool_def["binary"],
            "args": scan_def["args"],
            "target": target,
            "profile": tool_def["profile"],
        }
        go_url = f"{GO_SANDBOX_URL}/run-system"
    else:
        tool_info = find_tool(tool)
        if not tool_info:
            raise HTTPException(status_code=400, detail="Unknown tool")

        if tool_info["type"] == "wasm":
            go_url = f"{GO_SANDBOX_URL}/run-wasm"
            payload = {"module": tool_info["module"], "target": target}
        elif tool_info["type"] == "system":
            go_url = f"{GO_SANDBOX_URL}/run-system"
            cmd = tool_info["cmd"].replace("{TARGET}", target)
            payload = {"cmd": cmd}
        else:
            raise HTTPException(status_code=400, detail="Unsupported tool type")

    async def stream_gen():
        async with httpx.AsyncClient(timeout=None) as client:
            try:
                response = await client.post(go_url, json=payload, timeout=None)
                yield response.text
                yield "data: DONE\n\n"
            except Exception as e:
                yield f"data: ERROR: {str(e)}\n\n"

    return StreamingResponse(stream_gen(), media_type="text/event-stream")

# -------------------- Tools --------------------

@app.get("/tools")
def get_tools():
    return TOOLS

# -------------------- Crypto Detect --------------------

@app.post("/crypto/detect")
async def detect_crypto(request: Request):
    payload = await request.json()
    input_value = payload.get("input")

    if not isinstance(input_value, str) or not input_value.strip():
        raise HTTPException(status_code=400, detail="field 'input' must be non-empty string")

    detected_type, details = detect_hash(input_value)
    john_format = map_detected_to_john_format(detected_type)

    return {
        "input": input_value,
        "type": detected_type,
        "details": details,
        "john_format": john_format,
    }

# -------------------- Crypto Crack --------------------

@app.post("/crypto/crack")
async def crack_crypto(request: Request):
    payload = await request.json()
    input_value = payload.get("input")

    if not isinstance(input_value, str) or not input_value.strip():
        raise HTTPException(status_code=400, detail="field 'input' must be non-empty string")

    detected_type, _ = detect_hash(input_value)
    john_format = map_detected_to_john_format(detected_type)

    if not john_format:
        raise HTTPException(status_code=400, detail=f"Unsupported: {detected_type}")

    temp_path = ""
    pot_path = ""

    try:
        with tempfile.NamedTemporaryFile(mode="w", delete=False, dir="/tmp") as tf:
            temp_path = tf.name
            tf.write(input_value.strip() + "\n")

        pot_fd, pot_path = tempfile.mkstemp(dir="/tmp")
        os.close(pot_fd)

        run_cmd = [
            "--no-log",
            f"--format={john_format}",
            f"--wordlist={ROCKYOU_WORDLIST}",
            f"--pot={pot_path}",
            temp_path,
        ]
        await run_john_via_sandbox(run_cmd)

        show_cmd = ["--no-log", f"--pot={pot_path}", "--show", temp_path]
        show_output, _ = await run_john_via_sandbox(show_cmd)

        cracked_line = parse_john_show_output(show_output)

        password = None
        cracked_flag = False

        if ":" in cracked_line and cracked_line != "No password cracked":
            password = cracked_line.split(":", 1)[1].strip()
            cracked_flag = True

        return {
            "detected": detected_type,
            "result": cracked_line,
            "cracked": cracked_flag,
            "password": password,
        }

    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
        if pot_path and os.path.exists(pot_path):
            os.remove(pot_path)

# -------------------- Run --------------------

if __name__ == "__main__":
    print("Python orchestrator starting on http://127.0.0.1:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000)