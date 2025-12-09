from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

app = FastAPI()

ALLOWED = {"dummy-wasm"}  # whitelist so nothing dangerous runs

class Req(BaseModel):
    tool: str
    target: str

@app.post("/run")
async def run(req: Req):
    if req.tool not in ALLOWED:
        raise HTTPException(status_code=400, detail="tool not allowed")

    # This is temporary until sandbox exists
    output = {
        "tool": req.tool,
        "target": req.target,
        "result": f"Simulated execution of {req.tool} on {req.target}",
    }

    return output


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
'''
FastAPI = framework for HTTP APIs
 Pydantic = validates request data
 Uvicorn = lightweight server (very fast)
'''