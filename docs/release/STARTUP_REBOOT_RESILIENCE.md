# Startup and reboot resilience

Priorena supports one macOS user LaunchAgent for a single-user local runtime. The controller generates and manages the exact label `com.priorena.local`; launches the exact resolved Node executable directly; runs `target-server/start.js` from one explicit release root; supplies explicit private data, Source-root, operational-log, and fixed-port arguments; and relies on the unchanged server contract to bind only to `127.0.0.1`.

Source publication does not install, load, replace, restart, or remove this agent. Every live action in this runbook requires separate exact operational authority. A merge or source release alone grants none of that authority.

## Security contract

The controller is intentionally narrow:

- macOS user-login persistence only; no system daemon, root operation, installer, updater, hosted service, LAN exposure, or multi-user behavior;
- one stable generic label and the current process user's `gui/<uid>` domain only;
- no shell, `PATH` lookup, environment interpolation, profile reading, process discovery, wildcard, arbitrary launchd label, or arbitrary destination;
- an explicit canonical release root, resolved Node executable, private data file, private Source root, private operational log, and current-user home;
- a fixed local runtime port of `3100`; no host override exists;
- deterministic bounded plist bytes, validated with `/usr/bin/plutil` before any activation-capable operation;
- deterministic registration convergence after each successful bootout or bootstrap: at most 25 exact-label read-only checks, separated by at most 24 waits of 200 milliseconds, with no repeated mutation while polling;
- `RunAtLoad`, restart only after an unsuccessful exit, and a 30-second throttle to avoid a tight failure loop;
- launchd stdout and stderr directed to `/dev/null`; the existing bounded mode-`0600` operational log remains authoritative;
- same-directory atomic publication, retained private prior bytes for replacement rollback, exact registration verification, and automatic prior-state restoration after a failed transaction;
- action-specific acknowledgements for every write, replacement, registration, bootout, rollback, and removal;
- bounded status and error codes that omit raw paths, plist bytes, data values, Source names or content, child output, and credentials.

The controller never stops an independently running Priorena process before installation. Process cutover remains a separate operation using the existing exact PID, command, working-directory, executable, and loopback-port protections. An authorized operator must resolve any existing runtime or port conflict before asking launchd to start Priorena.

## Explicit placeholders

Every token in angle brackets below is a placeholder, not a default. Resolve each value privately and use the same values throughout one operation:

- `<RELEASE_ROOT>`: canonical absolute release checkout containing the private `priorena` package and `target-server/start.js`;
- `<NODE_EXECUTABLE>`: canonical absolute regular executable, normally the resolved executable recorded for the approved release;
- `<PRIVATE_DATA_FILE>`: canonical absolute regular non-symlink schema-v5 file with mode `0600`, outside the repository;
- `<PRIVATE_SOURCE_ROOT>`: canonical absolute non-symlink directory with no group or world permissions, outside the repository;
- `<PRIVATE_OPERATIONAL_LOG>`: canonical absolute log destination outside the repository with no symlinked ancestor into it; an existing file must be regular, non-symlink, and mode `0600`;
- `<CURRENT_USER_HOME>`: canonical absolute home of the current macOS user, owned by that user and not group/world-writable;
- `<EXACT_PID>`: PID established later through separately authorized launchd/process evidence;
- `<EXPECTED_COMMAND_FRAGMENT>`: exact approved `target-server/start.js` command fragment.

`<CURRENT_USER_HOME>/Library/LaunchAgents` must already be a canonical, non-symlink directory owned by the current user and not group/world-writable. The controller does not create or discover it. It derives only these managed paths:

```text
<CURRENT_USER_HOME>/Library/LaunchAgents/com.priorena.local.plist
<CURRENT_USER_HOME>/Library/LaunchAgents/com.priorena.local.plist.previous
```

Do not use `~`, `$HOME`, shell substitutions, relative paths, symlink aliases, copied paths from logs, or values discovered from a running Priorena process. Do not place resolved private values in Git, issues, pull requests, task reports, screenshots, or public logs.

## Read-only planning

Planning validates every explicit trust boundary, generates deterministic bytes in memory, and asks `plutil` to lint those bytes through standard input. It writes no file and makes no `launchctl` call.

The following is a placeholder template and is not ready to execute until separate operational authority exists and every angle-bracket token is privately resolved:

