import Anthropic from '@anthropic-ai/sdk';
import dedent from 'dedent';
import * as fs from 'fs';

const client = new Anthropic({
  apiKey: process.env['CLAUDE_API_KEY'],
  maxRetries: 5,
});

async function main() {
  const [beforePath, afterPath] = process.argv.slice(2);

  if (!beforePath || !afterPath) {
    console.error('Usage: pnpm start before_provider_schema.json after_provider_schema.json');
    process.exit(1);
  }

  const beforeResources: any = loadResources(beforePath);
  const afterResources: any = loadResources(afterPath);

  const output: { new: string[], same: string[], updated: Record<string, any> } = {
    new: [],
    same: [],
    updated: {},
  };

  for (const key in afterResources) {
    console.log('processing', key);
    const before = beforeResources[key];
    if (!before) {
      output.new.push(key);
      continue;
    }
    const after = afterResources[key];

    const beforeAttrs = before["block"]["attributes"];
    const afterAttrs = after["block"]["attributes"];

    const { created, deleted } = diff(beforeAttrs, afterAttrs);

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

    const content = createRenamePrompt(filterKeys(beforeAttrs, deleted), filterKeys(afterAttrs, created));

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

function diff(before: any, after: any): { created: string[], deleted: string[] } {
  const beforeKeys = new Set(Object.keys(before));
  const afterKeys = new Set(Object.keys(after));

  return {
    created: Array.from(afterKeys).filter(k => !beforeKeys.has(k)),
    deleted: Array.from(beforeKeys).filter(k => !afterKeys.has(k)),
  };
}

function filterKeys(obj: any, keys: string[]): object {
  const result: any = {};
  for (const key of keys) {
    result[key] = obj[key];
  }
  return result;
}

function createRenamePrompt(before: object, after: object): string {
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
    ${JSON.stringify(before, null, 2).split('\n').map(l => '    ' + l).join('\n')}
    \`\`\`

    New schema:
    \`\`\`
    ${JSON.stringify(after, null, 2).split('\n').map(l => '    ' + l).join('\n')}
    \`\`\`

    Make sure you ONLY respond with the JSON, with no additional text.
  `;
}

function loadResources(path: string): object {
  const json = JSON.parse(fs.readFileSync(path, 'utf-8'));
  return Object.values(json["provider_schemas"] as object)[0]["resource_schemas"];
}

main();
