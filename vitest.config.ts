import { defineConfig } from "vitest/config";
import path from "path";
import fs from "fs";

// Load .env.local for tests
const envFile = path.resolve(__dirname, ".env.local");
if (fs.existsSync(envFile)) {
  const envContent = fs.readFileSync(envFile, "utf-8");
  envContent.split("\n").forEach((line) => {
    if (line.trim() && !line.startsWith("#")) {
      const [key, ...valueParts] = line.split("=");
      const value = valueParts.join("=");
      if (key && value) {
        process.env[key] = value;
      }
    }
  });
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
