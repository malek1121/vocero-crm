import { expect, test } from "@playwright/test";

test("health endpoint confirms the database is reachable", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toEqual({ ok: true });
});

test("login page renders with the browser security baseline", async ({ page }) => {
  const response = await page.goto("/login");
  expect(response).not.toBeNull();
  expect(response!.status()).toBe(200);
  expect(response!.headers()["content-security-policy"]).toContain("default-src 'self'");
  expect(response!.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response!.headers()["x-frame-options"]).toBe("DENY");
  await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
  await expect(page.getByLabel("Correo")).toBeVisible();
  await expect(page.getByLabel("Contraseña")).toBeVisible();
});

test("unauthenticated visitors cannot open the inbox", async ({ page }) => {
  await page.goto("/inbox");
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
});

test("private APIs reject unauthenticated requests", async ({ request }) => {
  const response = await request.get("/api/conversations");
  expect(response.status()).toBe(401);
  const body = (await response.json()) as { error?: { code?: string } };
  expect(body.error?.code).toBe("unauthorized");
});
