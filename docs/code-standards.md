# Code Standards & Conventions

This document defines the enforced patterns and conventions used throughout the codebase. All developers must follow these standards to maintain consistency and quality.

## Module Structure (5-Layer Pattern)

Every module follows this strict layering: **Routes → Controller → Service → Repository → Schema**

```
modules/orders/
├── orders.routes.ts           # HTTP bindings: POST /orders, GET /orders/:id
├── orders.controller.ts       # Request validation, auth checks, response formatting
├── orders.service.ts          # Business logic, orchestration (pure — no DB)
├── orders.repository.ts       # All DB operations, transactions, queries
├── orders.schema.ts           # Types, DTOs, status enums, row types
└── {orders.test.ts}           # Tests mirror this structure
```

### Layer Responsibilities (Strict Boundaries)

#### Routes (`*.routes.ts`)

**Owns:** HTTP path binding, method, input/output mapping

```typescript
routes.post<{ Body: CreateOrderRequest }>('/orders', async (req, reply) => {
  // Deserialize request
  const dto = req.body;

  // Call service (no DB)
  const order = await orderService.createOrder(dto, req.user);

  // Serialize response
  return reply.code(201).send(order);
});
```

**Must NOT:**

- Call database directly
- Contain business logic
- Import `Repository` class directly (go through Service)

#### Controller (`*.controller.ts`)

**Owns:** HTTP-specific validation, auth/permission checks, response formatting

```typescript
export const ordersController = makeOrdersController({
  service: ordersService,
  // ...
});

function makeOrdersController({ service }: OrdersControllerDeps) {
  return {
    async create(req: FastifyRequest, body: CreateOrderRequest, userId: string) {
      requirePermission(req, Permissions.CREATE_ORDER);
      const order = await service.createOrder(body, userId);
      return formatOrderResponse(order);
    },
  };
}
```

**Must NOT:**

- Touch the database
- Import Repository directly
- Mix business logic with HTTP concerns

#### Service (`*.service.ts`)

**Owns:** Pure business logic, orchestration, error handling (transaction coordination only)

```typescript
export const makeOrdersService = (deps: OrdersServiceDeps) => ({
  async createOrder(dto: CreateOrderDTO, userId: string): Promise<OrderDTO> {
    // Validate business rules
    if (dto.items.length === 0) throw new ValidationError('Order must have items');

    // Orchestrate repository calls (via transaction)
    const order = await deps.repository.createOrderWithOutbox(dto, userId);

    return mapOrderToDTO(order);
  },
});
```

**Must NOT:**

- Execute queries directly (all DB via repository)
- Import database clients
- Know about HTTP (generic, reusable by workers too)
- Hold state (stateless functions)

#### Repository (`*.repository.ts`)

**Owns:** All database operations, transaction management, queries

```typescript
export const makeOrdersRepository = (db: Database) => ({
  async createOrderWithOutbox(dto: CreateOrderDTO, userId: string) {
    return db.transaction(async (tx) => {
      const order = await tx
        .insert(orders)
        .values({ ...dto, userId, status: ORDER_STATUS.PENDING })
        .returning();

      await tx.insert(outboxMessages).values({
        eventType: 'order.created',
        payload: order,
        correlationId: order.id,
      });

      return order[0];
    });
  },

  async getOrderWithItems(orderId: string) {
    return db.query.orders.findFirst({
      where: eq(orders.id, orderId),
      with: { items: true },
    });
  },
});
```

**Must NOT:**

- Know about HTTP
- Contain business logic beyond query construction
- Throw HTTP errors (throw domain errors; controller maps)

#### Schema (`*.schema.ts`)

**Owns:** Type definitions, request/response schemas, status enums, row types

```typescript
// Domain types (source of truth)
export const ORDER_STATUS = {
  PENDING: 'pending',
  PAID: 'paid',
  FULFILLING: 'fulfilling',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
} as const;
export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

// Database row type (auto-generated via InferSelectModel)
export type OrderRow = InferSelectModel<typeof orders>;

// Request/response DTOs
export const CreateOrderRequestSchema = Type.Object({
  items: Type.Array(
    Type.Object({
      productId: Type.String(),
      quantity: Type.Number({ minimum: 1 }),
    }),
  ),
});
export type CreateOrderRequest = Static<typeof CreateOrderRequestSchema>;

// ORM insert type
export type CreateOrderInput = typeof orders.$inferInsert;
```

## Factory Pattern (make*)

Every module exports factory functions (`make*`) for dependency injection:

