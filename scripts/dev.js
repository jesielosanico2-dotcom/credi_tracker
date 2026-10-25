const http = require("node:http");
const net = require("node:net");
const { spawn } = require("node:child_process");

const port = Number(process.env.PORT || 3000);

function isPortAvailable() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        resolve(false);
      } else {
        reject(error);
      }
    });
    probe.listen(port, "127.0.0.1", () => {
      probe.close((error) => error ? reject(error) : resolve(true));
    });
  });
}

function isCreditTrackerRunning() {
  return new Promise((resolve) => {
    const request = http.get(
      { hostname: "127.0.0.1", port, path: "/api/health", timeout: 1500 },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => {
          try {
            resolve(response.statusCode === 200 && JSON.parse(body).status === "ok");
          } catch {
            resolve(false);
          }
        });
      }
    );
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

async function start() {
  if (!(await isPortAvailable())) {
    if (await isCreditTrackerRunning()) {
      console.log(`Credit Tracker is already running at http://127.0.0.1:${port}`);
      return;
    }
    console.error(`Port ${port} is already in use by another app. Set PORT to a free port and try again.`);
    process.exitCode = 1;
    return;
  }

  const server = spawn(process.execPath, ["--watch", "src/server.js"], { stdio: "inherit" });
  server.once("error", (error) => {
    console.error("Could not start the Credit Tracker development server:", error.message);
    process.exitCode = 1;
  });
  server.once("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}

start().catch((error) => {
  console.error("Could not check whether the Credit Tracker port is available:", error.message);
  process.exitCode = 1;
});
