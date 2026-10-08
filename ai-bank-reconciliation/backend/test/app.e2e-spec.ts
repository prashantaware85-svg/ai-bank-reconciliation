import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/ (GET) returns a safe X-Request-Id correlation header (Step 16)', async () => {
    const generated = await request(app.getHttpServer()).get('/').expect(200);
    expect(generated.headers['x-request-id']).toMatch(
      /^[A-Za-z0-9._-]{1,128}$/,
    );
    const propagated = await request(app.getHttpServer())
      .get('/')
      .set('X-Request-Id', 'e2e-probe-42')
      .expect(200);
    expect(propagated.headers['x-request-id']).toBe('e2e-probe-42');
  });

  it('error responses keep the API format and carry X-Request-Id (Step 17)', async () => {
    // 401 via auth guard: goes through the logging filter, no DB hit.
    const denied = await request(app.getHttpServer())
      .get('/auth/me')
      .expect(401);
    expect(denied.headers['x-request-id']).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
    expect(denied.body).toHaveProperty('message');
    // 404 from Express: middleware still ran, header present.
    const missing = await request(app.getHttpServer())
      .get('/no-such-route-xyz')
      .expect(404);
    expect(missing.headers['x-request-id']).toMatch(
      /^[A-Za-z0-9._-]{1,128}$/,
    );
  });

  afterEach(async () => {
    await app.close();
  });
});
