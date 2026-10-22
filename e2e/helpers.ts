import { expect, type Page } from "@playwright/test";

export const DEMO = { email: "demo@opslens.dev", password: "opslens-demo-123", org: "acme" };

export async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEMO.email);
  await page.getByLabel("Password").fill(DEMO.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`/${DEMO.org}$`));
}