```bash
npm run release:startup -- plan \
  --repository-root "<RELEASE_ROOT>" \
  --node-executable "<NODE_EXECUTABLE>" \
  --data-file "<PRIVATE_DATA_FILE>" \
  --source-files-root "<PRIVATE_SOURCE_ROOT>" \
  --log-file "<PRIVATE_OPERATIONAL_LOG>" \
  --user-home "<CURRENT_USER_HOME>" \
  --port "3100"
```

A successful result reports only the generic label, fixed port, bounded definition metadata, current-user-domain category, and validated behavior. It does not print the generated plist or any supplied path.

## Read-only inspection

Inspection repeats full configuration and plist validation, reads only the exact managed definition and retained prior definition when present, and calls only:

```text
/bin/launchctl print gui/<CURRENT_UID>/com.priorena.local
```

The UID is derived from the controller process identity and is not accepted from the command line. Inspection never bootstraps, boots out, signals, writes, replaces, or removes anything.

Use the same explicit configuration template as `plan`, changing only the action to `inspect`. Interpret its bounded status as follows:

| Status | Meaning |
| --- | --- |
| `absent` | Neither the exact definition nor exact service is present. |
| `installed-not-registered` | The managed file exists but the service is not registered. Do not assume startup occurred. |
| `installed-and-registered` | The managed file and exact service are both present. Continue with process and application verification. |
| `service-without-definition` | The label is registered without the exact managed file. Stop; do not install or remove until ownership is resolved. |

`definitionMatches` compares the active private bytes with the deterministic definition for the supplied explicit values without returning either. `rollbackAvailable` reports only whether a valid private retained definition exists.

## Later separately authorized first installation

First installation requires the exact acknowledgement `INSTALL_PRIORENA_USER_AGENT`. It refuses an existing managed file, retained prior file, or already registered fixed label. It atomically publishes a mode-`0600` definition, bootstraps only the current GUI-user domain, waits for bounded exact-label registration convergence without issuing another bootstrap, and verifies the exact file bytes and exact label registration. A failed bootstrap or verification removes only the new definition and boots out only the exact label if necessary; failure to verify that rollback is a hard stop.

The authorized placeholder template is the `plan` template with action `install` and this additional pair:

```text
--acknowledgement INSTALL_PRIORENA_USER_AGENT
```

Because `RunAtLoad` is true, `launchctl bootstrap` may immediately start the configured runtime. Before executing installation, separately prove that no independent Priorena process or unrelated process owns port `3100`, and obtain explicit live-activation authority. The controller itself does not inspect or stop that process.

## Later separately authorized replacement

Replacement requires `REPLACE_PRIORENA_USER_AGENT`. It accepts only a valid managed active definition. Before bootout or replacement it stores the exact prior bytes, mode `0600`, at the fixed `.previous` path. If that retained file already exists, its bytes must exactly equal the active definition or replacement stops as ambiguous.

The transaction then:

1. records whether the exact label is registered;
2. boots out only `gui/<CURRENT_UID>/com.priorena.local` when registered;
3. waits for bounded exact-label absence after a successful bootout without issuing another bootout;
4. atomically replaces only the exact managed plist with already-linted bytes;
5. bootstraps only the exact current-user domain and exact managed destination;
6. waits for bounded exact-label registration after a successful bootstrap without issuing another bootstrap;
7. verifies the final definition bytes and exact registered label;
8. on failure, boots out only that exact label when necessary, waits for absence, atomically restores the prior bytes, makes at most one restoration bootstrap when the prior state was registered, waits for registration, verifies it, and stops.

A replacement failure retains the existing stable top-level codes and may also carry only allowlisted public-safe `phase` and `status` values. Candidate phases are `candidate-bootout`, `candidate-definition`, `candidate-bootstrap`, and `candidate-verification`. Restoration phases are `restoration-bootout`, `restoration-definition`, `restoration-bootstrap`, and `restoration-verification`. Status is limited to a bounded category such as `mutation-failed`, `inspection-failed`, `convergence-timeout`, `definition-failed`, or `verification-failed`. A failed restoration may additionally identify the candidate phase and status. No child result, UID, path, plist byte, process identity, or private value is included.

Use the complete explicit configuration describing the new intended definition, action `replace`, and:

```text
--acknowledgement REPLACE_PRIORENA_USER_AGENT
```

Replacement may stop a process owned by this exact registered agent. It does not identify, stop, replace, or signal an independently launched Priorena process. Coordinate source/runtime cutover separately before replacement.

## Later separately authorized rollback

