from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import httpx
import json
import uvicorn
import os
import uuid
from copy import deepcopy
from typing import Optional, Tuple

from crypto_detector import detect_hash

app = FastAPI()

GO_SANDBOX_URL = os.getenv("GO_SANDBOX_URL", "http://127.0.0.1:9000")
DEFAULT_WORDLIST_PATH = "/usr/share/wordlists/rockyou.txt"

def resolve_wordlist_path() -> Optional[str]:
    candidates = [
        os.getenv("ROCKYOU_WORDLIST"),
        DEFAULT_WORDLIST_PATH,
    ]

    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate

    return None


ROCKYOU_WORDLIST = resolve_wordlist_path()

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


def tool_definition_dirs() -> list[str]:
    base_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.getenv("TOOL_DEFINITION_DIR"),
        os.path.join(base_dir, "..", "tools"),
        os.path.join(base_dir, "tools"),
    ]

    existing = []
    for candidate in candidates:
        if candidate and os.path.isdir(candidate):
            normalized = os.path.abspath(candidate)
            if normalized not in existing:
                existing.append(normalized)

    return existing


def load_tool_definitions():
    definitions = {}

    for tool_dir in tool_definition_dirs():
        for entry in os.listdir(tool_dir):
            if not entry.endswith(".json"):
                continue

            path = os.path.join(tool_dir, entry)
            try:
                with open(path) as f:
                    raw = f.read().strip()
                if not raw:
                    continue
                data = json.loads(raw)
            except (OSError, json.JSONDecodeError):
                continue

            tool_id = data.get("id")
            if tool_id:
                definitions[tool_id] = data

    return definitions


FILE_TOOL_DEFS = load_tool_definitions()

def find_tool(tool_id: str):
    for category in TOOLS.values():
        for t in category:
            if t["id"] == tool_id:
                return t
    return None

def load_tool_definition(tool_id: str):
    return FILE_TOOL_DEFS.get(tool_id)


def build_catalog():
    catalog = deepcopy(TOOLS)

    for category, items in list(catalog.items()):
        catalog[category] = [item for item in items if item.get("type") != "wasm"]

    for tool_def in FILE_TOOL_DEFS.values():
        scans = []
        for scan_id, scan_def in tool_def.get("scans", {}).items():
            scans.append({
                "id": scan_id,
                "label": scan_def.get("label", scan_id.replace("-", " ").title()),
            })

        catalog_entry = {
            "id": tool_def["id"],
            "name": tool_def.get("name", tool_def["id"]),
            "type": tool_def.get("type", "system"),
            "description": tool_def.get("description", f"{tool_def.get('name', tool_def['id'])} presets"),
            "params": [
                {
                    "key": "target",
                    "label": "Target",
                    "type": "text",
                    "required": True,
                }
            ],
            "scans": scans,
            "default_scan": scans[0]["id"] if scans else "",
        }

        placed = False
        for category, items in catalog.items():
            for index, item in enumerate(items):
                if item["id"] == catalog_entry["id"]:
                    items[index] = catalog_entry
                    placed = True
                    break
            if placed:
                break

        if not placed:
            catalog.setdefault("network", []).append(catalog_entry)

    return catalog


CATALOG = build_catalog()

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

async def run_john_via_sandbox(
    cmd: list[str],
    files: Optional[list[dict[str, str]]] = None,
    cleanup: Optional[list[str]] = None,
) -> Tuple[str, int]:
    payload = {"cmd": cmd}
    if files:
        payload["files"] = files
    if cleanup:
        payload["cleanup"] = cleanup

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


def required_param_keys(tool_info: dict) -> list[str]:
    keys = []
    for param in tool_info.get("params", []):
        if param.get("required"):
            keys.append(param["key"])
    return keys


def resolve_query_params(request: Request, target: str, scan: str) -> dict[str, str]:
    params = dict(request.query_params)
    params.pop("tool", None)

    if target and "target" not in params:
        params["target"] = target

    if scan and "scan" not in params:
        params["scan"] = scan

    return params


