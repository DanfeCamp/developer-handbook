---
title: 'FastAPI'
description: 'Typed, async Python APIs with automatic OpenAPI documentation — Pydantic models, dependency injection, async correctness, testing and deployment.'
---

# FastAPI

## Introduction

FastAPI builds an HTTP API from Python type hints. You declare what a request
and response look like using ordinary annotations, and the framework derives
validation, serialisation, editor autocompletion and an OpenAPI schema from
them — with no duplication.

**The problem it solves.** Traditional Python web frameworks make you write the
same shape three times: once to validate the request, once as a docstring or
schema for the documentation, and once in your head when reading the code. Those
three drift apart. FastAPI derives all of it from one declaration.

**Where it fits.** JSON APIs, microservices, ML model serving, and anything
that benefits from async I/O. It is not a full-stack framework — no ORM, no
admin, no templating by convention. For a database-backed web application with
server-rendered pages, Django remains the better fit.

:::note Versions
Written against **FastAPI 0.141.1** (July 2026), **Pydantic v2** and **Python
3.10+**.

FastAPI is still on a `0.x` version, and it follows the ecosystem convention
that a **minor bump may break things**. Pin a range you have tested, and read
the release notes when upgrading.
:::

---

## Core Concepts

### Type hints do the work

```python
from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="Orders API", version="1.0.0")


class CreateOrder(BaseModel):
    product_id: str = Field(pattern=r"^[0-9a-f-]{36}$")
    quantity: int = Field(ge=1, le=100)
    notes: str | None = Field(default=None, max_length=500)


class OrderOut(BaseModel):
    id: str
    product_id: str
    quantity: int
    status: str


@app.post("/orders", response_model=OrderOut, status_code=201)
async def create_order(payload: CreateOrder) -> OrderOut:
    order = await orders.create(payload)
    return order
```

That single function gives you:

- **Request validation** — a bad `quantity` returns a 422 with a precise,
  structured error, with no validation code written.
- **Response filtering** — `response_model` guarantees the response shape and
  strips anything not declared, which prevents accidentally leaking internal
  fields.
- **OpenAPI documentation** — served at `/docs` and `/redoc`, always accurate,
  because it is generated from the same declaration.
- **Editor support** — real autocompletion and type checking.

### Parameters are inferred by position

FastAPI decides where each argument comes from by looking at the signature:

```python
from typing import Annotated
from fastapi import Query, Path, Header, Depends

@app.get("/orders/{order_id}")
async def get_order(
    order_id: Annotated[str, Path()],                   # in the path
    include_items: Annotated[bool, Query()] = False,    # in the query string
    user_agent: Annotated[str | None, Header()] = None, # a header
    db: Annotated[AsyncSession, Depends(get_db)] = ...,  # injected
) -> OrderOut: ...
```

A parameter whose name matches a path placeholder is a path parameter. A scalar
that does not is a query parameter. A Pydantic model is the request body. The
`Annotated[...]` form is the current idiom and is preferred over the older
`q: str = Query(...)` default-value style.

### Dependency injection

FastAPI's most distinctive feature. A dependency is any callable; its result is
injected, cached per request, and — crucially — is itself testable and
overridable.

```python
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session          # code after yield runs on the way out


async def current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    user = await verify_token(token, db)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return user


@app.get("/orders")
async def list_orders(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[OrderOut]:
    return await orders.for_user(db, user.id)
```

Dependencies compose: `current_user` depends on `get_db`, and FastAPI resolves
the graph and reuses `get_db` within one request rather than opening two
sessions.

Apply one to a whole router when it must always run:

```python
router = APIRouter(dependencies=[Depends(current_user)])
```

---

## Async Correctness

The single most important thing to get right, and the most common source of
production problems.

FastAPI runs on ASGI and is genuinely concurrent — but **one blocking call
blocks the entire event loop**, stalling every other in-flight request.

```python
# ❌ A synchronous, blocking call inside an async endpoint.
@app.get("/orders")
async def list_orders():
    response = requests.get("https://api.example.com/orders")  # blocks everything
    return response.json()

# ✅ An async client.
@app.get("/orders")
async def list_orders():
    async with httpx.AsyncClient() as client:
        response = await client.get("https://api.example.com/orders")
    return response.json()
```

