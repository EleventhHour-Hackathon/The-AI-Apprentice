# The hosted Tacit backend (Render: see render.yaml and docs/DEPLOY.md).
#   docker build -t tacit-backend core/backend
#   docker run -p 8000:8000 --env-file core/backend/.env tacit-backend

# Python 3.12, as in the local .venv; uv.lock pins the packages.
FROM python:3.12-slim AS build

COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /usr/local/bin/uv
# Compilers only for a package without a wheel; they stay in this stage.
RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
  && rm -rf /var/lib/apt/lists/*

ENV UV_COMPILE_BYTECODE=1 \
  UV_LINK_MODE=copy \
  UV_PYTHON_DOWNLOADS=never

WORKDIR /app
COPY pyproject.toml uv.lock ./
# The privacy extra brings Presidio and the small English spaCy model, so names get redacted.
RUN uv sync --frozen --no-dev --extra privacy --no-install-project


FROM python:3.12-slim

# ffmpeg cuts the expert's recording into clips (src/services/recordings.py).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 1000 tacit

ENV PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1 \
  PATH="/app/.venv/bin:$PATH" \
  ENV=production \
  PORT=8000

WORKDIR /app
COPY --from=build /app/.venv /app/.venv
COPY main.py ./
COPY src/ ./src/
COPY storage/ ./storage/
# uploads/ holds recordings and clips until they reach Supabase Storage (container disk only).
RUN mkdir -p uploads && chown -R tacit:tacit /app
USER tacit

EXPOSE 8000

# Render sets $PORT. No reload; proxy headers because Render terminates HTTPS in front.
# No access log: clip URLs carry the access key as ?key= (src/core/access.py).
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips '*' --no-access-log"]
