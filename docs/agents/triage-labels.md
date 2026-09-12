# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the
actual label strings used in this repo's issue tracker (the local markdown tracker described in
`issue-tracker.md`, where a label is the value of an issue file's `Status:` line).

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding
label string from this table.

## The one value that is not a triage role

`resolved` closes a ticket: the work shipped. It is not in the table above because triage decides
what to do with an issue, while `resolved` records that there is nothing left to do — a lifecycle
state, not a role. The wayfinding flow in `issue-tracker.md` already uses `resolved` for a finished
ticket, so the same word means the same thing everywhere in the tracker.

When you set it, record the commit and the acceptance evidence under `## Comments`.
