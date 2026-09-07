# Ego browser progress in the conversation

The browser progress entry belongs to the **Skills activity row in the conversation transcript**, next to the Ego invocation. It does not belong to the capability panel's installed-Skills catalogue. This supersedes the entry location described in the Vercel preview design; browser-step reporting and viewing require no Vercel connection or published preview.

## User-visible contract

- An Ego activity with linked browser frames exposes **查看过程 / View progress** on its own row.
- Repeated invocations grouped into one activity retain separate progress actions. A mixed Skill batch can expose both Ego browser and Ego ops runs.
- The existing bounded browser-step window displays the selected run and receives new frames while open. Closing returns to the transcript trigger; image enlargement keeps the existing viewer behavior.
- The entry works with tool grouping enabled or disabled. Expanding an agent-work group does not duplicate its activity strip.
- Linked browser frames no longer occupy ordinary attachment rows in the transcript. Original messages and attachment storage remain unchanged.
- Ordinary images, malformed/unassociated reports, and reports whose invocation is outside the loaded history remain visible as attachments. Public transcripts without a session image context also keep their images.
- The capability panel remains available for its regular tasks on Web and native clients.

## Implementation and verification

`ConversationTranscript` computes one browser-run projection from its complete loaded message window, provides it to activity rows, and filters only frames that have a linked invocation. `SkillConversationActivity` retains invocation message IDs even when repeated Skill names are combined. Nested tool transcripts have separate association queues.

Automated coverage includes input formats, mixed batches, repeated runs, nested ownership, history pagination, unassociated image fallback, open-window updates, standalone Skill routing, and the existing browser window/image viewer contracts. Screenshot collection was offered separately and is not a prerequisite for the implementation.

Base revision: `de896258c1c4acdc653a80fc0ef99de0caf4f363`.
