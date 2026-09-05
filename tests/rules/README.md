# Firestore security-rule tests

Regression tests for `firestore.rules`, run against the local Firestore emulator.
Nothing is ever deployed and no real Firebase project is touched — the emulator
runs under a `demo-` project ID, which Firebase treats as strictly local.

## What this tests

The suite exists because it caught a real privilege-escalation bug, and it is
kept so that bug cannot come back.

**The bug it found.** `users` previously allowed `write` to a user's own
document (`allow write: if isAdmin() || request.auth.uid == userId`). That let
*any* signed-in user — including the read-only `viewer` — set their own `role`
to `admin` and then write anywhere in the database. Running this suite against
the pre-fix rules shows a viewer escalating and every later `isAdmin()`-gated
write then succeeding. The rule is now split into `create` (admin *or* self,
which is all the signup flow needs) and `update, delete` (admin only).

**What it asserts now**, roughly 128 assertions in three groups:

1. **Viewer reads** — `get` and unfiltered `list` on every collection a viewer
   is meant to see (`projects`, `sites`, `siteTasks`, `workOrders`,
   `surveyReports`, `users`, `appConfig`, `auditLog`, `bulkUploads`,
   `taskMaster`, `tasks`, plus the `updates` subcollections), including the
   real query shapes the app issues: the survey-oversight status filter, the
   archived-sites view, per-site work-order history, and
   `collectionGroup('updates')`.
2. **Viewer writes — all denied.** Create, update and delete against every
   collection and subcollection. Critically this includes the *demoted-user*
   case: the fixtures seed a viewer who is still named in `assignedTo` and
   `approverUid` on a `siteTask`, `workOrder`, `surveyReport` and `task`, which
   is exactly what happens when an admin changes a field engineer's or
   approver's role while they still hold live work. Those uid-keyed write
   branches must not let them through.
3. **Regressions for the other roles** — the field-engineer submission
   lifecycle, approver review, admin CRUD, the signup flow's create-own-user-doc
   write, and the pre-existing anti-self-approval guards all still work.

## Running it

From the repo root:

```
npm run test:rules
```

That wraps the suite in `firebase emulators:exec`, which starts the Firestore
emulator, runs the tests against it, and shuts it down. Expected output ends
with:

```
128 assertions passed, 0 failed
ALL RULE ASSERTIONS PASSED
```

A non-zero failure count exits non-zero, so this is CI-safe as-is.

To run it against a *different* rules file — comparing against an older
revision, say — invoke it directly with the emulator already running:

```
cd tests/rules
node rules.test.mjs /path/to/some-other.rules
```

With no argument it defaults to this repo's `firestore.rules`.

## Requirements

- **Firebase CLI** (`firebase`) on `PATH` — provides `emulators:exec`.
- **A local Java runtime** — the Firestore emulator is a Java process and will
  not start without one.

Both are already present in the current dev environment. The first run may
download the emulator jar (~60 MB), which is a one-time fetch.

## Why this is a separate package

`tests/rules/` has its own `package.json` and `node_modules`.
`@firebase/rules-unit-testing` is a dev-only tool for one emulator test run and
is deliberately kept out of the app's dependency tree, so it can never end up
in a production install or a client bundle.

`.npmrc` here sets `legacy-peer-deps=true`. `@firebase/rules-unit-testing@5`
declares a peer of `firebase@^12`, but these tests pin `firebase@10.14.1` — the
exact client version the app ships. Rule evaluation depends on the query shapes
the client sends, so testing against a different major than the app uses would
weaken the check. The peer mismatch is knowingly accepted; that setting is
scoped to this directory and does not affect the app's own installs.
