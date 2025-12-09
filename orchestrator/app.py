from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import httpx
import uvicorn

app = FastAPI()

ALLOWED = {"dummy-wasm"}   # remove this later when adding more tools
GO_URL = "http://127.0.0.1:9000/exec"

class Req(BaseModel):
    tool: str
    target: str

@app.post("/run")
async def run(req: Req):
    if req.tool not in ALLOWED:
        raise HTTPException(status_code=400, detail="tool not allowed")

    async with httpx.AsyncClient() as client:
        go_response = await client.post(GO_URL, json={
            "tool": req.tool,
            "target": req.target,
        })

    return go_response.json()

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
