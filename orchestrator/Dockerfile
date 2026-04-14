FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        john \
        curl \
        ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY orchestrator/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY orchestrator/. ./
COPY tools ./tools

ENV TOOL_DEFINITION_DIR=/app/tools

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