The rule:

- **`async def`** when everything inside is awaited — async database driver,
  `httpx`, `aiofiles`.
- **`def`** (plain) when you must call blocking code. FastAPI runs plain
  functions in a thread pool automatically, so they do not block the loop.

```python
# ✅ Correct: a blocking library in a plain def — FastAPI threads it.
@app.get("/report")
def generate_report():
    return heavy_pandas_computation()   # runs in the thread pool
```

Getting this backwards — `async def` wrapping blocking work — is what turns a
fast service into one that mysteriously times out under load, because the entire
worker serialises behind each blocking call.

For genuinely CPU-bound work, a thread pool is not enough either: Python's GIL
means it still competes with the loop. Push it to a background worker
([Celery](/knowledge-base/operations/queues), ARQ, or a task queue).

---

## Setup

```bash
uv init my-api && cd my-api
uv add "fastapi[standard]" sqlalchemy asyncpg pydantic-settings
uv add --dev pytest pytest-asyncio httpx ruff mypy

uv run fastapi dev app/main.py    # reload server, docs at /docs
```

`uv` has largely replaced pip and Poetry for new Python projects — it resolves
and installs an order of magnitude faster and manages the virtualenv for you.

```text
app/
├── main.py               ← FastAPI instance, routers, lifespan
├── config.py             ← pydantic-settings
├── dependencies.py       ← get_db, current_user
├── routers/
│   └── orders.py         ← APIRouter
├── schemas/
│   └── orders.py         ← Pydantic request/response models
├── services/
│   └── orders.py         ← business logic, no FastAPI imports
├── models/
│   └── orders.py         ← SQLAlchemy ORM models
└── tests/
```

Keep **Pydantic schemas separate from ORM models**. They answer different
questions — what the API accepts and returns, versus how data is stored — and
conflating them is how internal columns end up in public responses.

```python title="app/config.py"
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    database_url: str
    jwt_secret: str
    cors_origins: list[str] = []


settings = Settings()   # raises at import time if anything is missing
```

Failing at startup with a clear message beats failing at 3am on the one code
path that reads an unset variable.

```python title="app/main.py"
from contextlib import asynccontextmanager
from fastapi import FastAPI


@asynccontextmanager
async def lifespan(app: FastAPI):
    await engine.connect()      # startup
    yield
    await engine.dispose()      # shutdown


app = FastAPI(lifespan=lifespan)
app.include_router(orders.router, prefix="/api/orders", tags=["orders"])
```

`lifespan` replaced the deprecated `@app.on_event("startup")` decorators.

---

## Error Handling

```python
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse


@app.get("/orders/{order_id}")
async def get_order(order_id: str, user: Annotated[User, Depends(current_user)]):
    order = await orders.find(order_id)
    if order is None or order.user_id != user.id:
        # 404 rather than 403: do not confirm that the record exists.
        raise HTTPException(status_code=404, detail="Order not found")
    return order


class InsufficientStock(Exception):
    def __init__(self, sku: str) -> None:
        self.sku = sku


@app.exception_handler(InsufficientStock)
async def insufficient_stock_handler(request: Request, exc: InsufficientStock):
    return JSONResponse(
        status_code=409,
        content={"error": "insufficient_stock", "sku": exc.sku},
    )
```

Domain exceptions plus registered handlers keep HTTP concerns out of your
service layer — the service raises `InsufficientStock`, and only the handler
knows that this means 409.

Never return the exception text for unexpected errors. Log it with a request id;
return the id.

---

## Security

FastAPI supplies the plumbing for authentication, not a policy.

```python
from fastapi.security import OAuth2PasswordBearer
from fastapi.middleware.cors import CORSMiddleware

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/token")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,   # explicit list, never ["*"] with credentials
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
```

The checklist:

- **Authorise per object.** `Depends(current_user)` proves who they are. It does
  not prove they may read order 42.
- **Use `response_model`** so internal fields cannot leak. A model that returns
  a raw ORM object will happily serialise `password_hash` if it is an attribute.