```typescript
export const makeOrdersService = (deps: OrdersServiceDeps) => ({
  // service implementation
});

export const makeOrdersRepository = (db: Database) => ({
  // repository implementation
});

export const makeOrdersController = (deps: OrdersControllerDeps) => ({
  // controller implementation
});
```

**Why:** Testable in isolation; callers inject concrete deps or mocks.

**Pattern in tests:**

```typescript
const mockRepository = { createOrder: vi.fn() };
const service = makeOrdersService({ repository: mockRepository });
// Now test service with mocked repo
```

## Type Declaration Order (Schema File)

Always follow this order in schema files:

1. **Domain constants** (status enums, role constants)
2. **Row types** (InferSelectModel)
3. **Insert types** (typeof table.$inferInsert)
4. **Request DTOs** (TypeBox schemas)
5. **Response DTOs** (TypeBox schemas)
6. **Helper types** (unions, filtered types)

```typescript
// 1. Domain constants
export const ORDER_STATUS = { PENDING: 'pending', ... } as const;

// 2. Row type
export type OrderRow = InferSelectModel<typeof orders>;

// 3. Insert type
export type CreateOrderInput = typeof orders.$inferInsert;

// 4. Request DTOs
export const CreateOrderRequestSchema = Type.Object({ ... });
export type CreateOrderRequest = Static<typeof CreateOrderRequestSchema>;

// 5. Response DTOs
export const OrderResponseSchema = Type.Object({ ... });
export type OrderResponse = Static<typeof OrderResponseSchema>;

// 6. Helper types
export type OrderWithItems = OrderRow & { items: OrderItemRow[] };
```

## Service Layer Rules (Critical)

1. **No database imports** — all DB access via repository parameter
2. **No HTTP knowledge** — generic enough to be called by API routes OR background workers
3. **Pure business logic** — validate rules, throw domain errors (not HTTP errors)
4. **Testable without infrastructure** — all external calls are injected

```typescript
// ✅ GOOD: Generic, testable
async function cancelOrder(orderId: string) {
  const order = await orderRepository.getOrder(orderId);
  if (order.status !== ORDER_STATUS.PAID) {
    throw new ValidationError('Can only cancel paid orders');
  }
  await paymentRepository.refund(order.paymentId);
  await orderRepository.updateStatus(orderId, ORDER_STATUS.CANCELLED);
}

// ❌ BAD: Imports DB, mixes concerns
async function cancelOrder(orderId: string) {
  const order = await db.query.orders.findFirst(...);
  if (order.status !== 'paid') {
    throw new Error('HTTP 400: Can only cancel paid orders'); // Wrong!
  }
  // ...
}
```

## Types as Constants (Source of Truth)

All domain constants (statuses, roles, permissions) are defined as `const` objects with union type inference. **These are the single source of truth** — never hardcode status strings.

```typescript
// ✅ CORRECT: types/order-status.ts
export const ORDER_STATUS = {
  PENDING: 'pending',
  PAID: 'paid',
  FULFILLING: 'fulfilling',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];
// OrderStatus is: 'pending' | 'paid' | 'fulfilling' | 'delivered' | 'cancelled'

// Usage in schema:
export const UpdateOrderStatusSchema = Type.Object({
  status: Type.Union([Type.Literal(ORDER_STATUS.PAID), Type.Literal(ORDER_STATUS.CANCELLED)]),
});
```

**Why:**

- No database enums (avoids migration friction)
- Single update location when adding a status
- TypeScript union types catch invalid transitions at compile time
- No typos in production code

## ESM Module System & Import Specifiers

- **TypeScript `"type": "module"`** — all `.ts` files are ESM
- **Compiled `.js` specifiers** — imports always end in `.js`, never omit extension
- **Path aliases resolved at build** — `tsc-alias` rewrites paths after `tsc`

```typescript
// ✅ CORRECT: .js specifiers in all files
import { makeOrdersService } from '@modules/orders/orders.service.js';
import { makeOrdersRepository } from '@modules/orders/orders.repository.js';
import type { OrderRow } from '@modules/orders/orders.schema.js';

// ❌ WRONG: No extension or .ts
import { makeOrdersService } from '@modules/orders/orders.service'; // ✗
import { makeOrdersService } from '@modules/orders/orders.service.ts'; // ✗
```

**Path aliases:**

- `@/` → `src/`
- `@modules/` → `src/modules/`
- `@infra/` → `src/infra/`
- `@plugins/` → `src/plugins/`
- `@test/` → `test/`

