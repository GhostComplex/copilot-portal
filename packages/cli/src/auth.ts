import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

// GitHub Copilot's official OAuth App
const GITHUB_CLIENT_ID = "Iv1.b507a08c87ecfe98";
const GITHUB_SCOPE = "read:user";

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

interface TokenErrorResponse {
  error: string;
  error_description?: string;
}

export async function auth(options: { save?: boolean; refresh?: boolean }) {
  console.log("Starting GitHub Device Flow authentication...\n");

  // Step 1: Request device code
  const deviceRes = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      scope: GITHUB_SCOPE,
    }),
  });

  if (!deviceRes.ok) {
    throw new Error(`Failed to get device code: ${deviceRes.status}`);
  }

  const deviceData = (await deviceRes.json()) as DeviceCodeResponse;

  // Step 2: Show user the code
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Open: ${deviceData.verification_uri}`);
  console.log(`  Enter code: ${deviceData.user_code}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log("Waiting for authorization...");

  // Step 3: Poll for token
  const token = await pollForToken(
    deviceData.device_code,
    deviceData.interval,
    deviceData.expires_in
  );

  console.log("\n✅ Authorization successful!\n");

  // Step 4: Output/save token
  if (options.save) {
    const tokenPath = join(homedir(), ".copilot-gate", "token");
    await mkdir(dirname(tokenPath), { recursive: true });
    await writeFile(tokenPath, token, { mode: 0o600 });
    console.log(`Token saved to: ${tokenPath}`);
  }

  console.log("\nYour OAuth Token:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(token);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("\nUse this token as your Authorization header:");
  console.log(`  Authorization: Bearer ${token}`);
}

async function pollForToken(
  deviceCode: string,
  interval: number,
  expiresIn: number
): Promise<string> {
  const startTime = Date.now();
  const expiresAt = startTime + expiresIn * 1000;

  while (Date.now() < expiresAt) {
    await sleep(interval * 1000);

    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const data = (await res.json()) as TokenResponse | TokenErrorResponse;

    if ("access_token" in data) {
      return data.access_token;
    }

    if ("error" in data) {
      switch (data.error) {
        case "authorization_pending":
          // User hasn't authorized yet, keep polling
          process.stdout.write(".");
          break;
        case "slow_down":
          // We're polling too fast, increase interval
          interval += 5;
          break;
        case "expired_token":
          throw new Error("Device code expired. Please try again.");
        case "access_denied":
          throw new Error("Authorization denied by user.");
        default:
          throw new Error(
            data.error_description || `OAuth error: ${data.error}`
          );
      }
    }
  }

  throw new Error("Authorization timed out. Please try again.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