- **Hash passwords with bcrypt or Argon2**, never a plain hash.
- **Never `["*"]` origins with credentials** — the browser rejects it, and the
  intent is wrong anyway.
- **Rate-limit** authentication endpoints (`slowapi`, or at the proxy).
- **Validate outbound URLs** if the API fetches user-supplied addresses (SSRF).
- **Use an async ORM or parameterised queries** — never f-string SQL. See
  [SQL Injection](/knowledge-base/security/sql-injection).

---

## Testing

```python
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.dependencies import get_db


@pytest.fixture
async def client(db_session):
    # Dependency overrides are why FastAPI is pleasant to test.
    app.dependency_overrides[get_db] = lambda: db_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def test_rejects_zero_quantity(client, auth_headers):
    response = await client.post(
        "/api/orders",
        json={"product_id": VALID_UUID, "quantity": 0},
        headers=auth_headers,
    )
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "quantity"]


async def test_cannot_read_another_users_order(client, other_users_order, auth_headers):
    response = await client.get(f"/api/orders/{other_users_order.id}", headers=auth_headers)
    assert response.status_code == 404
```

`app.dependency_overrides` replaces any dependency for the duration of a test —
database session, current user, external client — without patching or
monkeypatching. It is the cleanest injection-for-tests story in any Python web
framework.

Run integration tests against a real PostgreSQL in a container rather than
SQLite; see [Testing](/knowledge-base/testing).

---

## Deployment

```dockerfile
FROM python:3.13-slim AS build
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY . .

FROM python:3.13-slim
WORKDIR /app
COPY --from=build /app /app
ENV PATH="/app/.venv/bin:$PATH"
RUN useradd -m app && chown -R app /app
USER app
EXPOSE 8000
CMD ["fastapi", "run", "app/main.py", "--port", "8000"]
```

- **Run behind a reverse proxy** for TLS, compression and static files.
- **Multiple workers**: `--workers 4`, roughly one per core. Each is a separate
  process with its own event loop, which is how you use more than one core.
- **Do not use `--reload` in production**; it is a development-only feature.
- **Health endpoints**: `/health` for liveness, `/ready` that actually checks
  the database.
- **Structured JSON logs** with a request id. See
  [Logging](/knowledge-base/operations/logging).
- **Disable `/docs` on a private API**, or protect it —
  `FastAPI(docs_url=None, redoc_url=None)`.

---

## Do's and Don'ts

### Do

- Use `async def` only when everything inside is awaited.
- Use plain `def` for blocking libraries; FastAPI threads them.
- Declare `response_model` on every endpoint.
- Keep Pydantic schemas separate from ORM models.
- Use `Annotated[...]` for parameters and dependencies.
- Validate configuration at import time with `pydantic-settings`.
- Override dependencies in tests rather than patching.
- Authorise per object, not just per route.

### Don't

- Don't call `requests`, `time.sleep` or a sync DB driver inside `async def`.
- Don't return ORM objects directly without a `response_model`.
- Don't put business logic in path operation functions.
- Don't use `["*"]` CORS origins with credentials.
- Don't run CPU-bound work in the event loop — queue it.
- Don't leave `/docs` public on an internal API.
- Don't assume a minor FastAPI bump is safe; it is still `0.x`.

---

## Debugging

| Symptom                                       | Cause and fix                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Throughput collapses under load               | A blocking call inside `async def`. Convert to an async client, or make the function plain `def`. |
| 422 with a confusing `loc`                    | Read the path in `detail[0].loc` — it points exactly at the offending field.                      |
| Internal fields appear in responses           | No `response_model`, so the ORM object was serialised wholesale.                                  |
| `Depends` runs twice per request              | Two different callables, or `use_cache=False`. FastAPI caches per callable per request.           |
| Works in tests, fails in production           | A dependency override left in place, or an env var only set locally.                              |
| Startup code never runs                       | `@app.on_event` is deprecated; use `lifespan`.                                                    |
| `RuntimeError: Event loop is closed` in tests | Missing `pytest-asyncio` config, or mixing sync and async fixtures.                               |
| Pydantic v1 code fails after upgrade          | v2 renamed a great deal — `.dict()` → `.model_dump()`, validators changed.                        |

