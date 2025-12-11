from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import httpx
import json
import uvicorn

app = FastAPI()

# Enable CORS because Electron needs it
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load tools.json
def load_tools():
    with open("tools.json") as f:
        return json.load(f)

TOOLS = load_tools()

def find_tool(tool_id: str):
    for category in TOOLS.values():
        for t in category:
            if t["id"] == tool_id:
                return t
    return None


# ★★★★★ THE HEART OF ROUTING ★★★★★
@app.get("/stream")
async def stream(tool: str, target: str):

    tool_info = find_tool(tool)
    if not tool_info:
        raise HTTPException(400, "Unknown tool")

    # WASM tool
    if tool_info["type"] == "wasm":
        go_url = "http://127.0.0.1:9000/run-wasm"
        payload = {"module": tool_info["module"], "target": target}

    # System tool
    elif tool_info["type"] == "system":
        go_url = "http://127.0.0.1:9000/run-system"
        cmd = tool_info["cmd"].replace("{TARGET}", target)
        payload = {"cmd": cmd}

    else:
        raise HTTPException(400, "Unsupported tool type")


    # ★ STREAM PROXY TO GO SANDBOX ★
    async def stream_gen():
        async with httpx.AsyncClient(timeout=None) as client:
            try:
                async with client.stream("POST", go_url, json=payload) as resp:

                    async for chunk in resp.aiter_text():
                        if chunk.strip():
                            yield f"{chunk}"

                yield "data: DONE\n\n"

            except Exception as e:
                yield f"data: ERROR: {str(e)}\n\n"


    return StreamingResponse(stream_gen(), media_type="text/event-stream")


@app.get("/tools")
def get_tools():
    return TOOLS


if __name__ == "__main__":
    print("🚀 Python orchestrator starting on http://127.0.0.1:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000)
