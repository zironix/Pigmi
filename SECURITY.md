# Security policy

## Supported versions

Security fixes are made on the latest version of the default branch. Older releases may not
receive patches.

## Reporting a vulnerability

Please do not disclose vulnerabilities in public issues, discussions, or pull requests.

Use GitHub's private vulnerability reporting for the repository when available. If it is not
available, email the maintainer at `ziritix@gmail.com` with:

- the affected version and operating system;
- reproduction steps or a proof of concept;
- the expected security impact;
- any suggested mitigation.

You should receive an acknowledgement within seven days. Please allow reasonable time for a fix
and coordinated disclosure.

## Security model

Pigmi uses Electron context isolation, disables renderer Node integration, exposes a narrow
preload API, and restricts filesystem access to explicit user actions. Contributions that
weaken these boundaries require a documented threat analysis.
