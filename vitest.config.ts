import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    env: {
      DATABASE_URL:
        "postgresql://subslice_app:password@localhost:5432/subslice_test?schema=public",
      FLW_SECRET_KEY: "FLWSECK_TEST-SANDBOXDEMOKEY-X",
      FLW_WEBHOOK_SECRET_HASH: "test_webhook_secret_hash_subslice",
      TOKEN_ENCRYPTION_KEY:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      APP_BASE_URL: "http://localhost:3000",
      SEED_USER_EMAIL: "ada@example.com",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/mocks/server-only.ts"),
    },
  },
});
