# W1-05｜Apple Mock Integration Release

Status: Windows Mock server release path verified; Mac/iPhone last-hop
integration remains an Apple Owner manual check.
Contract: frozen Contract v1 (`1.0`).  
Owner boundary: W1 provides the backend release and integration support;
Apple configuration remains M1/M2 work.

## 1. Release purpose

This release lets a Mac or physical iPhone call the Mock service graph
running on a Windows machine:

```text
Apple device
  → trusted local network
  → Windows HOST:PORT
  → real Fastify HTTP routes
  → real Rest/Handoff application services
  → CannedAgentLLM + FixtureMailProvider
  → Contract v1 response with X-Hush-Data-Origin: mock
```

It adds no product feature, Gmail integration, Photon integration, or new
contract.

## 2. Prerequisites

On Windows:

```powershell
node --version
corepack pnpm --version
```

Required:

```text
Node.js 20.19.5 (supported range >=20.19 <21)
pnpm 9.15.9 (supported range >=9 <10)
```

Install repository dependencies before the integration session:

```powershell
cd D:\path\to\rest\server
corepack pnpm install
```

Do not upgrade dependencies or regenerate the lockfile during the integration
session.

## 3. Listener safety model

Default startup is loopback-only:

```text
HOST=127.0.0.1
PORT=3000
```

This is the safe default and is not reachable from another machine.

Trusted-LAN integration must be explicitly enabled:

```text
HOST=0.0.0.0
```

`0.0.0.0` means the process listens on all Windows network interfaces. It is
not an access-control mechanism. Access must still be limited with the
Windows Private network profile and firewall.

Automated vertical-slice tests remain isolated: they listen on
`127.0.0.1` with an OS-assigned random port.

## 4. Start the Mock Server on Windows

Use session environment variables so no secret is written to the repository:

```powershell
cd D:\path\to\rest

$env:HOST = "0.0.0.0"
$env:PORT = "3000"
$env:PUBLIC_BASE_URL = "http://<windows-lan-ipv4>:3000"
$env:HUSH_DEMO_MODE = "true"
$env:HUSH_DEMO_TOKEN = [guid]::NewGuid().ToString("N")
$env:LOG_LEVEL = "info"

Write-Host "Share this token only with the Apple integrator:"
Write-Host $env:HUSH_DEMO_TOKEN

cd server
corepack pnpm dev
```

`PUBLIC_BASE_URL` is currently validated but not consumed by W1 routes or the
listener; setting it documents the intended callback/base address for future
adapters and does not expose the server by itself.

For a built release:

```powershell
cd D:\path\to\rest\server
corepack pnpm build
corepack pnpm start
```

The token above exists only in the current PowerShell process. Never put the
actual token in `.env.example`, source code, screenshots, commits, or chat
history.

The server still requires both:

```text
server HUSH_DEMO_MODE=true
+
correct request X-Hush-Demo-Token
```

A request header alone can never enable Sample Mode.

## 5. Find the Windows LAN IPv4 address

First inspect active network profiles:

```powershell
Get-NetConnectionProfile
```

Use a trusted network whose `NetworkCategory` is `Private`.

List likely LAN IPv4 addresses:

```powershell
Get-NetIPConfiguration |
  Where-Object { $_.IPv4DefaultGateway -ne $null } |
  ForEach-Object { $_.IPv4Address.IPAddress }
```

Alternative:

```powershell
ipconfig
```

Choose the IPv4 address belonging to the Wi-Fi/Ethernet adapter shared with
the Apple device, usually similar to `192.168.x.x` or `10.x.x.x`.

Example Apple Base URL:

```text
http://192.168.1.42:3000
```

An iPhone or another Mac must not use:

```text
http://127.0.0.1:3000
```

On those devices, `127.0.0.1` means the Apple device itself.

## 6. Windows Firewall

Prefer an already trusted Private network. If Windows Firewall blocks the
connection, an administrator may add a narrowly scoped temporary rule:

```powershell
New-NetFirewallRule `
  -DisplayName "Hush Mock Server 3000 (Private LAN)" `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 3000 `
  -Profile Private `
  -RemoteAddress LocalSubnet
```

Do not create an `Any` profile / `Any` remote-address rule. Do not expose the
local server through router port forwarding, public Wi-Fi, tunnels, or a
public cloud IP. The LAN endpoint is plain HTTP; the demo token does not
encrypt traffic.

## 7. First connectivity check

