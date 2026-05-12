# Mobile Remote API

This desktop app exposes an optional local HTTP bridge for a phone app. It does not move the agent runtime to mobile. The Mac keeps running Electron, the harness, PTY, and DeepSeek TUI; mobile clients only observe progress and, when explicitly allowed, send control commands to the desktop session.

The bridge is disabled by default. Enable it in the `远程` inspector.

## Security Model

- Every endpoint except `GET /api/v1/health` requires a token.
- Read-only progress and remote control are separate toggles.
- `127.0.0.1` is the default bind host. Use `0.0.0.0 / LAN` only when the phone app needs same-network access.
- Desktop admin actions use the bridge token. Phone clients pair once and then use a device token.
- API keys are not persisted by this bridge. Mobile-started sessions use saved desktop settings and process environment.
- For access outside the same LAN, add a relay service or tunnel rather than exposing the port directly to the public internet.

Authentication headers:

```http
Authorization: Bearer <token>
```

or:

```http
x-deepseek-bridge-token: <token>
```

Paired phone auth:

```http
Authorization: Bearer <device-token>
```

or:

```http
x-deepseek-device-token: <device-token>
```

For SSE clients that cannot set headers, `GET /api/v1/events?token=<token>` is also accepted.

## Endpoints

### Health

```http
GET /api/v1/health
```

Returns `{ ok: true, requiresAuth: true }`.

### Status

```http
GET /api/v1/status
```

Returns bridge state, desktop harness state, active session metadata, terminal preview, and the latest update notice. The token is never returned over HTTP.

### Desktop Login

Desktop admin token required.

```http
POST /api/v1/auth/login
content-type: application/json

{
  "accountId": "user@example.com",
  "email": "user@example.com",
  "displayName": "West"
}
```

The desktop stores the account identity locally under Electron `userData`. This is the matching key used by phone pairing and update-push account targeting.

### Start Phone Pairing

Desktop admin token required.

```http
POST /api/v1/auth/pairing/start
```

Returns a six-digit pairing code, desktop id, account id, and expiry time. The code is valid for ten minutes.

### Pair Phone

No bridge token required; the pairing code is the temporary credential.

```http
POST /api/v1/auth/pair
content-type: application/json

{
  "accountId": "user@example.com",
  "pairingCode": "123456",
  "deviceName": "West iPhone",
  "platform": "ios",
  "clientDeviceId": "ios-installation-id",
  "pushProvider": "apns",
  "pushToken": "apns-or-fcm-device-token"
}
```

Returns a `deviceToken`. The phone app should store it securely and use it for `status`, `events`, and remote-control calls. The desktop keeps the paired device entry so update push matching can target the same account and known device ids.

### Auth State

```http
GET /api/v1/auth/state
```

Returns the signed-in account, desktop id, active pairing state, and paired devices.

### Revoke Phone

Desktop admin token required.

```http
POST /api/v1/devices/revoke
content-type: application/json

{
  "deviceId": "device_xxx"
}
```

### Live Events

```http
GET /api/v1/events
```

Server-Sent Events stream. Event names:

- `snapshot`: initial bridge and session state.
- `terminal-replay`: recent terminal buffer for late subscribers.
- `terminal`: live PTY output.
- `terminal-exit`: PTY exit payload.
- `bridge-status`: updated bridge/session state.
- `update-notice`: update notification payload.
- `bridge-error`: bridge server error payload.

### Start Session

Requires `mobileRemoteControlEnabled`.

```http
POST /api/v1/session/start
content-type: application/json

{
  "action": "exec",
  "prompt": "Run tests and summarize the result"
}
```

Allowed `action` values are `tui`, `continue`, `doctor`, `setup`, `mcp-init`, `sessions`, `exec`, and `plan`.

### Terminal Input

Requires `mobileRemoteControlEnabled`.

```http
POST /api/v1/terminal/input
content-type: application/json

{
  "data": "/status\n"
}
```

### Upsert Skill

Requires `mobileRemoteControlEnabled`.

This endpoint is intended for phone or voice clients that turn a spoken workflow into a reusable Skill. The desktop writes a `SKILL.md` under the active skills root and enables it by default.

```http
POST /api/v1/skills/upsert
content-type: application/json

{
  "name": "Daily report review",
  "description": "Use when preparing or reviewing a daily report before sending.",
  "content": "---\nname: daily-report-review\ndescription: Use when preparing or reviewing a daily report before sending.\n---\n\n# Daily Report Review\n\n..."
}
```

Set `"enable": false` to write the Skill without adding it to `enabledSkills`.

### Stop Session

Requires `mobileRemoteControlEnabled`.

```http
POST /api/v1/session/stop
```

### Update Push Notification

Requires `updatePushEnabled`.

```http
POST /api/v1/updates/push
content-type: application/json

{
  "accountId": "user@example.com",
  "version": "0.1.1",
  "title": "DeepSeek TUI Desktop update",
  "body": "A new signed Mac build is available.",
  "url": "https://example.com/releases/0.1.1"
}
```

If `accountId` is present, it must match the desktop login account. The desktop shows a native notification when supported and forwards an `update-notice` SSE event to connected mobile clients. The notice also includes `matchedDeviceIds`, so a future cloud relay can confirm which paired phone records match the push account.

## Phone App Flow

1. User signs into a push account in the desktop `远程` panel.
2. User enables the bridge and generates a phone pairing code.
3. Phone app signs into the same account and calls `POST /api/v1/auth/pair` with the pairing code.
4. Phone app stores the returned device token securely.
5. Phone app calls `GET /api/v1/status` and subscribes to `GET /api/v1/events` with the device token.
6. If remote control is enabled, phone app can call session/input/stop endpoints or `POST /api/v1/skills/upsert` with the device token.
7. Release infrastructure can call `POST /api/v1/updates/push` with the account id to notify the desktop and matched phone records.
