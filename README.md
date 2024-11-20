# Detect terraform renames with AI

Uses AI to try to figure out which properties were renamed in resources between two terraform schemas.

## Run it

```
pnpm install

export CLAUDE_API_KEY=sk-ant-api...

pnpm start old_provider_schema.json new_provider_schema.json
```

This will look at every resource in both providers and figure out which have keys that differ. If there are differing keys,
it will call out to the claude API and ask it to figure out which attributes are renamed.

It will eventually write a structured object to `output.json`

For example:

* `new` represents resources only on the new schema
* `same` represents resources where all the properties are the same
* `updated` lists the created, deleted, and renamed attributes

```
{
  "new": [
    "cloudflare_account_token",
    "cloudflare_zone_dnssec"
  ],
  "same": [
    "cloudflare_account",
  ],
  "updated": {
    "cloudflare_access_rule": {
      "created": [
        "allowed_modes",
        "created_on",
        "modified_on",
        "scope"
      ],
      "deleted": [
        "identifier"
      ],
      "renamed": []
    },
    "cloudflare_zone_lockdown": {
      "created": [],
      "deleted": [],
      "renamed": [
        {
          "zone_identifier": "zone_id"
        }
      ]
    },
  }
}
```