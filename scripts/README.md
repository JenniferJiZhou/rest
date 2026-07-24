# Scripts

Implemented:

- `smoke-w1-vertical-slice.ps1` — exercises an already-running W1 server over
  HTTP, including protected Sample Mode when `-DemoToken` is provided. It
  does not contain or persist a token.

Planned:

- `seed-gmail.ts`
- `clear-demo-drafts.ts`
- `gen-qr.ts`
- `validate-contracts.ts`
- `smoke-test.sh`
- `deploy.sh`

Scripts must not contain secrets. Use environment variables.
