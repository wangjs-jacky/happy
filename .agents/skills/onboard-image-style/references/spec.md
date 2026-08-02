# Style onboarding spec

The onboarding script accepts one JSON document through `--spec`. Paths are resolved relative to the spec file unless absolute.

## Shape

```json
{
  "referenceSha256": [
    "1111111111111111111111111111111111111111111111111111111111111111"
  ],
  "category": {
    "id": "reference-example",
    "label": "示例案例",
    "accent": "#A86C45"
  },
  "style": {
    "id": "reference-example/style-name/1",
    "title": "风格名称",
    "templateRef": "reference-examples/example-reference/style-name.md",
    "templateLabel": "Style Name",
    "promptHint": "展示在卡片中的简短中文说明。",
    "promptContent": "A complete reusable image transformation prompt longer than 200 characters...",
    "promptPath": "garden-gpt-image-2/prompt/style-name.md",
    "sourceCaseId": "example-reference/01-style-name"
  },
  "preview": {
    "source": "/absolute/generated-cover.jpg",
    "fileName": "style-name.jpg",
    "sourceIndex": 1
  }
}
```

## Rules

- `category.id` starts with `reference-` and uses lowercase kebab-case.
- `referenceSha256` contains every SHA-256 value returned by `style:onboard:inspect`. It prevents a renamed or copied reference from being used as the preview.
- `style.id` starts with `<category.id>/`, uses lowercase kebab-case path segments, and ends with a positive numeric variant.
- `accent` is a six-digit hex color.
- `templateRef` and `promptPath` end in `.md` and are descriptive provenance strings; the script does not create those documents.
- `promptHint` is at least 20 characters and `promptContent` is longer than 200 characters.
- `sourceCaseId` is a stable provenance identifier unique to the curated example.
- `preview.source` points to an original generated JPEG or PNG. User attachments under `~/.happy/attachments` are rejected.
- `preview.fileName` is a basename ending in `.jpg` or `.png`. Its extension must match the actual image format.
- `preview.sourceIndex` is a positive integer. It defaults to `1` when omitted.
- The script strips metadata, constrains the longest edge to 640 pixels, compresses the image, caps it at 512 KiB, and records the normalized dimensions.

The script fails when the style ID already exists. To revise an existing style, edit and review that existing entry directly instead of treating it as a new onboarding operation.