```bash
uv run fastapi dev app/main.py     # auto-reload, verbose errors
uv run mypy app                    # the type hints are load-bearing; check them
uv run ruff check --fix app
```

---

## FAQ

**FastAPI or Django?**
FastAPI for JSON APIs, async workloads and ML serving. Django when you want an
ORM, admin, auth and templates supplied — Django REST Framework is mature, and
Django now supports async too.

**FastAPI or Flask?**
FastAPI, for a new API. It gives you validation, docs and async that Flask needs
extensions for. Flask remains fine for small synchronous services.

**Do I have to use async?**
No. Plain `def` endpoints run in a thread pool and are perfectly good — often
the right choice with a synchronous ORM like Django's or SQLAlchemy's sync API.

**Which ORM?**
SQLAlchemy 2.0 with `asyncpg` is the mainstream choice. SQLModel (from FastAPI's
author) merges Pydantic and SQLAlchemy models, which is convenient for small
projects and blurs a separation worth keeping as things grow.

**Is it production-ready at `0.x`?**
Yes — it is very widely deployed. The `0.x` matters for upgrade discipline, not
stability: pin and read release notes.

**How do I version an API?**
Prefix routers: `/api/v1/...`, `/api/v2/...`, mounting separate `APIRouter`
instances. See [REST APIs](/knowledge-base/apis/rest).

---

## Check your understanding

<Quiz
question="An endpoint declared `async def` calls `requests.get()` to reach a third-party API. Under load, all requests slow down — not just this one. Why?"
options={[
{
text: 'requests is synchronous and blocks the event loop, so no other coroutine can make progress while it waits',
correct: true,
why: 'An async worker runs one event loop. A blocking call inside a coroutine stalls every other in-flight request until it returns.',
},
{
text: 'The third-party API is rate-limiting all connections',
why: 'That would slow this endpoint, not unrelated ones served by the same worker.',
},
{text: 'FastAPI serialises requests to the same path', why: 'It does not; concurrent requests are handled concurrently unless the loop is blocked.'},
{text: 'Too few Uvicorn workers are configured', why: 'More workers dilute the symptom without fixing the cause — each still stalls on every blocking call.'},
]}
explanation={<>Two correct fixes: use <code>httpx.AsyncClient</code> with <code>await</code>, or declare the endpoint as plain <code>def</code> so FastAPI runs it in a thread pool. The dangerous combination is <code>async def</code> plus blocking code.</>}
reference={{label: 'Async correctness', href: '/knowledge-base/fastapi#async-correctness'}}>

```python
@app.get("/orders")
async def list_orders():
    response = requests.get("https://api.example.com/orders")
    return response.json()
```

</Quiz>

