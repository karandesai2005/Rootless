FROM golang:1.22-bookworm AS build

WORKDIR /src

COPY sandbox-go/main.go ./sandbox-go/main.go

RUN go build -o /out/sandbox ./sandbox-go/main.go

FROM debian:bookworm-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        bash \
        coreutils \
        firejail \
        gobuster \
        john \
        nmap \
        dirb \
        ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY --from=build /out/sandbox ./sandbox
COPY sandbox_profiles ./sandbox_profiles
COPY sandbox-go/sandbox_profiles ./sandbox_profiles

ENV SANDBOX_PROFILE_DIR=/app/sandbox_profiles

EXPOSE 9000

CMD ["./sandbox"]