Windows:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/v1/health
Invoke-RestMethod http://<windows-lan-ipv4>:3000/v1/health
```

Mac:

```bash
curl -i http://<windows-lan-ipv4>:3000/v1/health
```

iPhone:

- connect to the same trusted Wi-Fi;
- open `http://<windows-lan-ipv4>:3000/v1/health` in Safari for a basic
  transport check;
- the native App must separately satisfy local-network privacy and ATS
  requirements.

Expected body:

```json
{
  "status": "ok",
  "contract_version": "1.0"
}
```

Health does not select Sample Mode. Rest/Handoff requests must send the
headers below.

## 8. Required Sample Mode headers

```text
X-Request-ID: <new opaque id for each HTTP request>
X-Client-Version: <Apple app version>
X-Contract-Version: 1.0
X-Hush-Demo-Token: <runtime token shared by W1>
```

Additionally:

```text
POST /v1/handoff/start
Idempotency-Key: <stable key for the logical start>
```

The JSON body's `request_id` must exactly match `X-Request-ID`.

The Apple client must verify:

```text
X-Request-ID matches the request
X-Contract-Version = 1.0
X-Hush-Data-Origin = mock
```

When origin is `mock`, the UI must display `SAMPLE MODE`.

## 9. Apple integration checklist

The Windows-side loopback/TCP Mock flow, protected Demo graph, smoke script,
and Contract responses are verified. The items below that require a Mac,
physical iPhone, ATS, or Local Network permission are not verified by W1 and
remain the final manual hop.

- [ ] Windows uses Node 20.19.5 and pnpm 9.15.9.
- [ ] Windows and Apple device are on the same trusted LAN.
- [ ] Windows network profile is Private.
- [ ] Server explicitly uses `HOST=0.0.0.0`.
- [ ] `/v1/health` works through the Windows LAN IPv4 address.
- [ ] Base URL is runtime-configurable in the Apple debug build.
- [ ] iPhone does not use `127.0.0.1`.
- [ ] Demo token is injected at runtime and not committed.
- [ ] Client sends a new Request ID for every HTTP call.
- [ ] Body/header Request IDs match.
- [ ] Client checks Contract Version and Data Origin headers.
- [ ] Rest check-in and fixed Quest recommendation decode successfully.
- [ ] Handoff start returns a `job_id`.
- [ ] Client polls until a terminal state.
- [ ] Open Loops Only Pause Receipt renders all coverage fields.
- [ ] App visibly labels Mock data.
- [ ] LAN listener and temporary firewall rule are removed after testing.

## 10. Rest integration flow

Use the exact request bodies from
`14_APPLE_CLIENT_INTEGRATION_KIT.md`.

Sequence:

```text
POST /v1/rest/check-in
  → needs_follow_up=true or false

if true:
POST /v1/rest/check-in with follow_up_answer
  → client must not ask a third follow-up

POST /v1/rest/recommend
  → content_version=1.0.0
  → quest_id must exist in the Apple fixed content bundle
```

The backend returns only a fixed-library Quest ID. The Apple client must not
render arbitrary model-generated Quest steps.

## 11. Handoff integration and polling

For the first cross-machine session use:

```text
include_gmail=false
response_channel=app
at least one user-submitted open_loop
```

Sequence:

```text
POST /v1/handoff/start
  → HTTP 202
  → status=queued
  → persist job_id and Idempotency-Key

every 2 seconds:
GET /v1/handoff/{job_id}
  → queued | running | succeeded | failed | cancelled

stop on:
succeeded | failed | cancelled
```

Fast Mock jobs may move directly from the queued start response to succeeded
between polls. The client must not require observing each running stage.

Successful Open Loops Only output must include:

```text
pause_receipt.coverage.included_sources
pause_receipt.coverage.excluded_sources
pause_receipt.held_items
pause_receipt.tomorrow_first_step
pause_receipt.conclusion
pause_receipt.coverage_note
```

Retry Handoff start only with the identical body and identical
`Idempotency-Key`.

## 12. Request ID troubleshooting

Apple logs should record only:

```text
timestamp
request_id
method
path
HTTP status
X-Contract-Version
X-Hush-Data-Origin
job_id
error.code
```

Do not log the demo token, authorization headers, open-loop text, or email
content.

For a cross-machine issue, send W1:

1. Request ID;
2. method and endpoint;
3. timestamp/timezone;
4. HTTP status and `error.code`;
5. Job ID for Handoff;
6. Data Origin;
7. Apple client version;
8. Windows LAN Base URL with the final IP segment redacted if shared outside
   the team.