<Quiz
question="An endpoint returns a SQLAlchemy User object directly with no response_model, and password_hash appears in the JSON. What is the correct fix?"
options={[
{
text: 'Declare a Pydantic response_model containing only the public fields — FastAPI then filters everything else out',
correct: true,
why: 'response_model is both documentation and a filter: FastAPI serialises only the declared fields, so an internal column cannot leak even if it is present on the object.',
},
{text: 'Add password_hash to a model exclusion list in SQLAlchemy', why: 'Workable but fragile — it protects one field, and the next internal column added leaks again.'},
{text: 'Use del on the attribute before returning', why: 'Mutating an ORM instance to shape a response is error-prone and can confuse the session.'},
{text: 'Set the endpoint to return a dict instead', why: 'Hand-building dicts loses validation and documentation, and the same mistake recurs.'},
]}
explanation={<>Keeping Pydantic schemas separate from ORM models is what makes this systematic: the API's shape is declared independently of storage, so storage changes cannot silently change what is public.</>}
reference={{label: 'Type hints do the work', href: '/knowledge-base/fastapi#type-hints-do-the-work'}}
/>

<Quiz
question="Which of these are genuine advantages of FastAPI's dependency injection?"
type="multiple"
options={[
{text: 'Dependencies are cached per request, so two endpoints sharing get_db use one session', correct: true, why: 'FastAPI resolves the dependency graph once per request and reuses results, avoiding duplicate connections.'},
{text: 'app.dependency_overrides replaces a dependency in tests with no patching', correct: true, why: 'The cleanest test-seam story in Python web frameworks — swap the database session or current user directly.'},
{text: 'Dependencies can yield, so cleanup runs after the response', correct: true, why: 'Code after yield runs on the way out, which is how sessions and transactions are closed reliably.'},
{text: 'Dependencies compose — one can depend on another', correct: true, why: 'current_user depending on get_db is the standard pattern, and FastAPI resolves the whole graph.'},
{text: 'Dependencies make endpoints run in parallel', why: 'Injection is about wiring and lifecycle, not concurrency. Parallelism comes from async I/O and workers.'},
]}
explanation={<>The test-override capability alone justifies routing all external access — database, HTTP clients, clocks — through dependencies rather than importing them directly.</>}
reference={{label: 'Dependency injection', href: '/knowledge-base/fastapi#dependency-injection'}}
/>

<Quiz
question="A CPU-bound image-processing endpoint is declared as plain `def` so FastAPI runs it in the thread pool. Throughput is still poor. Why?"
options={[
{
text: 'Python’s GIL means CPU-bound work in a thread still contends for the interpreter — it needs a separate process or a task queue',
correct: true,
why: 'The thread pool solves _blocking I/O_, not CPU saturation. CPU-bound work must move to another process, a worker queue, or a native extension that releases the GIL.',
},
{text: 'Plain def endpoints are always slower than async def', why: 'For blocking I/O they are the correct choice and perform well. The issue here is CPU, not the declaration.'},
{text: 'The thread pool size defaults to one', why: 'It defaults to a multiple of the core count, and raising it does not defeat the GIL.'},
{text: 'response_model serialisation is the bottleneck', why: 'Serialisation is negligible next to image processing.'},
]}
explanation={<>The decision tree: awaitable I/O → <code>async def</code>; blocking I/O → plain <code>def</code>; CPU-bound → a queue or a separate worker process.</>}
reference={{label: 'Async correctness', href: '/knowledge-base/fastapi#async-correctness'}}
/>

<Quiz
question="An API returns 404 rather than 403 when a user requests an order belonging to someone else. Is that correct?"
options={[
{
text: 'Yes — returning 404 avoids confirming that the record exists, which would otherwise leak information through enumeration',
correct: true,
why: 'A 403 tells an attacker the id is real. Returning 404 for both "does not exist" and "not yours" makes the two indistinguishable.',
},
{text: 'No — 403 is the semantically correct status and should always be used', why: 'Semantically defensible, but it leaks existence. Many security guidelines prefer 404 for exactly that reason.'},
{text: 'No — it should be 401, since the user is not authorised', why: '401 means unauthenticated. This user is authenticated; they simply may not access this resource.'},
{text: 'Only if the API is public', why: 'Enumeration is a concern for authenticated APIs too — any account can probe for valid ids.'},
]}
explanation={<>The important part is that the check exists at all. Broken object-level authorisation — authenticating the user but never verifying ownership — is the top entry in the OWASP API Security Top 10.</>}
reference={{label: 'Error handling', href: '/knowledge-base/fastapi#error-handling'}}
/>

---

## References

- [FastAPI documentation](https://fastapi.tiangolo.com/) — the tutorial is
  unusually good.
- [FastAPI release notes](https://fastapi.tiangolo.com/release-notes/) —
  essential reading, given `0.x` versioning.
- [Pydantic v2 documentation](https://docs.pydantic.dev/latest/) — validation,
  serialisation, settings.
- [SQLAlchemy 2.0 async](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html)
  — the mainstream async ORM path.
- [Starlette](https://www.starlette.io/) — the ASGI toolkit underneath FastAPI.
- [uv](https://docs.astral.sh/uv/) — the current Python packaging tool.
- [OWASP API Security Top 10](https://owasp.org/API-Security/editions/2023/en/0x11-t10/).
