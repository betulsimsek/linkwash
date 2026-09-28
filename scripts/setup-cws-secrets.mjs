// Gets a fresh Chrome Web Store OAuth refresh token and stores it, together
// with the OAuth client ID and secret, as GitHub Actions secrets.
// Nothing is printed or written to disk; values go straight to `gh secret set`.
//
// Usage (in your own terminal, not through a chat):
//   node scripts/setup-cws-secrets.mjs [owner/repo ...]
// Default repos: betulsimsek/linkwash betulsimsek/sp-poker-extension
// Needs: an OAuth client of type "Desktop app" in Google Cloud, and `gh` logged in.
import http from "node:http";
import { execFileSync, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

const repos = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["betulsimsek/linkwash", "betulsimsek/sp-poker-extension"];

function ask(question) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Reads a line in raw mode without echoing it; shows only a character count.
function askHidden(question) {
  return new Promise(resolve => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) return resolve(ask(question));
    let value = "";
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = chunk => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(value.trim());
          return;
        }
        if (ch === "\u0003") process.exit(130);
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
      stdout.write(`\r${question}[${value.length} characters]\u001b[K`);
    };
    stdin.on("data", onData);
  });
}

const clientId = await ask("OAuth client ID: ");
const clientSecret = await askHidden("OAuth client secret (hidden): ");
if (!/^GOCSPX-[\w-]{28}$/.test(clientSecret)) {
  const go = await ask(`Got ${clientSecret.length} characters; Google client secrets are usually "GOCSPX-" + 28 (35 in total). Was it pasted twice? Continue anyway? [y/N] `);
  if (go.toLowerCase() !== "y") process.exit(1);
}
if (!clientId || !clientSecret) {
  console.error("Client ID and secret are required.");
  process.exit(1);
}

const server = http.createServer();
await new Promise(r => server.listen(0, "127.0.0.1", r));
const redirectUri = `http://127.0.0.1:${server.address().port}`;

const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: "code",
  scope: "https://www.googleapis.com/auth/chromewebstore",
  access_type: "offline",
  prompt: "consent"
});

const code = await new Promise((resolve, reject) => {
  server.on("request", (req, res) => {
    const params = new URL(req.url, redirectUri).searchParams;
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (params.get("code")) {
      res.end("<h2>Done. You can close this tab and go back to the terminal.</h2>");
      resolve(params.get("code"));
    } else {
      res.end("<h2>Authorization failed: " + (params.get("error") || "no code") + "</h2>");
      reject(new Error(params.get("error") || "no code"));
    }
  });
  console.log("Opening the Google consent page in your browser...");
  spawnSync("open", [authUrl]);
});
server.close();

const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" })
});
const token = await tokenRes.json();
if (!token.refresh_token) {
  console.error("No refresh token returned:", token.error || tokenRes.status, token.error_description || "");
  process.exit(1);
}

const secrets = {
  CHROME_CLIENT_ID: clientId,
  CHROME_CLIENT_SECRET: clientSecret,
  CHROME_REFRESH_TOKEN: token.refresh_token
};
for (const repo of repos) {
  for (const [name, value] of Object.entries(secrets)) {
    execFileSync("gh", ["secret", "set", name, "-R", repo], { input: value, stdio: ["pipe", "ignore", "inherit"] });
  }
  console.log(`✓ ${repo}: CHROME_CLIENT_ID, CHROME_CLIENT_SECRET, CHROME_REFRESH_TOKEN updated`);
}
