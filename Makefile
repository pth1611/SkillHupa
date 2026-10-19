# Lệnh dùng chung cho máy cá nhân và CI. Chạy `make help` để xem danh sách.
BACKEND := backend
VENV    := $(BACKEND)/.venv
PY      := $(VENV)/bin/python

.DEFAULT_GOAL := help

.PHONY: help
help: ## Hiện danh sách lệnh
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-18s %s\n", $$1, $$2}'

# ---- Backend (chạy trực tiếp, không Docker) -------------------------------

$(PY):
	python3 -m venv $(VENV)
	$(PY) -m pip install --upgrade pip
	$(PY) -m pip install -r $(BACKEND)/requirements-dev.txt

.PHONY: install
install: $(PY) ## Tạo venv và cài thư viện backend

.PHONY: dev
dev: $(PY) ## Chạy API với tự nạp lại (cần .env và PostgreSQL, xem `make db`)
	cd $(BACKEND) && .venv/bin/python -m uvicorn app.main:app --reload --port 8000

.PHONY: test
test: $(PY) ## Chạy test backend (dùng SQLite, không cần PostgreSQL)
	cd $(BACKEND) && .venv/bin/python -m pytest -q

.PHONY: lint
lint: $(PY) ## Kiểm tra ruff
	cd $(BACKEND) && .venv/bin/ruff check . --exclude .venv

.PHONY: fix
fix: $(PY) ## Ruff tự sửa lỗi sửa được
	cd $(BACKEND) && .venv/bin/ruff check . --exclude .venv --fix

.PHONY: migrate
migrate: $(PY) ## Áp dụng migration lên cơ sở dữ liệu trong .env
	cd $(BACKEND) && .venv/bin/alembic upgrade head

.PHONY: migration
migration: $(PY) ## Sinh migration từ model: make migration m="mo ta"
	@test -n "$(m)" || (echo 'Dùng: make migration m="mô tả"'; exit 1)
	cd $(BACKEND) && .venv/bin/alembic revision --autogenerate -m "$(m)"

.PHONY: classify-backfill
classify-backfill: $(PY) ## Gợi ý phân loại cho skill cũ: make classify-backfill [args="--dry-run --refresh"]
	cd $(BACKEND) && .venv/bin/python -m app.jobs.backfill_classification $(args)

.PHONY: job
job: $(PY) ## Chạy tác vụ định kỳ một lần (nhắc việc, tự chia việc, quét nguồn)
	cd $(BACKEND) && .venv/bin/python -m app.jobs.scheduled

.PHONY: env
env: ## Tạo .env từ .env.example, tự sinh SESSION_SECRET (không ghi đè nếu .env đã có)
	@if [ -f .env ]; then echo ".env đã có, giữ nguyên"; else \
	  cp .env.example .env && \
	  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')|" .env && \
	  echo "Đã tạo .env"; fi

.PHONY: secret
secret: ## In một SESSION_SECRET ngẫu nhiên
	@python3 -c "import secrets; print(secrets.token_urlsafe(48))"

# ---- Frontend ---------------------------------------------------------------

FRONTEND := frontend

.PHONY: fe-install
fe-install: ## Cài thư viện frontend (cần Node.js 20+)
	cd $(FRONTEND) && npm ci

.PHONY: fe-dev
fe-dev: ## Chạy Vite tại http://localhost:5173, proxy /api về cổng 8000
	cd $(FRONTEND) && npm run dev

.PHONY: fe-check
fe-check: ## Typecheck + lint + test + kiểm tra i18n + build frontend
	cd $(FRONTEND) && npm run typecheck && npm run lint && npm test && npm run i18n:check && npm run build

# ---- CLI ------------------------------------------------------------------------

.PHONY: cli-check
cli-check: ## Typecheck + lint + test + build CLI (cần Node.js 20+)
	cd cli && npm ci && npm run typecheck && npm run lint && npm test && npm run build

# ---- Docker -------------------------------------------------------------

.PHONY: db
db: ## Chỉ chạy PostgreSQL (cổng 5432) cho `make dev`
	docker compose up -d db

.PHONY: up
up: ## Chạy PostgreSQL + migration + backend bằng Docker
	docker compose up --build -d

.PHONY: down
down: ## Dừng các container (giữ dữ liệu)
	docker compose down

.PHONY: reset
reset: ## Dừng và XOÁ dữ liệu cục bộ (DB và gói đã tải lên)
	docker compose down -v

.PHONY: logs
logs: ## Xem log backend
	docker compose logs -f backend

.PHONY: build
build: ## Build image backend
	docker build -t skillmkt-backend:local $(BACKEND)

.PHONY: check
check: lint test ## Lint + test backend (giống CI)
