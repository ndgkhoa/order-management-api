# Changelog

## [0.1.6](https://github.com/ndgkhoa/order-management-api/compare/v0.1.5...v0.1.6) (2026-07-05)


### Features

* add auth and users modules ([4a4832b](https://github.com/ndgkhoa/order-management-api/commit/4a4832b948bbcdb458468b0c8917935800822ceb))
* add drizzle db layer ([6e9d1ab](https://github.com/ndgkhoa/order-management-api/commit/6e9d1ab8f2a1f790a77ef4fd40ebbada8bc429a1))
* add fastify core app, plugins, health and graceful shutdown ([11240ce](https://github.com/ndgkhoa/order-management-api/commit/11240ce43a247ca788394ea9a93928c057216d22))
* add fastify core app, plugins, health and graceful shutdown ([5441323](https://github.com/ndgkhoa/order-management-api/commit/5441323f4a6481976793cf672856c87dfa92dab8))
* add local docker infra stack ([0facf38](https://github.com/ndgkhoa/order-management-api/commit/0facf381755e898ffc37f738311028a0e4835b93))
* add Loki log aggregation with Alloy collector ([743c160](https://github.com/ndgkhoa/order-management-api/commit/743c16033704226c4afe4b31f613584b7ae22773))
* add observability (metrics, tracing, sentry) ([6e1b1f9](https://github.com/ndgkhoa/order-management-api/commit/6e1b1f90b036f5fc1c0986b3d6cb75b9bdb900c7))
* add observability (metrics, tracing, sentry) ([8fe22fd](https://github.com/ndgkhoa/order-management-api/commit/8fe22fd185095435093d8ac553eeb02058d57777))
* add orders module with transactional outbox ([b041ed9](https://github.com/ndgkhoa/order-management-api/commit/b041ed9d74ce65ffdc083ec0e575201da63e5706))
* add orders module with transactional outbox ([a658390](https://github.com/ndgkhoa/order-management-api/commit/a6583903838d2172752c6988d40f2f45549c61cf))
* add rabbitmq publisher and idempotent email worker ([f49879d](https://github.com/ndgkhoa/order-management-api/commit/f49879dd0eb9476738b2766a601571acde243eb7))
* add rabbitmq publisher and idempotent email worker ([a1ad05d](https://github.com/ndgkhoa/order-management-api/commit/a1ad05da6d52ce96a4954a8a586b7c8043c0fbda))
* **auth:** add Redis plugin, requireRole guard, role in JWT, admin seed ([852d0ba](https://github.com/ndgkhoa/order-management-api/commit/852d0ba1b0e39513cb43b7e6d65a7ac8c87ac545))
* channel-agnostic notification system for saga events ([#41](https://github.com/ndgkhoa/order-management-api/issues/41)) ([3990746](https://github.com/ndgkhoa/order-management-api/commit/3990746d41a868444e1e21783815f82d3581e537))
* **db:** add event-id/correlation-id columns, composite dedup PK, users.role ([f7252b8](https://github.com/ndgkhoa/order-management-api/commit/f7252b8ef7b92e06c7cedad57fd06843842a6873))
* **db:** add products table and constrain user role to a pg enum ([499586d](https://github.com/ndgkhoa/order-management-api/commit/499586d73ca063c2ce18947facd60546ac439f95))
* **inventory:** reservation saga + generic worker ([728fcf4](https://github.com/ndgkhoa/order-management-api/commit/728fcf4ddb9aa96d9c9f42f44e70bd750d870028))
* **inventory:** reserve stock on order-created with saga compensation ([db4e633](https://github.com/ndgkhoa/order-management-api/commit/db4e633a18d8bc916687d3409b74d2a2a1c84fb3))
* **mq:** versioned event envelope published by relay; per-consumer dedup ([8562ae6](https://github.com/ndgkhoa/order-management-api/commit/8562ae674282fc1985e2a28ca99012e3fc087098))
* **observability:** provision Grafana dashboard as code ([1a49cef](https://github.com/ndgkhoa/order-management-api/commit/1a49cef6668e6a04ea3c429c865af91addba3579))
* **openapi:** document JWT auth, tags, and error responses ([fa916e2](https://github.com/ndgkhoa/order-management-api/commit/fa916e2c9f7f86b0da18deb8bff60ab501cd078f))
* order lifecycle, fake shipping and pre-ship cancel/refund ([#40](https://github.com/ndgkhoa/order-management-api/issues/40)) ([72854d1](https://github.com/ndgkhoa/order-management-api/commit/72854d132812bdd11a5b752c97d09fa522c084d7))
* **orders:** multi-line order aggregate, OpenAPI docs, docker cleanup ([d736aa8](https://github.com/ndgkhoa/order-management-api/commit/d736aa8300a2d91067667ba47d82d65b5518eaae))
* **orders:** reshape into a multi-line aggregate with price snapshots ([a3b64a5](https://github.com/ndgkhoa/order-management-api/commit/a3b64a5bdd67d79400c100258426a8562631b013))
* payment saga with HMAC-signed webhook and compensation ([#38](https://github.com/ndgkhoa/order-management-api/issues/38)) ([d0b8625](https://github.com/ndgkhoa/order-management-api/commit/d0b86252adb3ef83538922a410546a476907f557))
* permission-based multi-role RBAC ([0658134](https://github.com/ndgkhoa/order-management-api/commit/06581346a81c6e8cd4099bc3521808189f4b7f05))
* **products:** catalog with admin CRUD and Redis cache ([034dec9](https://github.com/ndgkhoa/order-management-api/commit/034dec9aa6a82bbd8a9da74fbe5c33e552054e7b))
* **products:** catalog with admin CRUD, Redis cache, and role enum ([868afd2](https://github.com/ndgkhoa/order-management-api/commit/868afd21a0bf264eda56e03a01dfa892cfcba96d))
* redis-backed idempotency-key layer and rate limiting ([6e4d228](https://github.com/ndgkhoa/order-management-api/commit/6e4d2286c36ceefe849db0fbd4e72416edd9925a))
* redis-backed idempotency-key layer and rate limiting ([072a46e](https://github.com/ndgkhoa/order-management-api/commit/072a46e728e1f06aa7390d2442d8af4abd7b76d7))
* saga metrics, end-to-end tests and architecture docs ([#42](https://github.com/ndgkhoa/order-management-api/issues/42)) ([8f08289](https://github.com/ndgkhoa/order-management-api/commit/8f08289a86cac57d63e5ecc408b89032aa002fb8))
* **saga:** foundation — Redis, event envelope, composite dedup, RBAC ([7372d54](https://github.com/ndgkhoa/order-management-api/commit/7372d54369be5e1b619ec7fbe8d6f55826ce4247))


### Bug Fixes

* **docker:** route the mock payment webhook to the api service ([0832888](https://github.com/ndgkhoa/order-management-api/commit/08328884e125b800feb8b107477b67517a9a5a94))
* show 0% instead of No data on 5xx error rate panel ([611ec4c](https://github.com/ndgkhoa/order-management-api/commit/611ec4c0310b72727d90d15106141b7084968e85))

## [0.1.5](https://github.com/ndgkhoa/order-management-api/compare/v0.1.4...v0.1.5) (2026-07-05)

### Features

- **auth:** permission-based multi-role RBAC ([0658134](https://github.com/ndgkhoa/order-management-api/commit/06581346a81c6e8cd4099bc3521808189f4b7f05))

### Bug Fixes

- **docker:** route the mock payment webhook to the api service ([0832888](https://github.com/ndgkhoa/order-management-api/commit/08328884e125b800feb8b107477b67517a9a5a94))

## [0.1.4](https://github.com/ndgkhoa/order-management-api/compare/v0.1.3...v0.1.4) (2026-07-04)

### Features

- **payments:** payment saga with HMAC-signed webhook and compensation ([#38](https://github.com/ndgkhoa/order-management-api/issues/38)) ([d0b8625](https://github.com/ndgkhoa/order-management-api/commit/d0b86252adb3ef83538922a410546a476907f557))
- **shipping:** order lifecycle, fake shipping and pre-ship cancel/refund ([#40](https://github.com/ndgkhoa/order-management-api/issues/40)) ([72854d1](https://github.com/ndgkhoa/order-management-api/commit/72854d132812bdd11a5b752c97d09fa522c084d7))
- **notifications:** channel-agnostic notification system for saga events ([#41](https://github.com/ndgkhoa/order-management-api/issues/41)) ([3990746](https://github.com/ndgkhoa/order-management-api/commit/3990746d41a868444e1e21783815f82d3581e537))
- **observability:** saga metrics, end-to-end tests and architecture docs ([#42](https://github.com/ndgkhoa/order-management-api/issues/42)) ([8f08289](https://github.com/ndgkhoa/order-management-api/commit/8f08289a86cac57d63e5ecc408b89032aa002fb8))

## [0.1.3](https://github.com/ndgkhoa/order-management-api/compare/v0.1.2...v0.1.3) (2026-07-03)

### Features

- **db:** add products table and constrain user role to a pg enum ([499586d](https://github.com/ndgkhoa/order-management-api/commit/499586d73ca063c2ce18947facd60546ac439f95))
- **inventory:** reserve stock on order-created with saga compensation ([db4e633](https://github.com/ndgkhoa/order-management-api/commit/db4e633a18d8bc916687d3409b74d2a2a1c84fb3))
- **openapi:** document JWT auth, tags, and error responses ([fa916e2](https://github.com/ndgkhoa/order-management-api/commit/fa916e2c9f7f86b0da18deb8bff60ab501cd078f))
- **orders:** reshape into a multi-line aggregate with price snapshots ([a3b64a5](https://github.com/ndgkhoa/order-management-api/commit/a3b64a5bdd67d79400c100258426a8562631b013))
- **products:** catalog with admin CRUD and Redis cache ([034dec9](https://github.com/ndgkhoa/order-management-api/commit/034dec9aa6a82bbd8a9da74fbe5c33e552054e7b))
- **idempotency:** redis-backed idempotency-key layer and rate limiting ([072a46e](https://github.com/ndgkhoa/order-management-api/commit/072a46e728e1f06aa7390d2442d8af4abd7b76d7))

## [0.1.2](https://github.com/ndgkhoa/order-management-api/compare/v0.1.1...v0.1.2) (2026-06-23)

### Features

- **observability:** add Loki log aggregation with Alloy collector ([743c160](https://github.com/ndgkhoa/order-management-api/commit/743c16033704226c4afe4b31f613584b7ae22773))
- **auth:** add Redis plugin, requireRole guard, role in JWT, admin seed ([852d0ba](https://github.com/ndgkhoa/order-management-api/commit/852d0ba1b0e39513cb43b7e6d65a7ac8c87ac545))
- **db:** add event-id/correlation-id columns, composite dedup PK, users.role ([f7252b8](https://github.com/ndgkhoa/order-management-api/commit/f7252b8ef7b92e06c7cedad57fd06843842a6873))
- **mq:** versioned event envelope published by relay; per-consumer dedup ([8562ae6](https://github.com/ndgkhoa/order-management-api/commit/8562ae674282fc1985e2a28ca99012e3fc087098))

### Bug Fixes

- **observability:** show 0% instead of No data on 5xx error rate panel ([611ec4c](https://github.com/ndgkhoa/order-management-api/commit/611ec4c0310b72727d90d15106141b7084968e85))

## [0.1.1](https://github.com/ndgkhoa/fastify-drizzle/compare/v0.1.0...v0.1.1) (2026-06-17)

### Features

- **auth:** add users and auth modules ([4a4832b](https://github.com/ndgkhoa/fastify-drizzle/commit/4a4832b948bbcdb458468b0c8917935800822ceb))
- **db:** add drizzle data layer ([6e9d1ab](https://github.com/ndgkhoa/fastify-drizzle/commit/6e9d1ab8f2a1f790a77ef4fd40ebbada8bc429a1))
- **core:** add fastify app, plugins, health and graceful shutdown ([5441323](https://github.com/ndgkhoa/fastify-drizzle/commit/5441323f4a6481976793cf672856c87dfa92dab8))
- **infra:** add local docker stack ([0facf38](https://github.com/ndgkhoa/fastify-drizzle/commit/0facf381755e898ffc37f738311028a0e4835b93))
- **observability:** add metrics, tracing, and sentry ([8fe22fd](https://github.com/ndgkhoa/fastify-drizzle/commit/8fe22fd185095435093d8ac553eeb02058d57777))
- **orders:** add module with transactional outbox ([a658390](https://github.com/ndgkhoa/fastify-drizzle/commit/a6583903838d2172752c6988d40f2f45549c61cf))
- **mq:** add rabbitmq publisher and idempotent email worker ([a1ad05d](https://github.com/ndgkhoa/fastify-drizzle/commit/a1ad05da6d52ce96a4954a8a586b7c8043c0fbda))
- **observability:** provision Grafana dashboard as code ([1a49cef](https://github.com/ndgkhoa/fastify-drizzle/commit/1a49cef6668e6a04ea3c429c865af91addba3579))
