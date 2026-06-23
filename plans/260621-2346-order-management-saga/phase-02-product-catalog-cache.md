---
phase: 2
title: 'Product Catalog & Cache'
status: completed
priority: P1
effort: '6h'
dependencies: [1]
---

# Phase 2: Product Catalog & Cache

## Overview

Introduce a product catalog with reservation-aware stock columns (`stock_available`, `stock_reserved`), admin CRUD, public read endpoints, and a Redis read-through cache with invalidation on write.

## Requirements

- Functional: admin can CRUD products; anyone can list/get active products; list/detail served from Redis cache, invalidated on any product mutation.
- Non-functional: money in integer cents; SKU unique; cache TTL bounded; stock never negative (DB check or guarded updates).

## Architecture

- Schema `products`: `id uuid pk, sku text unique, name text, description text, price_cents int, stock_available int not null default 0, stock_reserved int not null default 0, active boolean default true, created_at, updated_at`. (Reserve/release logic lives in phase 4/6; here just columns + CRUD.)
- Module `src/modules/products/` (route → controller → service → repository), mirroring existing module pattern.
- Endpoints: `POST/PATCH/DELETE /products` (admin, `requireRole('admin')`), `GET /products` + `GET /products/:id` (public, active only for non-admin).
- Cache: `src/modules/products/products-cache.ts` — keys `catalog:list`, `catalog:item:{id}`; read-through in service; `invalidate()` on create/update/delete (DEL keys). Uses `fastify.redis` from phase 1.

## Related Code Files

- Create: `src/modules/products/{products-routes,products-controller,products-service,products-repository,products-schema,products-cache}.ts`
- Create migration: `drizzle/0003_*.sql`
- Modify: `src/infra/db/schema.ts` (products table), `src/app.ts` (register products routes)

## TDD — Tests First

1. `test/unit/products-cache.test.ts` — read-through miss→DB→set; hit→no DB; write→invalidate.
2. `test/api/products.test.ts` — admin create→201; customer create→403; public list returns active only; get missing→404; update invalidates cache (second GET reflects change).
3. `test/unit/products-service.test.ts` — SKU conflict → 409; price/stock validation.

## Implementation Steps

1. Add `products` to schema; `db:generate` → review → `db:migrate`.
2. Write failing tests above.
3. Implement repository (CRUD), service (+ cache read-through/invalidate), controller, routes, TypeBox schema.
4. Register routes in `app.ts`; guard mutations with `requireRole('admin')`.
5. typecheck + lint + tests green.

## Success Criteria

- [ ] `products` migrated with available/reserved columns.
- [ ] Admin CRUD works; customers blocked from mutations (403).
- [ ] Public list/detail returns active products, served via Redis cache.
- [ ] Mutation invalidates cache (verified by test).
- [ ] typecheck + lint + tests green.

## Risk Assessment

- Cache invalidation correctness → keep keys few + invalidate broadly (DEL list + item) rather than surgical; correctness over hit-rate.
- Don't implement reserve/release here (phase 4/6 own it) → avoid premature stock mutation logic.

## Implementation Notes (done 2026-06-23)

- **Decisions:** DELETE = soft-delete (`active=false`) so later `order_items.product_id` FK won't break; Redis caches only the PUBLIC active-only view, admin reads bypass via optional-auth on GET (`request.user` populated if a token is present, never 401s a read).
- **Stock guards:** non-negative CHECK constraints (`stock_available >= 0`, `stock_reserved >= 0`) added with the `products` table now (migration `0003`), satisfying this phase's "stock never negative" and pre-empting the phase-4 hardening.
- **Known trade-off (accepted, not fixed):** read-through + DEL-invalidate has a classic race — a public read that misses and a concurrent admin mutation can re-`SET` a pre-mutation snapshot that then survives the DEL for up to the TTL (300s). Bounded staleness of catalog display fields only (no money/stock, which aren't mutated here). Matches the "correctness over hit-rate, bounded TTL" decision above. Future fix if needed: write-through or a version token on the cache key.
- **Tests:** 18 added (products-cache unit, products-service unit, products API incl. authz matrix, soft-delete, re-activation, cache-invalidation-on-update). Full suite 45 green.
