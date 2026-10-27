# Security policy

Gateseeker is a security tool; flaws in it matter twice. Thank you for looking.

## Reporting a vulnerability in Gateseeker

Please do not open a public issue. Use GitHub's private vulnerability reporting on this repository ("Security" tab, "Report a vulnerability"). You will get an acknowledgement within 3 business days and a fix or a mitigation plan within 14 days for anything that lets an analyzed project execute code, read files outside the project, exfiltrate data, or make a vulnerable dependency look clean.

Please include: the version (`gateseeker --version`), a minimal project or lockfile that triggers the problem, and what you expected.

## Scope

- Any way an analyzed project (lockfiles, source files, `.env`, feeds) can make the scanner run code, read outside its root, or crash it.
- Any way a finding can be suppressed or a verdict turned into `pass` without the conditions documented in `docs/THREAT_MODEL.md`.
- Any secret value reaching a report, a terminal, a comment or a SARIF file.
- The local triage server (`gateseeker-intel ui`) accepting requests without its session token or running git commands outside its allowlist.
- The GitHub Action running something other than the pinned package version.

## Out of scope

- Vulnerabilities in dependencies that Gateseeker reports about third-party packages (report those to the package or to OSV).
- Incidents that OSV and the curated advisory set do not know yet. If you know of one, propose it through the advisory feed (`advisories/README.md`).

## Supported versions

The latest published version only. Pre-releases (`-beta`) receive fixes as new pre-releases.
