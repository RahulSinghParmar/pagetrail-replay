# Security policy

## Supported version

Security fixes are developed against the latest PageTrail Replay beta on the `main` branch. Older preview builds may not receive separate fixes.

## Reporting a vulnerability

Use GitHub’s private vulnerability reporting or open a draft security advisory in the repository’s **Security** section. Do not publish exploit details, credentials, private recordings or sensitive URLs in a public issue.

Include, when available:

- affected PageTrail version and browser version;
- the feature or export format involved;
- minimal reproduction steps using invented content;
- expected and observed security impact;
- whether stored recordings, exported files or browser permissions are involved.

You should receive an acknowledgement after the repository maintainer reviews the report. Disclosure timing will be coordinated after the issue is understood and a safe fix is available.

## Security boundaries

PageTrail records authorised browser activity locally. Archives may contain confidential content, URLs, API responses and signed resources. Credential filtering is defence in depth, not complete redaction. Users must review exports before sharing them.

The extension does not provide a public upload workflow. The local WACZ reader binds to loopback. Website-session HTML and learning exports remove original active scripts; WACZ replay intentionally retains captured web behaviour in the separate reader.

PageTrail does not claim that a successful capture is complete, that archived third-party code is safe, or that every website can be replayed without side effects.