W1 searches server logs by Request ID. A Handoff Job ID correlates its start,
processing, and polls, while each poll keeps its own Request ID.

## 13. Common errors

| Symptom | Likely cause | Action |
|---|---|---|
| Connection refused | Server stopped, wrong IP/port, or `HOST=127.0.0.1` | Check process, LAN IPv4, `HOST`, and `PORT` |
| Request times out | Firewall, Public network profile, guest Wi-Fi isolation | Use trusted Private LAN; verify LocalSubnet rule |
| Safari works, native App fails | Apple local-network privacy or ATS | Complete Apple Owner Action Items |
| `403 DEMO_MODE_DISABLED` | Server flag off or token missing/wrong | Check runtime environment without logging token |
| `400 INVALID_REQUEST` | Header/body Request ID mismatch or invalid enum | Compare payload to Contract v1 |
| `409 CONTRACT_VERSION_UNSUPPORTED` | Client version header not `1.0` | Stop integration and align contract version |
| `404 JOB_NOT_FOUND` after restart | In-memory Job state was lost | Start a new Handoff after user action |
| Expected Demo but response is rejected or origin is not `mock` | Demo flag/token mismatch or wrong endpoint configuration | Stop; verify server flag and runtime token without logging it |
| iPhone cannot reach `127.0.0.1` | Loopback points to iPhone | Use Windows LAN IPv4 address |

## 14. Apple Owner Action Items

W1 does not modify these settings.

1. Add an appropriate `NSLocalNetworkUsageDescription` to the containing
   App's Info.plist. Apple documents that direct unicast connections to local
   hosts are included, not only Bonjour.
2. Trigger the first LAN request while the App is in the foreground so the
   local-network permission prompt can be presented. If denied, re-enable it
   under Settings → Privacy & Security → Local Network.
3. Review ATS for the debug/integration target. Apple documents
   `NSAllowsLocalNetworking` for unqualified domains, `.local` domains, and
   IPv4/IPv6 addresses. Prefer this narrow local-network declaration over a
   global `NSAllowsArbitraryLoads`.
4. Keep LAN Base URL and demo token in debug runtime configuration. Do not
   hardcode them in Swift or ship them in a production build.
5. No Bonjour discovery is used in W1-05, so this release does not require
   W1 to define Bonjour service types or multicast behavior.

Apple references:

- `NSLocalNetworkUsageDescription`:
  <https://developer.apple.com/documentation/bundleresources/information-property-list/nslocalnetworkusagedescription>
- TN3179, local network privacy:
  <https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy>
- `NSAllowsLocalNetworking`:
  <https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking>

## 15. Stop LAN access and remove firewall rule

Stop the server:

```text
Ctrl+C
```

Restore safe loopback behavior in the current PowerShell session:

```powershell
$env:HOST = "127.0.0.1"
Remove-Item Env:HUSH_DEMO_TOKEN -ErrorAction SilentlyContinue
$env:HUSH_DEMO_MODE = "false"
```

Or close the PowerShell window to discard all session variables.

Remove the temporary firewall rule from an administrator PowerShell:

```powershell
Remove-NetFirewallRule `
  -DisplayName "Hush Mock Server 3000 (Private LAN)"
```

Confirm the port is no longer listening:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen `
  -ErrorAction SilentlyContinue
```

## 16. Current real and Mock capabilities

| Capability | Current state |
|---|---|
| Fastify TCP/HTTP API | Real |
| Request/contract/error validation | Real |
| Rest application service | Real |
| Handoff Job, polling, idempotency | Real, process-local memory |
| Terminal Job/claim cleanup | Five-minute-throttled opportunistic in-memory cleanup |
| Rest Quest library | Fixed local sample content |
| Sample Mode selection | Real server flag + token validation |
| Agent in Sample Mode | `CannedAgentLLM` |
| Mail in Sample Mode | `FixtureMailProvider` |
| Open Loops Only | Real application flow |
| Gmail Provider/OAuth | Not implemented by W1 |
| Photon/iMessage | Not implemented by W1 |
| Windows Mock TCP/Contract path | Verified |
| Mac/iPhone final LAN, ATS, and permission hop | Not yet verified; Apple Owner responsibility |
| HTTPS on trusted-LAN server | Not provided |

The local server is for a short trusted-LAN integration session, not public
hosting.