## Naming Conventions

| Entity             | Convention               | Example                                                         |
| ------------------ | ------------------------ | --------------------------------------------------------------- |
| Files              | kebab-case               | `orders.routes.ts`, `order-status.ts`                           |
| Directories        | kebab-case, plural       | `modules/orders`, `src/infra/db`                                |
| Database tables    | snake_case, plural       | `orders`, `outbox_messages`, `processed_messages`               |
| Database columns   | snake_case               | `created_at`, `updated_at`, `user_id`                           |
| TypeScript types   | PascalCase               | `OrderRow`, `CreateOrderInput`                                  |
| Enums / constants  | SCREAMING_SNAKE_CASE     | `ORDER_STATUS`, `Permissions.CREATE_ORDER`                      |
| Functions          | camelCase                | `createOrder()`, `mapOrderToDTO()`                              |
| Variables          | camelCase                | `userId`, `orderStatus`                                         |
| Make factories     | `make*`                  | `makeOrdersService`, `makeOrdersRepository`                     |
| RabbitMQ consumers | kebab-case               | `inventory-reserve`, `payment-create`, `notifications-dispatch` |
| Cache keys         | `{module}:{entity}:{id}` | `products:catalog:v1`, `order:12345:details`                    |

## State Machines (Compare-and-Set)

Every status transition uses `UPDATE … WHERE status = <from>` (CAS, not blind overwrites):

```typescript
async function transitionOrder(orderId: string, from: OrderStatus, to: OrderStatus) {
  const result = await db
    .update(orders)
    .set({ status: to, updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), eq(orders.status, from)))
    .returning();

  if (result.length === 0) {
    throw new ConflictError(`Order not in ${from} status`);
  }

  // Record transition in history
  await db.insert(orderStatusHistory).values({
    orderId,
    fromStatus: from,
    toStatus: to,
    reason: 'payment.succeeded',
    timestamp: new Date(),
  });

  return result[0];
}
```

**Why:** Prevents illegal transitions (e.g., reviving a cancelled order), detects races.

## Comments & Documentation

- **Minimal comments:** Code should be self-documenting via clear names
- **Business-critical comments only:** Explain _why_, not _what_

```typescript
// ✅ GOOD: Explains why
async function updateOrder(orderId: string, data: Partial<OrderRow>) {
  // Use CAS to prevent reviving a cancelled order after late payment webhook
  const result = await db
    .update(orders)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), eq(orders.status, ORDER_STATUS.PENDING)))
    .returning();
  // ...
}

// ❌ BAD: Explains what (obvious from code)
async function updateOrder(orderId: string, data: Partial<OrderRow>) {
  // Create an update object with updatedAt
  const updateData = { ...data, updatedAt: new Date() };
  // Update the order in the database
  const result = await db.update(orders).set(updateData).where(...);
}
```

## Error Handling

- **Domain errors:** Thrown by service/repository (ValidationError, ConflictError, NotFoundError)
- **HTTP mapping:** Controller/route catches domain errors and maps to HTTP status codes
- **No HTTP errors in service:** Service throws domain errors; HTTP layer translates

```typescript
// ✅ Service throws domain error
async function createOrder(dto: CreateOrderDTO) {
  if (dto.items.length === 0) {
    throw new ValidationError('Order must have items');
  }
  // ...
}

// ✅ Controller maps to HTTP
try {
  const order = await orderService.createOrder(dto);
  return reply.code(201).send(order);
} catch (err) {
  if (err instanceof ValidationError) {
    return reply.code(400).send({ error: err.message });
  }
  if (err instanceof NotFoundError) {
    return reply.code(404).send({ error: err.message });
  }
  throw err; // Let error handler catch
}
```

## Transactions & Atomicity

Every saga write is transactional:

```typescript
async function createOrderWithOutbox(dto: CreateOrderDTO, userId: string) {
  return db.transaction(async (tx) => {
    // All inserts in one transaction
    const [order] = await tx
      .insert(orders)
      .values({ ...dto, userId, status: ORDER_STATUS.PENDING })
      .returning();

    await tx.insert(outboxMessages).values({
      eventType: 'order.created',
      payload: order,
      correlationId: order.id,
    });

    return order;
  });
}
```

## Test Conventions

### Naming

- **Unit tests:** `Subject.method` (e.g., `OrdersService.createOrder`)
- **Integration/E2E:** `subject (scenario)` (e.g., `orders (happy path)`, `order cancellation (pre-ship)`)