Rollback requires `ROLLBACK_PRIORENA_USER_AGENT` and the complete explicit configuration expected in the retained prior bytes. The retained file must be a valid managed definition and match the deterministic bytes for those supplied values. The controller preserves the former registration state: a registered agent is booted out, restored, bootstrapped, and verified; an unregistered definition is restored without registration. Any failed rollback attempts to restore and verify the formerly active definition and registration state exactly once.

Use action `rollback` with the explicit prior configuration and:

```text
--acknowledgement ROLLBACK_PRIORENA_USER_AGENT
```

The `.previous` file remains private and retained. When it already matches the active bytes and the exact service is registered, rollback is safely idempotent. When those bytes match but registration is absent, rollback stops with `STARTUP_REGISTRATION_RECOVERY_REQUIRED`; it does not bootstrap implicitly or report rollback success. A later replacement may reuse the retained file only when it exactly matches the then-active definition.

## Separately authorized exact registration recovery

Registration recovery is only for the narrow stopped state in which:

- the complete explicit configuration passes every normal trust-boundary and plist check;
- the active managed definition bytes exactly equal the deterministic bytes for that configuration;
- the retained `.previous` definition exists, is valid, and exactly equals both the active and deterministic bytes;
- the exact fixed label is not registered; and
- separate operational evidence has already established that activation is safe, including an unused port and no conflicting process.

It requires the exact acknowledgement:

```text
RECOVER_PRIORENA_USER_AGENT_REGISTRATION
```

Use the complete explicit configuration template with action `recover-registration`. The controller performs no definition write and no bootout. It issues exactly one bootstrap for the exact current-user domain and managed destination, waits for bounded registration convergence, and verifies the unchanged exact definition bytes and registration. A registered service, missing or mismatched retained definition, unknown or mismatched active definition, wrong acknowledgement, failed bootstrap, or convergence/verification failure stops without a second bootstrap. Any failed recovery requires inspection and new authority; do not retry it automatically.

## Later separately authorized removal

Removal requires only the exact current-user home and `REMOVE_PRIORENA_USER_AGENT`. It derives the fixed destination, validates the existing managed bytes, boots out only the fixed current-user label when registered, moves the active definition aside in the same directory, verifies service and destination absence, and removes that moved active definition. A failure before permanent removal restores and verifies the previous active definition and registration state.

```bash
npm run release:startup -- remove \
  --user-home "<CURRENT_USER_HOME>" \
  --acknowledgement REMOVE_PRIORENA_USER_AGENT
```

Absence is idempotent unless the fixed label remains registered without its managed file; that state stops as ambiguous. Removal deliberately retains a valid `.previous` definition for separately authorized recovery. That private file is never loaded by launchd because it does not end in `.plist`. Deleting retained recovery material is outside this controller and requires a separately reviewed exact file-retention decision.

## Verification after install, login, or reboot

Login, logout, and reboot testing are live operations and require separate authority. After each authorized event, require all of the following evidence without publishing private values:

1. Run controller `inspect` with the exact approved configuration and require `installed-and-registered`, `definitionMatches: true`, and `consistent: true`.
2. Obtain the exact PID from separately authorized current-user launchd evidence. Do not infer it from a process-name search.
3. Validate that PID with the existing exact process guard:

   ```bash
   npm run release:process -- inspect \
     --pid "<EXACT_PID>" \
     --expected-cwd "<RELEASE_ROOT>" \
     --expected-command "<EXPECTED_COMMAND_FRAGMENT>" \
     --expected-port "3100"
   ```

4. Require the validated PID to own only `127.0.0.1:3100`. Any wildcard, IPv6-any, LAN, proxy, tunnel, or other listener is unsupported and fails verification.
5. Perform a read-only application smoke against the loopback origin: root redirect to `/target/`, successful `/target/` load, safe headers, expected local assets, bounded Organization list, and no mutation. Do not bind another process to port `3100` for this check.
6. Confirm the approved schema-v5 data checksum and mode remain unchanged by startup and smoke. Do not copy data values into the evidence record.
7. Confirm no external connection, telemetry, repository update, Source transmission, live-data mutation, or automatic publication occurred.

Persistence succeeds only when the exact service, process identity, loopback listener, application smoke, and unchanged private data all verify after the authorized login or reboot. Registration alone is not sufficient.

## Diagnostics and safe recovery

Use bounded controller codes, `inspect`, exact process evidence, and the existing private operational log. Never paste raw `launchctl` output, plist bytes, paths, Source filenames/content, data values, or operational logs into public reports.

