import Anthropic from '@anthropic-ai/sdk';
import dedent from 'dedent';
import * as fs from 'fs';
import { exit } from 'process';
import util from 'util';

const client = new Anthropic({
  apiKey: process.env['CLAUDE_API_KEY'],
  maxRetries: 5,
});

async function main() {
  const [oldPath, newPath, compare_resource] = process.argv.slice(2);

  if (!oldPath || !newPath) {
    console.error('Usage: pnpm start old_provider_schema.json new_provider_schema.json [resource_name_to_compare]');
    process.exit(1);
  }

  const oldResources: any = loadResources(oldPath);
  const newResources: any = loadResources(newPath);

  const output: { new: string[], same: string[], updated: Record<string, any> } = {
    new: [],
    same: [],
    updated: {},
  };

  for (const key in newResources) {
    console.log('processing', key);
    const oldR = oldResources[key];
    if (!oldR) {
      output.new.push(key);
      continue;
    }
    const newR = newResources[key];

    const oldAttrs = oldR["block"]["attributes"];
    const newAttrs = newR["block"]["attributes"];

    const { created, deleted } = diff(oldAttrs, newAttrs);

    if (created.length === 0 && deleted.length === 0) {
      output.same.push(key);
      continue;
    }

    if (created.length === 0 || deleted.length === 0) {
      // if one side has strictly more keys, there can be no renames
      output.updated[key] = {
        created,
        deleted,
        renamed: [],
      }
      continue;
    }

    const filteredOld = filterKeys(oldAttrs, deleted);
    const filteredNew = filterKeys(newAttrs, created);
    if (compare_resource) {
      if (compare_resource === key) {
        console.log(util.inspect(filteredOld, { showHidden: true, depth: null, colors: true }));
        console.log(util.inspect(filteredNew, { showHidden: true, depth: null, colors: true }));
        exit(0);
      }
      continue;
    }

    const content = createRenamePrompt(filteredOld, filteredNew);

    const result = await client.messages.create({
      max_tokens: 1024,
      model: 'claude-3-5-sonnet-latest',
      // model: 'claude-3-5-haiku-latest', // faster but less accurate model
      messages: [{
        role: "user",
        content,
      }],
    });

    // @ts-ignore
    const text = result.content[0].text;

    try {
      const parsed = JSON.parse(text);
      output.updated[key] = parsed;
    } catch (e) {
      // probably wasn't valid json
      output.updated[key] = {
        ai_error: text,
      }
      console.log("Error", e);
    }

    console.log(JSON.stringify(output.updated[key], null, 2));
  }

  console.log('wrote output to output.json');
  fs.writeFileSync('output.json', JSON.stringify(output, null, 2));
}

function diff(oldR: any, newR: any): { created: string[], deleted: string[] } {
  const oldKeys = new Set(Object.keys(oldR));
  const newKeys = new Set(Object.keys(newR));

  return {
    created: Array.from(newKeys).filter(k => !oldKeys.has(k)),
    deleted: Array.from(oldKeys).filter(k => !newKeys.has(k)),
  };
}

function filterKeys(obj: any, keys: string[]): object {
  const result: any = {};
  for (const key of keys) {
    result[key] = obj[key];
  }
  return result;
}

function createRenamePrompt(oldR: object, newR: object): string {
  return dedent`
    Here are two Terraform schemas, and I'm trying to understand which properties are created, deleted, and renamed.

    Use the description or schema structure to determine which properties are actually the same, but have been renamed in the new schema.

    Please output JSON that conforms to the following example:
    {
      "created": ["property1", "property2"],
      "deleted": ["property3", "property4"],
      "renamed": [{"property5": "property6"}, {"property7": "property8"}]
    }

    Old schema:
    \`\`\`
    ${JSON.stringify(oldR, null, 2).split('\n').map(l => '    ' + l).join('\n')}
    \`\`\`

    New schema:
    \`\`\`
    ${JSON.stringify(newR, null, 2).split('\n').map(l => '    ' + l).join('\n')}
    \`\`\`

    Make sure you ONLY respond with the JSON, with no additional text.
  `;
}

function loadResources(path: string): object {
  const json = JSON.parse(fs.readFileSync(path, 'utf-8'));
  return Object.values(json["provider_schemas"] as object)[0]["resource_schemas"];
}

main();
