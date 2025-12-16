from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import httpx
import json
import uvicorn
import os

app = FastAPI()

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

# -------------------- Stream Endpoint --------------------

@app.get("/stream")
async def stream(tool: str, target: str = "", scan: str = ""):
    """
    Examples:
      /stream?tool=nmap&target=127.0.0.1&scan=service
      /stream?tool=gobuster&target=https://example.com
    """

    # 🔥 NEW FLOW: tool-specific abstraction (Nmap)
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
            "profile": tool_def["profile"],  # ✅ single safe profile
        }

        go_url = "http://127.0.0.1:9000/run-system"

    else:
        # 🧓 LEGACY FLOW (tools.json)
        tool_info = find_tool(tool)
        if not tool_info:
            raise HTTPException(status_code=400, detail="Unknown tool")

        if tool_info["type"] == "wasm":
            go_url = "http://127.0.0.1:9000/run-wasm"
            payload = {
                "module": tool_info["module"],
                "target": target,
            }

        elif tool_info["type"] == "system":
            go_url = "http://127.0.0.1:9000/run-system"
            cmd = tool_info["cmd"].replace("{TARGET}", target)
            payload = {
                "cmd": cmd
            }

        else:
            raise HTTPException(status_code=400, detail="Unsupported tool type")

    # -------------------- Stream to Go Sandbox --------------------

    async def stream_gen():
        async with httpx.AsyncClient(timeout=None) as client:
            try:
                body = json.dumps(payload).encode("utf-8")

                print(f"🐍 PYTHON → GO: {payload}")

                request = client.build_request(
                    "POST",
                    go_url,
                    content=body,
                    headers={
                        "Content-Type": "application/json",
                        "Content-Length": str(len(body)),
                    }
                )

                response = await client.send(request, stream=True)

                async for chunk in response.aiter_text():
                    if chunk.strip():
                        yield chunk

                await response.aclose()
                yield "data: DONE\n\n"

            except Exception as e:
                print("🐍 ERROR:", e)
                yield f"data: ERROR: {str(e)}\n\n"

    return StreamingResponse(stream_gen(), media_type="text/event-stream")

# -------------------- Tools List --------------------

@app.get("/tools")
def get_tools():
    """
    Used by Electron sidebar.
    Still returns tools.json for grouping.
    """
    return TOOLS

# -------------------- Run --------------------

if __name__ == "__main__":
    print("🚀 Python orchestrator starting on http://127.0.0.1:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000)
