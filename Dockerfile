# syntax=docker/dockerfile:1

# =====================================================================
# Stage 1: build the React UI.
# Node.js is needed only to BUILD the UI, not to run the app.
# =====================================================================
FROM node:26-slim AS frontend-build

WORKDIR /build/frontend

# Copy only the dependency lists first, so Docker can cache the slow
# `npm ci` step and reuse it until a dependency actually changes.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# Now copy the UI source code and build the production files into dist/.
COPY frontend/ ./
RUN npm run build

# =====================================================================
# Stage 2: install the Python libraries into a virtual environment.
# uv (the package manager) is needed only here, not in the final image.
# =====================================================================
FROM python:3.12-slim AS backend-build

# The uv tool, copied from its official image (version pinned).
COPY --from=ghcr.io/astral-sh/uv:0.8.0 /uv /usr/local/bin/uv

WORKDIR /app/backend

# UV_LINK_MODE=copy        -> real files, because the venv is copied to another stage
# UV_COMPILE_BYTECODE=1    -> precompile Python files, so the app starts faster
# UV_PYTHON_DOWNLOADS=never -> use this image's Python 3.12, never download another
ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never

# Copy only the dependency lists, so this slow step is cached (same trick as npm ci).
COPY backend/pyproject.toml backend/uv.lock backend/.python-version ./

# Install the exact locked versions, without the dev/test tools.
RUN uv sync --locked --no-dev

# =====================================================================
# Stage 3: the final image that runs in dev and prod.
# Only runtime pieces: Python + libraries + backend code + built UI.
# =====================================================================
FROM python:3.12-slim AS runtime

# Metadata: links the image to its source code on GitHub.
LABEL org.opencontainers.image.title="taskboard" \
      org.opencontainers.image.source="https://github.com/SaurabhDesai20/taskboard"

# PYTHONDONTWRITEBYTECODE=1 -> do not write .pyc files at runtime (code is read-only)
# PYTHONUNBUFFERED=1        -> print logs immediately, so `docker logs` shows them live
# PATH                      -> use the libraries installed in Stage 2
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/backend/.venv/bin:${PATH}"

# A normal, non-root user (fixed ID 10001) to run the app.
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app

WORKDIR /app/backend

# Libraries from Stage 2, built UI from Stage 1, then migrations and code.
# Code is copied last because it changes most often (layer caching).
COPY --from=backend-build /app/backend/.venv /app/backend/.venv
COPY --from=frontend-build /build/frontend/dist /app/frontend/dist
COPY backend/alembic.ini ./alembic.ini
COPY backend/alembic ./alembic
COPY backend/app ./app

# From here on, everything runs as the non-root user.
USER 10001:10001

EXPOSE 8000

# Every 30s Docker asks the app "are you OK?"; 3 failures in a row = "unhealthy".
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"]

# Start the web server. Exec form (JSON list): uvicorn receives stop signals directly.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]