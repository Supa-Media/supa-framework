---
"@supa-media/scripts": minor
---

`supa-sync-1password-to-github` no longer deletes by default. An allowlisted key absent from the vault is kept in GitHub and listed in a new per-environment drift report (also written to the Actions job summary): names GitHub holds that the vault lacks, names the vault holds that GitHub lacks, and GitHub names outside the allowlist. Pass `--prune` (the reusable workflow's new `prune` input) to delete as before. A failure to list GitHub's secrets now aborts the run with zero writes.
