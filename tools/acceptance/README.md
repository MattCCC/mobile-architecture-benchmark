# Acceptance receipts

The platform acceptance drivers produce `mobilebench.acceptance-receipt/1.0.0` JSON only after executing every check
in `contract.json` against one frozen artifact. The receipt binds the outcome to the candidate, platform, artifact
SHA-256 and normative design SHA-256. It also hashes at least one retained evidence file.

The early runner requires one passing receipt per candidate:

```sh
node tools/early-bench/session.mjs ... \
  --acceptance-receipt native:android=results/acceptance/native-android/receipt.json
```

Receipt shape:

```json
{
  "schema": "mobilebench.acceptance-receipt/1.0.0",
  "suiteId": "mobilebench.acceptance/1",
  "status": "passed",
  "candidateId": "native",
  "platform": "android",
  "artifactSha256": "<64 hex>",
  "designSha256": "<64 hex>",
  "checks": [{ "id": "initial-state", "status": "passed" }],
  "evidence": [{ "path": "evidence.jsonl", "sha256": "<64 hex>" }]
}
```

`checks` must contain every id in `contract.json`. A missing or failed check, changed evidence file, mismatched artifact
or mismatched design rejects the candidate. Receipts and evidence belong under ignored local results until a complete
result set is deliberately published.
