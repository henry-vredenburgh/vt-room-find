import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:8087",
    launchOptions: {
      executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command: "python3 -m http.server 8087 --bind 127.0.0.1 --directory web",
    url: "http://127.0.0.1:8087",
    reuseExistingServer: false,
  },
});
