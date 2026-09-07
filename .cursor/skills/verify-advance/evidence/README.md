# Evidence location

Verification runs write here:

```text
.cursor/skills/verify-advance/evidence/runs/<run-id>/
```

Each run keeps:

- `notes.log` — commands, selectors, and observable checks (no passwords)
- screenshots / HTTP transcripts named by feature id
- `verdict.txt` — pass/fail for that drive

Cleanup must not delete this directory. Cloud Agent copies of the same files may also land in `/opt/cursor/artifacts/` with a `verify_advance_` prefix.

Do not commit run folders. Do not store emails, passwords, tokens, or service-role keys in these files.