### Structure

```typescript
describe('OrdersService.createOrder', () => {
  it('creates order + outbox event in one transaction', async () => {
    const service = makeOrdersService({ repository: mockRepo });
    const result = await service.createOrder(validDTO, 'user-1');
    expect(result.status).toBe(ORDER_STATUS.PENDING);
  });

  it('throws ValidationError if items empty', async () => {
    const service = makeOrdersService({ repository: mockRepo });
    await expect(service.createOrder({ items: [] }, 'user-1')).rejects.toThrow(ValidationError);
  });
});
```

### Real Infrastructure

Integration and e2e tests use **Testcontainers** (no mocks for DB/RabbitMQ/Redis):

```typescript
describe('Order Saga (happy path)', () => {
  let db: Database;
  let mq: RabbitMQClient;

  beforeAll(async () => {
    // Real Postgres container
    const postgres = await new PostgresContainer().start();
    db = createDatabaseClient(postgres.getConnectionUri());

    // Real RabbitMQ container
    const rabbit = await new RabbitMQContainer().start();
    mq = createMQClient(rabbit.getAmqpUri());
  });

  it('completes order → payment → shipment flow', async () => {
    // Real test against real infrastructure
  });
});
```

## Linting & Formatting

- **ESLint:** `npm run lint` — typed config, no auto-fix
- **Prettier:** `npm run format` — opinionated, zero config
- **TypeScript:** `npm run typecheck` — strict, no `any`
- **Pre-commit:** Husky + lint-staged (lint files before commit)
- **Conventional commits:** `commitlint` enforces `type(scope): message` format

### Commit Format

```
feat(orders): add order cancellation with pre-ship compensation
fix(payments): handle webhook replay via idempotency key
docs(deployment): add Kubernetes Helm sketch
refactor(sagas): extract state machine helpers
test(e2e): verify order saga compensation paths
chore(deps): upgrade Fastify to v5.1.0
```

**Rules:**

- Must include `type` and `message`
- Optional `scope` in parentheses
- **Body line max length: 100 characters** (see `.commitlintrc`)
- No AI references in commit messages

## Import Order

Within each file, group imports:

1. Node.js built-ins
2. Third-party libraries
3. Project imports (via path aliases)
4. Relative imports
5. Type-only imports (if using TypeScript 4.5+)

```typescript
// Built-ins
import { EventEmitter } from 'events';

// Third-party
import { FastifyRequest } from 'fastify';
import { eq, and } from 'drizzle-orm';

// Project imports
import { OrderStatus, ORDER_STATUS } from '@modules/orders/orders.schema.js';
import { makeOrdersRepository } from '@modules/orders/orders.repository.js';

// Relative
import { logger } from '../logging.js';

// Type-only
import type { Database } from '@infra/db/client.js';
```

## No Circular Dependencies

- Modules may depend on `@infra` and `@plugins`
- Modules must NOT depend on other modules (except via shared `@/types`)
- Keep types in schema files; import types, not implementations

## Performance & Optimization

- **No N+1 queries:** Preload related data via `.with()` in Drizzle
- **Pagination on list endpoints:** Always limit + offset
- **Caching strategy:** Cache-aside for product catalog (invalidate on write)
- **Connection pooling:** Set min/max appropriately for your deployment
- **Indexes:** Create on foreign keys, status columns, timestamps (documented in migrations)

## Security

- **Never hardcode secrets:** Use `.env` + validated at boot via `@fastify/env`
- **Validate all input:** TypeBox schemas + custom validators
- **Escape SQL:** Use parameterized queries (Drizzle always does)
- **Rate limiting:** Redis-backed, shared across instances
- **CORS:** Restrict to known origins in production
- **HMAC signatures:** Verify payment webhook signatures before processing

## What NOT to Do

- ❌ Import `Repository` in routes (go through Controller/Service)
- ❌ Import database client in services (request via dependency injection)
- ❌ Blind `UPDATE` without `WHERE status = <from>` (use CAS)
- ❌ Hardcode status strings (use domain constants)
- ❌ Mix HTTP logic in services (keep reusable)
- ❌ Commit `.env` files or secrets (use `.env.example` + CI secrets)
- ❌ Skip tests for "quick" fixes (run full test suite)
- ❌ Use `any` type (strict TypeScript)
- ❌ Throw HTTP errors from service layer (throw domain errors)
- ❌ Add comments that restate the code (explain _why_, not _what_)
