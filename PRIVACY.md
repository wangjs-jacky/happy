# Paws Privacy Policy

**Last updated: July 13, 2026**

## Overview

Paws is an open-source remote-control client for AI coding agents. It is designed so that session content is encrypted on Paws clients before it is stored or relayed by a compatible sync server. You may use the default configured service or operate your own server; the operator of the infrastructure you choose controls its retention, access logs, backups, and network metadata.

This policy describes the Paws software in this repository. Third-party AI providers, push providers, analytics services, GitHub, npm, and infrastructure operators have their own terms and privacy policies.

## Data Handled by Paws

### Encrypted session data

Depending on the feature, Paws may synchronize encrypted messages, session state, machine state, metadata, settings, artifacts, and attachments. Encryption keys are created and held by paired clients. A compatible relay server stores and forwards encrypted payloads without needing the plaintext session content.

The AI agent or provider you choose must receive the prompts, files, tool results, or other content required to perform your request. End-to-end encryption between Paws clients and the sync server does not prevent the selected local agent or third-party model provider from processing that content.

### Operational metadata

The service may process operational data needed to route and synchronize records, including account or public-key identifiers, record IDs, sequence numbers, timestamps, session and machine identifiers, connection state, IP/network logs, and push-registration tokens. Some metadata is not encrypted because the service needs it for routing, ordering, abuse prevention, or delivery.

### Analytics

Paws can use PostHog for anonymous product analytics when an analytics key is configured. Analytics events are intended to exclude message content, source code, prompts, and files. Users can disable analytics in App settings, and self-hosted deployments can disable analytics through configuration.

### Push notifications

Current Paws Android builds use Firebase Cloud Messaging (FCM), with token registration and server delivery currently routed through Expo Push services. Push tokens and delivery metadata may therefore be processed by the configured Paws server, Expo, and Google/Firebase. Notification payloads should not be treated as a place for sensitive source code or full conversation content.

### Optional integrations

Features such as voice, GitHub integration, object storage, or paid third-party services may send the minimum required data to the service selected by the user or deployment operator. Those services are outside the Paws encryption boundary and are governed by their own policies.

## What Paws Does Not Intend to Collect

Paws does not require the sync server to read plaintext conversations or source code. The project does not intentionally use message or file contents for advertising or sell personal data. This does not override data handling performed by an AI provider, integration, infrastructure operator, or service you configure.

## Retention and Deletion

Retention depends on the server and storage configuration. Deleting a session or account requests deletion through the configured service, but infrastructure backups, object-storage lifecycle rules, and service logs may have separate retention windows. Self-hosters are responsible for their own database, object-storage, log, backup, and deletion policies.

## Security

Paws uses client-side cryptography and authenticated synchronization protocols, but no software can guarantee absolute security. Keep local key material, agent credentials, provider tokens, server secrets, and devices protected. Review release notes before upgrades and report suspected vulnerabilities privately when possible.

## Your Choices

You can:

- self-host the Paws-compatible sync server;
- disable analytics in App settings;
- choose which AI agents and external integrations to use;
- delete sessions and other records through available product controls;
- inspect, modify, and build the open-source code.

## Changes

Material changes to this policy should be published with the repository or application release. Continued use after an update means the updated policy applies to subsequent use.

## Contact

For privacy questions or reports, open an issue at <https://github.com/wangjs-jacky/happy/issues>. Avoid including secrets, private source code, credentials, or unredacted logs in public issues.
