from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import httpx
import uvicorn

app = FastAPI()

# CORS for Electron EventSource
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ALLOWED = {"dummy-wasm"}
GO_URL = "http://127.0.0.1:9000/exec"

@app.get("/stream")
async def stream(tool: str, target: str):
    print("🔥 Python: /stream called", tool, target)

    if tool not in ALLOWED:
        raise HTTPException(status_code=400, detail="tool not allowed")

    # ✅ FIX: Create client outside, keep it alive during streaming
    client = httpx.AsyncClient(timeout=None)
    
    async def event_generator():
        try:
            print("🔥 Python: GET -> Go sandbox with query params")
            # ✅ Open stream inside generator so it stays alive
            async with client.stream(
                "GET",
                GO_URL,
                params={"tool": tool, "target": target}
            ) as resp:
                print("🔥 Python: Go status =", resp.status_code)
                
                if resp.status_code != 200:
                    error_text = await resp.aread()
                    print(f"❌ Python: Go returned {resp.status_code}: {error_text}")
                    yield f"data: Error from Go: {error_text}\n\n"
                    return

                async for chunk in resp.aiter_text():
                    if chunk.strip():  # Only forward non-empty chunks
                        print("🔥 Python FORWARDED:", chunk.strip())
                        yield chunk
                        
                print("✅ Python: Stream completed successfully")
                
        except httpx.ConnectError as e:
            print(f"❌ Python: Cannot connect to Go: {e}")
            yield "data: [ERROR] Cannot connect to Go sandbox\n\n"
        except Exception as e:
            print(f"⚠️ Python: Stream error: {e}")
            yield "data: [ERROR] Stream closed unexpectedly\n\n"
        finally:
            # ✅ Clean up client after streaming completes
            await client.aclose()
            print("🔥 Python: Client closed")

    return StreamingResponse(
        event_generator(), 
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive"
        }
    )


if __name__ == "__main__":
    print("🚀 Python orchestrator starting on http://127.0.0.1:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000)