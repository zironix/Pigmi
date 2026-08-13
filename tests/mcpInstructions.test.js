import { describe, expect, it } from 'vitest';

import {
  FULL_PIGMI_MCP_INSTRUCTIONS,
  PIGMI_EDIT_PROMPT,
  PIGMI_MCP_INSTRUCTIONS,
} from '../mcp/instructions.mjs';
import { getOperationReference } from '../mcp/operation-reference.mjs';

describe('Pigmi MCP instructions', () => {
  it('keeps the critical workflow self-contained near the beginning', () => {
    const opening = PIGMI_MCP_INSTRUCTIONS.slice(0, 512);

    expect(opening).toContain('pigmi_get_overview');
    expect(opening).toContain('pigmi_get_items');
    expect(opening).toContain('expectedRevision');
    expect(opening).toContain('never select newly created items');
  });

  it('covers faithful image interpretation without hardcoded object assumptions', () => {
    expect(PIGMI_MCP_INSTRUCTIONS).toContain('small but semantically important accents');
    expect(PIGMI_MCP_INSTRUCTIONS).toContain('stereotypical colors');
    expect(PIGMI_MCP_INSTRUCTIONS).toContain('Never hardcode object-specific');
    expect(PIGMI_EDIT_PROMPT).toContain('visible evidence rather than object stereotypes');
  });

  it('turns a finished palette image into a bounded batch workflow', () => {
    expect(PIGMI_MCP_INSTRUCTIONS).toContain('finished palette, swatch sheet, or gradient grid');
    expect(PIGMI_MCP_INSTRUCTIONS).toContain('one create_gradient_items operation');
    expect(PIGMI_MCP_INSTRUCTIONS).toContain('Do not open a browser');
    expect(PIGMI_MCP_INSTRUCTIONS).toContain('continue analyzing indefinitely');
    expect(PIGMI_EDIT_PROMPT).toContain('without waiting for an external pixel sampler');

    const reference = getOperationReference(['create_gradient_items']);
    expect(reference.create_gradient_items.itemSchema).toMatchObject({
      name: expect.any(String),
      colors: expect.any(Array),
      direction: expect.any(String),
      material: expect.any(Object),
    });
  });

  it('preserves the legacy editor behavior rules in the model-independent prompt', () => {
    const expectedRules = [
      'target.ids',
      'target.all',
      'full semantic path',
      'duplicate_folder',
      'duplicate_folder.itemEdits',
      'itemType sg',
      'radial, conic, stepped, or black-to-white',
      'maxItemSize',
      'colorOffsets',
      'N clearly different sets',
      'itemsPerRow',
      'itemsPerColumn',
      'startRow 1 maps to y=0',
      'offsetCells',
    ];

    expectedRules.forEach((rule) => expect(FULL_PIGMI_MCP_INSTRUCTIONS).toContain(rule));
  });

  it('routes repeated structures through semantic folder tools', () => {
    const expectedTerms = [
      'pigmi_get_folders',
      'pigmi_compare_folders',
      'pigmi_duplicate_folder_variants',
      'pigmi_edit_folder_items',
      'exactly N complete sibling folders',
      'complete semantic path',
      'semantically stable material parts',
      'PBR values as part of the semantic material',
      'colors only',
    ];
    expectedTerms.forEach((term) => expect(FULL_PIGMI_MCP_INSTRUCTIONS).toContain(term));

    const reference = getOperationReference(['duplicate_folder', 'edit_folder_items']);
    expect(reference.duplicate_folder.itemEdits[0]).toMatchObject({
      relativePath: expect.any(String),
      colors: expect.any(Array),
      material: expect.any(Object),
    });
    expect(reference.edit_folder_items.itemEdits[0]).toMatchObject({
      relativePath: expect.any(String),
      material: expect.any(Object),
      visible: expect.any(String),
    });
  });

  it('describes PBR materials and per-stop opacity as actionable features', () => {
    const expectedMaterialTerms = [
      'roughness',
      'metallic',
      'emissionStrength',
      'clearcoat roughness',
      'Opacity is stored per color stop',
      'MRC packs metallic, roughness, and clearcoat',
    ];
    expectedMaterialTerms.forEach((term) => expect(FULL_PIGMI_MCP_INSTRUCTIONS).toContain(term));

    const reference = getOperationReference(['create_gradient_item', 'update_item']);
    expect(reference.create_gradient_item.material).toMatchObject({
      roughness: '0..100',
      metallic: '0..100',
      emissionStrength: '0..100',
      clearcoat: '0..100',
      clearcoatRoughness: '0..100',
    });
    expect(reference.update_item).toMatchObject({
      opacity: expect.stringContaining('0..100'),
      opacities: expect.any(Array),
    });
  });
});