| Condition | Safe evidence | Required response |
| --- | --- | --- |
| Configuration validation failure | A `STARTUP_*_INVALID` or `STARTUP_PLATFORM_UNSUPPORTED` code before mutation | Correct only the privately resolved explicit value; rerun `plan`; do not weaken canonical-path, mode, ownership, schema, or symlink controls. |
| Plist validation failure | `STARTUP_PLIST_VALIDATION_FAILED` | Stop before write. Do not bypass `plutil` or hand-edit a plist. |
| Registration failure | `STARTUP_INSTALL_FAILED`, `STARTUP_REPLACEMENT_FAILED`, or `STARTUP_SERVICE_MUTATION_FAILED` with verified rollback | Confirm exact label/domain ownership and resolve the private launchd condition before one newly authorized attempt. |
| Rollback verification failure | An error ending in `_ROLLBACK_FAILED` or `_RESTORE_FAILED` | Treat state as unverified. Do not retry, use broad launchctl actions, or start another runtime; obtain focused authority after exact private inspection. |
| Exact prior bytes active but registration absent | `STARTUP_REGISTRATION_RECOVERY_REQUIRED` with phase `registration-recovery-required` and status `recovery-required` | Stop. Inspect the exact definition, retained bytes, service, process, and port. Use `recover-registration` only under fresh exact activation authority. |
| Registration recovery failure | `STARTUP_REGISTRATION_RECOVERY_FAILED` with an allowlisted registration-recovery phase and bounded status | Stop after the single bootstrap. Do not retry recovery or candidate activation; inspect and obtain new authority. |
| Restart-loop throttling | Exact service remains registered but repeated unsuccessful exits are separated by the configured 30-second throttle | Inspect the bounded private startup category; do not lower the throttle or force repeated starts. |
| Process mismatch | Existing process guard returns command, cwd, or loopback-port mismatch | Do not signal it. Resolve ownership separately. |
| Port conflict | Exact configured process does not own `127.0.0.1:3100`, or another PID owns the port | Do not change the supported port or broaden exposure. Resolve the unrelated process under separate authority. |
| Startup validation failure | No valid process persists; private operational log contains bounded `startup` failure category | Correct schema/mode/path prerequisites without mutating live data. Do not copy raw data or paths into reports. |
| Application smoke failure | Process identity and loopback bind pass, but read-only UI/API checks fail | Preserve data and retained definition, stop the acceptance sequence, and choose separately authorized rollback or runtime recovery. |

Do not use `killall`, `pkill`, sudo, broad `launchctl` domains, service discovery, force flags, recursive deletion, a shell wrapper, or automatic retries.

For a future replacement, perform one exact preflight, one acknowledged candidate replacement, and full process/listener/application/data-integrity acceptance. If candidate activation fails and automatic restoration verifies a registered prior state, stop on the restored prior state. If restoration stops with exact prior bytes active but registration absent, do not invoke rollback or retry the candidate: inspect the stopped state, then obtain separate authority for at most one exact `recover-registration` action. After recovery, repeat the complete prior-runtime acceptance and stop. No path permits a second automatic candidate activation, a second restoration bootstrap, or an automatic registration-recovery attempt.

## Source release interaction and retained boundaries

- Merging source does not change the installed definition or registered service.
- Updating a checkout does not update the agent definition; the definition continues to reference the exact recorded executable and release root until a separately authorized replacement.
- Installing or replacing the agent is not a data cutover. It must not modify persisted data, Source content, backups, schema, seeds, or operational configuration.
- Activating a new source revision, stopping an existing runtime, login/reboot testing, and application acceptance each require their own bounded authority and exact evidence.
- Priorena remains single-user and loopback-only, with no authentication, LAN/hosted support, telemetry, automatic update, external provider action, or Source transmission.

## Limitations and residual operational risks

- launchd registration confirms only the service definition, not correct application behavior; process, loopback, smoke, and data-integrity checks remain mandatory;
- repeated invalid startup can continue at the bounded throttle interval until the exact agent is rolled back or removed under authority;
- the controller cannot safely resolve a registered fixed label without its managed file, a conflicting process, or an unrelated port owner;
- retained `.previous` bytes contain private configuration paths and must remain mode `0600` in the private LaunchAgents directory;
- the controller does not delete retained recovery material, discover or stop independent processes, choose release paths, migrate data, update source, or authorize login/reboot testing;
- a failure whose automatic rollback cannot be verified is an operational stop requiring exact private inspection and new focused authority.
