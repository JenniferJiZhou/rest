# Unified Inbox External Validation

Run this validation only with a Hush server and app already open on the
designated provider computer. Keep credentials in that computer's local
`.env`; do not place tokens, identifiers, or message contents in this runbook,
shell history shared with others, or source control.

The read command prints only validation counts and booleans. It does not print
message text, summaries, drafts, names, account identifiers, conversation
identifiers, or item identifiers. The send command is intentionally blocked
unless `HUSH_SMOKE_ALLOW_SEND=true` is set for that one command.

## Designated Feishu computer

1. Authenticate the official Feishu CLI to the personal current-user account.
2. Set only that computer's local `.env` values, including `LARK_CLI_PATH`,
   `LARK_ACCOUNT_ID`, Hush runtime settings, and the StepFun configuration.
3. Start Hush in the foreground and leave both the app and server running.
4. From another participant, send a new direct message and a new group message.
5. In a second terminal, set `HUSH_BASE_URL` and `HUSH_APP_TOKEN` only for the
   local session, then run:

   ```powershell
   cd server
   corepack pnpm smoke:inbox -- --provider feishu --mode read
   ```

   Verify in Hush that each group has one evolving digest card.
6. Open and acknowledge the exact displayed revision in Hush.
7. Send another group message, then rerun the read command and verify Hush
   creates a new card for the next digest window.
8. Inspect and edit the AI draft in Hush.
9. Check the provider, displayed conversation, final draft, and @ targets in
   Hush. Only then run the explicit send command:

   ```powershell
   $env:HUSH_SMOKE_ALLOW_SEND = "true"
   corepack pnpm smoke:inbox -- --provider feishu --mode send --item-id <item-id>
   ```

10. Confirm delivery in the real Feishu session.
11. Restart Hush, rerun the read command, and verify the checkpoint continues
    without losing the digest or creating a duplicate card.

## Designated DingTalk computer

1. Authenticate the official DingTalk CLI to the personal current-user account.
2. Set only local `.env` values, including `DWS_CLI_PATH`,
   `DINGTALK_ACCOUNT_ID`, Hush runtime settings, and the StepFun configuration.
3. Start Hush in the foreground and leave both the app and server running.
4. From another participant, send a new direct message and a new group message.
5. In a second terminal, set `HUSH_BASE_URL` and `HUSH_APP_TOKEN` only for the
   local session, then run:

   ```powershell
   cd server
   corepack pnpm smoke:inbox -- --provider dingtalk --mode read
   ```

   Verify in Hush that each group has one evolving digest card.
6. Open and acknowledge the exact displayed revision in Hush.
7. Send another group message, then rerun the read command and verify Hush
   creates a new card for the next digest window.
8. Inspect and edit the AI draft in Hush.
9. Check the provider, displayed conversation, final draft, and @ targets in
   Hush. Only then run the explicit send command:

   ```powershell
   $env:HUSH_SMOKE_ALLOW_SEND = "true"
   corepack pnpm smoke:inbox -- --provider dingtalk --mode send --item-id <item-id>
   ```

10. Confirm delivery in the real DingTalk session.
11. Restart Hush, rerun the read command, and verify the checkpoint continues
    without losing the digest or creating a duplicate card.
