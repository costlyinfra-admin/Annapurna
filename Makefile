# Annapurna — root orchestration.
# One entry point for installing, testing, and linting both packages.
# Backend = Python (backend/), Web = React+TypeScript (web/).

BACKEND := backend
WEB := web
VENV := $(BACKEND)/.venv
PY := $(VENV)/bin/python
PIP := $(VENV)/bin/pip

.PHONY: help install install-backend install-web test test-backend test-web \
        lint lint-backend lint-web format db-migrate db-seed clean

help:
	@echo "Annapurna make targets:"
	@echo "  make install     - install backend (venv) + web (npm) dependencies"
	@echo "  make test        - run backend + web test suites"
	@echo "  make lint        - lint backend (ruff) + web (eslint)"
	@echo "  make format      - auto-format backend (ruff) + web (prettier)"
	@echo "  make db-migrate  - apply DB migrations (needs DATABASE_URL + Postgres)"
	@echo "  make db-seed     - apply migrations and seed one demo tenant"
	@echo "  make clean       - remove virtualenv, node_modules, build caches"

# ---- install -------------------------------------------------------------
install: install-backend install-web

install-backend:
	python3 -m venv $(VENV)
	$(PIP) install --upgrade pip
	$(PIP) install -e "$(BACKEND)[dev]"

install-web:
	cd $(WEB) && npm install

# ---- test ----------------------------------------------------------------
test: test-backend test-web

test-backend:
	cd $(BACKEND) && .venv/bin/pytest

test-web:
	cd $(WEB) && npm test

# ---- lint ----------------------------------------------------------------
lint: lint-backend lint-web

lint-backend:
	cd $(BACKEND) && .venv/bin/ruff check .

lint-web:
	cd $(WEB) && npm run lint

# ---- format --------------------------------------------------------------
format:
	cd $(BACKEND) && .venv/bin/ruff format .
	cd $(WEB) && npm run format

# ---- database ------------------------------------------------------------
# Both need DATABASE_URL pointing at a Postgres instance (see README).
db-migrate:
	cd $(BACKEND) && .venv/bin/python -m annapurna.migrations

db-seed:
	cd $(BACKEND) && .venv/bin/python -m seed

# ---- clean ---------------------------------------------------------------
clean:
	rm -rf $(VENV) $(WEB)/node_modules $(WEB)/dist
	find $(BACKEND) -type d -name __pycache__ -prune -exec rm -rf {} +
	find $(BACKEND) -type d -name .pytest_cache -prune -exec rm -rf {} +
