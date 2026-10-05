# Thin wrappers around docker compose / npm. `make help` lists targets.
.DEFAULT_GOAL := help
COMPOSE ?= docker compose

help: ## Show targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-18s %s\n",$$1,$$2}'

up: ## Start db + api + web (foreground, with build)
	$(COMPOSE) up --build

down: ## Stop the stack (keeps the pgdata volume)
	$(COMPOSE) down

reset-db: ## Stop and drop the database volume
	$(COMPOSE) down -v

db: ## Start only Postgres (for running tests/server on the host)
	$(COMPOSE) up -d db

logs: ## Tail api + web logs
	$(COMPOSE) logs -f server web

install: ## npm install (workspaces)
	npm install

typecheck: ## tsc over server + vue-tsc over web
	npm run typecheck

lint: ## eslint + prettier --check
	npm run lint && npm run format:check

test: ## Money-math unit tests (no DB needed)
	npm test

test-integration: db ## Integration tests against the compose Postgres (DATABASE_URL from .env/.env.example)
	npm run test:integration

check: typecheck lint test ## Everything CI runs that needs no database

.PHONY: help up down reset-db db logs install typecheck lint test test-integration check
