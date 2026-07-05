import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { AppInstance } from '@/app';
import {
  buildTestApp,
  registerAndLogin,
  registerAdminAndLogin,
} from '@test/helpers/build-test-app';
import { resetDb } from '@test/helpers/reset-db';

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
let skuSeq = 0;
const newProduct = () => ({
  sku: `SKU-${Date.now()}-${skuSeq++}`,
  name: 'Widget',
  priceCents: 1500,
  stockAvailable: 10,
});

async function createProduct(app: AppInstance, token: string, body = newProduct()) {
  const res = await app.inject({
    method: 'POST',
    url: '/products',
    headers: auth(token),
    payload: body,
  });
  return { res, body };
}

describe('products API', () => {
  let app: AppInstance;
  beforeAll(async () => {
    app = await buildTestApp();
  });
  beforeEach(resetDb);

  it('admin creates a product → 201', async () => {
    const { token } = await registerAdminAndLogin(app);
    const { res } = await createProduct(app, token);
    expect(res.statusCode).toBe(201);
    const created = res.json<{ id: string; sku: string; stockAvailable: number }>();
    expect(created.id).toBeDefined();
    expect(created.stockAvailable).toBe(10);
  });

  it('customer cannot create → 403', async () => {
    const { token } = await registerAndLogin(app);
    const { res } = await createProduct(app, token);
    expect(res.statusCode).toBe(403);
  });

  it('anonymous cannot create → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/products', payload: newProduct() });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an invalid body (negative price) → 400', async () => {
    const { token } = await registerAdminAndLogin(app);
    const res = await app.inject({
      method: 'POST',
      url: '/products',
      headers: auth(token),
      payload: { ...newProduct(), priceCents: -1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('duplicate SKU → 409', async () => {
    const { token } = await registerAdminAndLogin(app);
    const body = newProduct();
    await createProduct(app, token, body);
    const { res } = await createProduct(app, token, body);
    expect(res.statusCode).toBe(409);
  });

  it('public list returns active products only', async () => {
    const { token } = await registerAdminAndLogin(app);
    const { res: activeRes } = await createProduct(app, token);
    const activeId = activeRes.json<{ id: string }>().id;
    const { res: inactiveRes } = await createProduct(app, token, {
      ...newProduct(),
      active: false,
    } as ReturnType<typeof newProduct>);
    const inactiveId = inactiveRes.json<{ id: string }>().id;

    const list = await app.inject({ method: 'GET', url: '/products' });
    expect(list.statusCode).toBe(200);
    const ids = list.json<Array<{ id: string }>>().map((p) => p.id);
    expect(ids).toContain(activeId);
    expect(ids).not.toContain(inactiveId);
  });

  it('GET missing product → 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/products/99999999-9999-9999-9999-999999999999',
    });
    expect(res.statusCode).toBe(404);
  });

  it('update invalidates the cache (second public GET reflects the change)', async () => {
    const { token } = await registerAdminAndLogin(app);
    const { res: createRes } = await createProduct(app, token);
    const id = createRes.json<{ id: string }>().id;

    const first = await app.inject({ method: 'GET', url: `/products/${id}` });
    expect(first.json<{ name: string }>().name).toBe('Widget');

    const upd = await app.inject({
      method: 'PATCH',
      url: `/products/${id}`,
      headers: auth(token),
      payload: { name: 'Gadget' },
    });
    expect(upd.statusCode).toBe(200);

    const second = await app.inject({ method: 'GET', url: `/products/${id}` });
    expect(second.json<{ name: string }>().name).toBe('Gadget');
  });

  it('re-activating a soft-deleted product re-exposes it in the public catalog', async () => {
    const { token } = await registerAdminAndLogin(app);
    const { res: createRes } = await createProduct(app, token);
    const id = createRes.json<{ id: string }>().id;

    await app.inject({ method: 'DELETE', url: `/products/${id}`, headers: auth(token) });
    let pub = await app.inject({ method: 'GET', url: `/products/${id}` });
    expect(pub.statusCode).toBe(404);

    const upd = await app.inject({
      method: 'PATCH',
      url: `/products/${id}`,
      headers: auth(token),
      payload: { active: true },
    });
    expect(upd.statusCode).toBe(200);

    pub = await app.inject({ method: 'GET', url: `/products/${id}` });
    expect(pub.statusCode).toBe(200);
  });

  it('soft delete hides the product from the public catalog → 204 then 404', async () => {
    const { token } = await registerAdminAndLogin(app);
    const { res: createRes } = await createProduct(app, token);
    const id = createRes.json<{ id: string }>().id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/products/${id}`,
      headers: auth(token),
    });
    expect(del.statusCode).toBe(204);

    const pub = await app.inject({ method: 'GET', url: `/products/${id}` });
    expect(pub.statusCode).toBe(404);

    const adminGet = await app.inject({
      method: 'GET',
      url: `/products/${id}`,
      headers: auth(token),
    });
    expect(adminGet.statusCode).toBe(200);
    expect(adminGet.json<{ active: boolean }>().active).toBe(false);
  });
});
