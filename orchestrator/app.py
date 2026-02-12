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


# -------------------- Load legacy tools.json (UI listing) --------------------

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


# -------------------- Load new tool definition (tools/*.json) --------------------

def load_tool_definition(tool_id: str):
    """
    Loads tool-specific definition like tools/nmap.json
    """
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
        return "No result returned by john --show"

    for line in show_output.splitlines():
        line = line.strip()
        if not line:
            continue
        if "password hash" in line.lower() or "password hashes" in line.lower():
            continue
        if line.startswith("ERR:"):
            continue
        return line

    lowered = show_output.lower()
    if "0 password hashes cracked" in lowered:
        return "No password cracked"

    return show_output


# -------------------- Stream Endpoint --------------------

@app.get("/stream")
async def stream(tool: str, target: str = "", scan: str = ""):
    """
    Examples:
      /stream?tool=nmap&target=127.0.0.1&scan=service
      /stream?tool=gobuster&target=https://example.com
    """

    # New flow: tool-specific abstraction
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
        # Legacy flow (tools.json)
        tool_info = find_tool(tool)
        if not tool_info:
            raise HTTPException(status_code=400, detail="Unknown tool")

        if tool_info["type"] == "wasm":
            go_url = f"{GO_SANDBOX_URL}/run-wasm"
            payload = {
                "module": tool_info["module"],
                "target": target,
            }

        elif tool_info["type"] == "system":
            go_url = f"{GO_SANDBOX_URL}/run-system"
            cmd = tool_info["cmd"].replace("{TARGET}", target)
            payload = {
                "cmd": cmd
            }

        else:
            raise HTTPException(status_code=400, detail="Unsupported tool type")

    async def stream_gen():
        async with httpx.AsyncClient(timeout=None) as client:
            try:
                body = json.dumps(payload).encode("utf-8")

                request_obj = client.build_request(
                    "POST",
                    go_url,
                    content=body,
                    headers={
                        "Content-Type": "application/json",
                        "Content-Length": str(len(body)),
                    }
                )

                response = await client.send(request_obj, stream=True)

                async for chunk in response.aiter_text():
                    if chunk.strip():
                        yield chunk

                await response.aclose()
                yield "data: DONE\n\n"

            except Exception as e:
                yield f"data: ERROR: {str(e)}\n\n"

    return StreamingResponse(stream_gen(), media_type="text/event-stream")


# -------------------- Tools List --------------------

@app.get("/tools")
def get_tools():
    return TOOLS


# -------------------- Crypto Detect --------------------

@app.post("/crypto/detect")
async def detect_crypto(request: Request):
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    input_value = payload.get("input") if isinstance(payload, dict) else None
    if not isinstance(input_value, str) or not input_value.strip():
        raise HTTPException(status_code=400, detail="field 'input' must be a non-empty string")

    detected_type, details = detect_hash(input_value)
    return {"input": input_value, "type": detected_type, "details": details}


# -------------------- Crypto Crack (John) --------------------

@app.post("/crypto/crack")
async def crack_crypto(request: Request):
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    input_value = payload.get("input") if isinstance(payload, dict) else None
    if not isinstance(input_value, str) or not input_value.strip():
        raise HTTPException(status_code=400, detail="field 'input' must be a non-empty string")

    detected_type, _ = detect_hash(input_value)
    john_format = map_detected_to_john_format(detected_type)

    if not john_format:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported hash type for john cracking: {detected_type}",
        )

    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile(mode="w", delete=False, dir="/tmp", prefix="rootless-hash-") as tf:
            temp_path = tf.name
            tf.write(input_value.strip() + "\n")

        run_cmd = [
            f"--format={john_format}",
            f"--wordlist={ROCKYOU_WORDLIST}",
            temp_path,
        ]
        run_output, run_exit = await run_john_via_sandbox(run_cmd)

        show_cmd = ["--show", temp_path]
        show_output, show_exit = await run_john_via_sandbox(show_cmd)

        if run_exit != 0 and show_exit != 0:
            return {
                "detected": detected_type,
                "result": f"john failed\n{run_output or show_output}".strip(),
            }

        cracked = parse_john_show_output(show_output)
        return {
            "detected": detected_type,
            "result": cracked,
        }

    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


# -------------------- Run --------------------

if __name__ == "__main__":
    print("Python orchestrator starting on http://127.0.0.1:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000)
