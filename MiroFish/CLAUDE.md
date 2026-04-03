# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MiroFish is a multi-agent AI prediction engine that simulates swarm intelligence. It extracts information from uploaded documents, builds knowledge graphs via Zep Cloud, generates agent profiles, runs multi-platform social media simulations (Twitter + Reddit) using CAMEL OASIS, and produces analytical reports. The UI walks users through a 5-step workflow: Graph Build → Environment Setup → Simulation Config → Simulation Run → Report & Interaction.

## Commands

```bash
# Install all dependencies (root npm + frontend npm + backend uv)
npm run setup:all

# Run backend + frontend concurrently
npm run dev

# Run only backend (Flask on port 5001)
npm run backend

# Run only frontend (Vite dev server on port 3000)
npm run frontend

# Build frontend for production
npm run build

# Run backend tests
cd backend && uv run pytest

# Install backend deps only
cd backend && uv sync
```

## Architecture

**Frontend** (`frontend/`): Vue 3 SPA with Composition API, built with Vite. D3.js for graph visualization. Axios for API calls with a proxy from `:3000/api` → `:5001/api`.

**Backend** (`backend/`): Flask app using the factory pattern (`app/__init__.py` → `create_app()`). Python package management via `uv`. No SQL database — state is persisted as JSON files under `backend/uploads/` and knowledge graphs live in Zep Cloud.

### Backend Structure

- **`app/api/`** — Three Flask blueprints:
  - `graph.py` (`/api/graph`) — Ontology generation, graph building, project CRUD
  - `simulation.py` (`/api/simulation`) — Environment prep, simulation lifecycle, entity/profile management
  - `report.py` (`/api/report`) — Report generation, agent logs, chat with ReportAgent

- **`app/services/`** — Core business logic. Key services:
  - `ontology_generator.py` — LLM-based ontology extraction from documents
  - `graph_builder.py` — Constructs Zep knowledge graphs from chunked text
  - `oasis_profile_generator.py` — Generates agent personas via LLM
  - `simulation_runner.py` — Runs OASIS simulations in background threads
  - `simulation_manager.py` — Singleton managing simulation state
  - `report_agent.py` — ReACT-pattern agent with tools (InsightForge, PanoramaSearch, QuickSearch, Interview)
  - `zep_entity_reader.py` — Reads/filters entities from Zep graphs
  - `zep_graph_memory_updater.py` — Updates graph memory post-simulation

- **`app/models/`** — `project.py` (JSON-file persistence via dataclasses), `task.py` (in-memory task tracking)

- **`app/utils/`** — `llm_client.py` (OpenAI-compatible wrapper), `file_parser.py` (PDF/TXT/MD), `retry.py`, `zep_paging.py`

### Frontend Structure

- **`src/components/`** — Step components (`Step1GraphBuild.vue` through `Step5Interaction.vue`), `GraphPanel.vue` (D3 visualization), `HistoryDatabase.vue`
- **`src/views/`** — Route-level pages: `Home.vue`, `MainView.vue`, `SimulationView.vue`, `SimulationRunView.vue`, `ReportView.vue`, `InteractionView.vue`
- **`src/api/`** — API modules: `index.js` (Axios instance), `graph.js`, `simulation.js`, `report.js`

### Key Patterns

- Long-running operations (graph building, simulation, report generation) run in background threads. The frontend polls task status endpoints.
- All LLM calls use OpenAI-compatible format (configurable via `LLM_BASE_URL`/`LLM_MODEL_NAME` env vars). An optional "boost" LLM config exists for faster models.
- Managers (`TaskManager`, `ProjectManager`, `SimulationManager`) are singletons.
- OASIS simulation supports dual-platform (Twitter + Reddit) with parallel execution.

## Environment Variables

Required in `.env` at project root (see `.env.example`):
- `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL_NAME` — OpenAI-compatible LLM endpoint
- `ZEP_API_KEY` — Zep Cloud for knowledge graph memory
- Optional: `LLM_BOOST_API_KEY`, `LLM_BOOST_BASE_URL`, `LLM_BOOST_MODEL_NAME` — faster LLM for certain operations

## Tech Stack

- **Frontend**: Vue 3, Vite, Vue Router, Axios, D3.js
- **Backend**: Flask, Zep Cloud SDK, CAMEL OASIS/AI, OpenAI SDK, PyMuPDF
- **Runtime**: Node 18+, Python 3.11-3.12, uv package manager
- **Deployment**: Docker multi-stage build, GitHub Actions CI pushing to GHCR
- **License**: AGPL-3.0
