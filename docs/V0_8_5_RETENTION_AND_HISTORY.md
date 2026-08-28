# V0.8.5 — Retained Client Artifacts + Calculation History

## Purpose

V0.8.5 adds explicit, advisor-controlled retention for generated document drafts and named calculation/comparison snapshots inside an authenticated client workspace. Retention is opt-in: generating a document, running the calculator, or opening a comparison does not automatically create history.

This phase preserves the existing privacy boundary: raw StudentAid.gov downloads and raw evidence files are not retained by the Worker.

## Stored objects

### Retained document draft

Stored in `advisor_client_artifacts` and keyed by `(owner_advisor_id, client_id, artifact_id)`.

A retained draft stores:

- advisor-supplied display name for the history item;
- the validated template request needed to regenerate the draft;
- generated plain-text and printable-HTML outputs;
- the application engine version used when the artifact was retained;
- creation time.

Only `document_draft` is accepted as the V0.8.5 artifact kind. The normal documentation-template engine remains authoritative; the history system does not duplicate statement wording.

### Calculation / comparison snapshot

Stored in `advisor_client_calculation_snapshots` and keyed by `(owner_advisor_id, client_id, snapshot_id)`.

A retained snapshot stores:

- advisor-supplied display name;
- snapshot kind: `calculation` or `comparison`;
- a bounded normalized basis consisting of confirmed application facts, normalized loan portfolio facts, and considered plans;
- the deterministic result produced from that basis;
- policy snapshot;
- application engine version;
- creation time.

The raw StudentAid file, raw evidence files, FSA credentials, SSNs, session tokens, and CSRF tokens are not part of the retained basis.

## Authority and isolation

Every history query is owner-and-client scoped. The authenticated advisor must first own the client, and artifact/snapshot reads and mutations also include the same `owner_advisor_id` and `client_id` in their D1 predicates.

Cross-advisor history access therefore fails through the same generic client-not-accessible boundary used by the rest of the advisor workspace. History list responses are intentionally minimized: they expose IDs, names, kinds, version/policy labels, and timestamps, not document bodies, loan balances, income facts, or calculation results.

The client dashboard remains minimized and does not aggregate retained artifact payloads.

## Regeneration and rerun semantics

Retained objects are historical records.

- **Regenerate document** loads the retained template request and renders fresh text/HTML with the current trusted template engine.
- **Rerun snapshot** loads the retained normalized basis and runs it through the current deterministic calculation/comparison engine.
- Neither operation overwrites the retained original.
- A newly generated result is retained only through another explicit retention action.

This makes it possible to compare an old retained basis under a later engine/policy implementation without silently rewriting what was saved previously. Engine version and policy snapshot metadata remain visible for provenance.

## Export

A client export uses schema `student-loan-idr-advisor-client-export-v2` and includes:

- the normalized client record;
- all explicitly retained document artifacts;
- all retained calculation/comparison snapshots.

Export remains exact-owner scoped and records only a payload-minimized `client.export` audit event.

## Deletion and retention boundaries

- A retained document or snapshot can be permanently deleted individually.
- Deleting a client deletes its retained history with it.
- Deleting the owning advisor account continues to remove the advisor-owned client records and their dependent retained history.
- List views are bounded to the most recent 200 items per history type; client export returns the retained history associated with that client.
- V0.8.5 does not introduce an independent archive, undelete, or legal-hold layer.

Cloudflare D1 can report a parent deletion's `meta.changes` including cascading child deletions. The accepted V0.8.5 runtime therefore treats any positive change count as a successful guarded client delete; zero remains the optimistic-concurrency failure signal.

## Audit boundary

History actions emit action-only audit events with `{}` metadata:

- `client.artifact.retain`
- `client.artifact.regenerate`
- `client.artifact.delete`
- `client.snapshot.retain`
- `client.snapshot.rerun`
- `client.snapshot.delete`

The audit log does not copy document text, template payloads, calculation basis/results, loan facts, income facts, or history names into `metadata_json`.

## Browser boundary

The authenticated saved-client UI adds explicit controls to retain a draft, retain a calculation, retain a comparison, browse history, regenerate/rerun, export, and delete.

The direct borrower workflow remains account-free. V0.8.5 adds no `localStorage` or `sessionStorage` persistence and does not add a raw-file upload endpoint.

## Acceptance

Final runtime/workflow source:

`112e24583028c01443d560252db1cc869be1cc4d`

Normal CI:

`33190299021` — success

Exact-SHA deployment + production acceptance:

`33190347634` — success

The production gate dynamically counted **166 checks**, including D1 migration application, exact-source deployment, owner isolation, explicit artifact/snapshot retention, minimized history lists, cross-owner denial, regeneration, retained-basis rerun, export v2, individual deletion, client cleanup/cascade behavior, browser history controls/privacy text, existing borrower workflows, and the unchanged three-tool MCP contract.
