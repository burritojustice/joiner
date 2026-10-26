# Reference

Public lists that go with Joiner's map layers but aren't maps: who to contact in each area, as published by the city. They live here, in plain files, so anyone using Joiner can read and update them without an Airtable account.

Each folder holds one list, named for the layer it goes with, plus a README saying where it came from, how to update it, and the date it was last checked.

| Folder | What | Goes with layer |
|---|---|---|
| `cultural-districts/` | Contacts for San Francisco's 10 Cultural Districts | `cultural_districts` (Other › Cultural Districts) |

## What belongs here

- **Public contact information only:** what a city department or the organization itself publishes (a website, a public email or phone, the name of a listed lead organization).
- **Not** private contacts: people's personal emails or phones, donors, volunteers, anything from Airtable or a sign-up form. Those stay out of the repo.
- Keep the copy as published. When a list is downloaded whole (like SF Planning's neighborhood group list in Block Party), keep the file with its publish or download date in the name, e.g. `…_20260925.csv`, and don't edit it by hand.
- Every row says where it came from (`source_url`) and when someone last checked it (`checked`, as `YYYY-MM-DD`).

## Keys

Each list's first column is the layer's key (for Cultural Districts, `district_name`), spelled exactly as in `data/boundaries/<layer>.geojson`, so the list can be joined to the map. Load the CSV in Joiner with that layer selected to check: every row should match.
