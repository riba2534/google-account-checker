import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Fixed, obviously fake values so tests never depend on real secrets.
const TEST_SECRETS = {
  DEEPSEEK_API_KEY: "test-deepseek-key",
  GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  CARD_ENCRYPTION_KEY: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
  ADMIN_USERNAMES: "rootadmin",
  INVITE_CODE: "",
};

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./wrangler.jsonc", environment: "test" },
            miniflare: {
              bindings: { ...TEST_SECRETS, TEST_MIGRATIONS: await readD1Migrations("./migrations") },
            },
          })),
        ],
        test: {
          name: "worker",
          include: ["test/**/*.test.ts"],
          setupFiles: ["./test/apply-migrations.ts"],
        },
      },
      {
        test: {
          name: "web",
          environment: "node",
          include: ["src/web/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});