def substitute_placeholders(command: str, params: dict[str, str]) -> str:
    resolved = command

    for key, value in params.items():
        resolved = resolved.replace(f"{{{key}}}", value)
        resolved = resolved.replace(f"{{{key.upper()}}}", value)

    return resolved

# -------------------- Stream Endpoint --------------------

@app.get("/stream")
async def stream(request: Request, tool: str, target: str = "", scan: str = ""):
    tool_def = load_tool_definition(tool)
    params = resolve_query_params(request, target, scan)

    if tool_def:
        available_scans = tool_def.get("scans", {})
        selected_scan = params.get("scan") or next(iter(available_scans.keys()), "")

        if selected_scan not in available_scans:
            raise HTTPException(status_code=400, detail="Invalid scan type")

        target_value = params.get("target") or params.get("TARGET", "")
        if not target_value:
            raise HTTPException(status_code=400, detail="Missing required parameter: target")

        scan_def = available_scans[selected_scan]
        payload = {
            "tool": tool_def["id"],
            "binary": tool_def["binary"],
            "args": scan_def["args"],
            "target": target_value,
            "profile": tool_def["profile"],
        }
        go_url = f"{GO_SANDBOX_URL}/run-system"
    else:
        tool_info = find_tool(tool)
        if not tool_info:
            raise HTTPException(status_code=400, detail="Unknown tool")

        if tool_info["type"] == "wasm":
            raise HTTPException(status_code=400, detail="WASM tools are not enabled in this build")
        elif tool_info["type"] == "system":
            missing = [
                key for key in required_param_keys(tool_info)
                if not params.get(key) and not params.get(key.lower())
            ]
            if missing:
                raise HTTPException(
                    status_code=400,
                    detail=f"Missing required parameter: {missing[0]}",
                )

            go_url = f"{GO_SANDBOX_URL}/run-system"
            cmd = substitute_placeholders(tool_info["cmd"], params)
            payload = {"cmd": cmd}
        else:
            raise HTTPException(status_code=400, detail="Unsupported tool type")

    async def stream_gen():
        async with httpx.AsyncClient(timeout=None) as client:
            try:
                async with client.stream("POST", go_url, json=payload, timeout=None) as response:
                    if response.status_code != 200:
                        error_text = (await response.aread()).decode(errors="replace")
                        yield f"data: ERROR: sandbox-go error ({response.status_code}): {error_text}\n\n"
                        yield "data: EXIT_CODE: 1\n\n"
                        yield "data: DONE\n\n"
                        return

                    async for chunk in response.aiter_text():
                        if chunk:
                            yield chunk
            except Exception as e:
                yield f"data: ERROR: {str(e)}\n\n"
                yield "data: EXIT_CODE: 1\n\n"
                yield "data: DONE\n\n"

    return StreamingResponse(stream_gen(), media_type="text/event-stream")

# -------------------- Tools --------------------

@app.get("/tools")
def get_tools():
    return CATALOG

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

    if not ROCKYOU_WORDLIST:
        raise HTTPException(
            status_code=503,
            detail=(
                "rockyou wordlist not configured; set ROCKYOU_WORDLIST "
                f"or mount {DEFAULT_WORDLIST_PATH}"
            ),
        )

    request_id = uuid.uuid4().hex
    temp_path = f"/tmp/rootless-hash-{request_id}.txt"
    pot_path = f"/tmp/rootless-pot-{request_id}.pot"
    hash_file = {"path": temp_path, "content": input_value.strip() + "\n"}

    run_cmd = [
        "--no-log",
        f"--format={john_format}",
        f"--wordlist={ROCKYOU_WORDLIST}",
        f"--pot={pot_path}",
        temp_path,
    ]
    await run_john_via_sandbox(run_cmd, files=[hash_file])

    show_cmd = ["--no-log", f"--pot={pot_path}", "--show", temp_path]
    show_output, _ = await run_john_via_sandbox(
        show_cmd,
        files=[hash_file],
        cleanup=[pot_path],
    )

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

# -------------------- Run --------------------

if __name__ == "__main__":
    print("Python orchestrator starting on http://127.0.0.1:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000)
