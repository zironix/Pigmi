import { describe, expect, it } from 'vitest';

import {
  FULL_PIGMI_MCP_INSTRUCTIONS,
  PIGMI_EDIT_PROMPT,
  PIGMI_MCP_INSTRUCTIONS,
  PIGMI_SERVER_INSTRUCTIONS,
} from '../mcp/instructions.mjs';
import { getOperationReference } from '../mcp/operation-reference.mjs';

describe('Pigmi MCP instructions', () => {
  it('keeps the safe progressive workflow self-contained', () => {
    const requiredTerms = [
      'pigmi_get_overview',
      'pigmi_get_items',
      'expectedRevision',
      'Never read or edit Pigmi project JSON',
      'never change selection unless requested',
      'Do not repeat unchanged reads',
    ];

    requiredTerms.forEach((term) => expect(PIGMI_MCP_INSTRUCTIONS).toContain(term));
  });

  it('makes the model infer local naming and layout without domain hardcoding', () => {
    const expectedTerms = [
      'The model must infer conventions',
      'Never rely on hardcoded domain vocabulary',
      'nearest relevant existing siblings',
      'folder bounds',
      'item transforms',
      'language or script',
      'numbering style',
      'zero padding',
      'local spatial convention',
      'separate palettes or groups',
      'items touch edge-to-edge',
      'every offset is relative to sourcePath',
      'left-to-right, then top-to-bottom fallback',
    ];

    expectedTerms.forEach((term) => expect(FULL_PIGMI_MCP_INSTRUCTIONS).toContain(term));
    expect(PIGMI_EDIT_PROMPT).toContain('never use hardcoded domain conventions');
    expect(PIGMI_EDIT_PROMPT).toContain('bounds/transforms');
    expect(PIGMI_EDIT_PROMPT).toContain('edge-to-edge unless the user explicitly requests spacing');
    expect(PIGMI_EDIT_PROMPT).toContain('Never claim success after a failed tool');
  });

  it('preserves complete repeated structures and exact requested counts', () => {
    const expectedTerms = [
      'pigmi_get_folders',
      'pigmi_compare_folders',
      'pigmi_duplicate_folder_variants',
      'pigmi_edit_folder_items',
      'full semantic paths',
      'Existing hierarchy is the template',
      'For N requested variants, create exactly N complete',
      'color-only variant preserves PBR values',
    ];

    expectedTerms.forEach((term) => expect(FULL_PIGMI_MCP_INSTRUCTIONS).toContain(term));

    const reference = getOperationReference(['duplicate_folder', 'edit_folder_items']);
    expect(reference.duplicate_folder.notes).toEqual(
      expect.arrayContaining([expect.stringContaining('successive multiples')]),
    );
    expect(reference.edit_folder_items.itemEdits[0]).toMatchObject({
      relativePath: expect.any(String),
      material: expect.any(Object),
      visible: expect.any(String),
    });
  });

  it('covers faithful image interpretation and bounded palette creation', () => {
    const expectedTerms = [
      'finished palette, swatch sheet, or gradient grid',
      'visible evidence',
      'small accents',
      'Inspect attached images directly',
      'one bounded create batch',
    ];

    expectedTerms.forEach((term) => expect(PIGMI_MCP_INSTRUCTIONS).toContain(term));

    const reference = getOperationReference(['create_gradient_items']);
    expect(reference.create_gradient_items.itemSchema).toMatchObject({
      name: expect.any(String),
      colors: expect.any(Array),
      direction: expect.any(String),
      material: expect.any(Object),
    });
  });

  it('describes material and opacity behavior with actionable field names', () => {
    const expectedTerms = [
      'roughness',
      'metallic',
      'emission strength',
      'clearcoat roughness',
      'Opacity belongs to color stops',
      'MRC packs metallic, roughness, and clearcoat',
    ];

    expectedTerms.forEach((term) => expect(FULL_PIGMI_MCP_INSTRUCTIONS).toContain(term));

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

  it('keeps fixed instructions compact and never returns every operation by default', () => {
    expect(FULL_PIGMI_MCP_INSTRUCTIONS.trim().split(/\s+/).length).toBeLessThan(1000);
    expect(PIGMI_EDIT_PROMPT.trim().split(/\s+/).length).toBeLessThan(100);
    expect(getOperationReference([])).toEqual({});
    expect(Object.keys(getOperationReference(['rename_item']))).toEqual(['rename_item']);
  });

  it('keeps repeated server instructions tiny and defines a two-call simple-palette path', () => {
    expect(PIGMI_SERVER_INSTRUCTIONS.trim().split(/\s+/).length).toBeLessThan(100);
    expect(PIGMI_SERVER_INSTRUCTIONS).toContain('pigmi_get_overview once');
    expect(PIGMI_SERVER_INSTRUCTIONS).toContain(
      'straightforward new palette needs only overview then pigmi_create_items',
    );
    expect(PIGMI_SERVER_INSTRUCTIONS).toContain('never hardcode conventions');
    expect(PIGMI_SERVER_INSTRUCTIONS).toContain('Create at root');
    expect(PIGMI_SERVER_INSTRUCTIONS).toContain('folderPath creates it');
    expect(PIGMI_SERVER_INSTRUCTIONS).toContain('never claim success');
    expect(PIGMI_SERVER_INSTRUCTIONS).toContain('edge-to-edge unless spacing is explicit');
    expect(PIGMI_SERVER_INSTRUCTIONS).toContain('left-to-right, then top-to-bottom');
    expect(PIGMI_SERVER_INSTRUCTIONS).toContain('avoid repeated reads');
  });
});
