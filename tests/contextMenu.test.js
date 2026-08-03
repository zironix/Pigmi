import { describe, expect, it } from 'vitest';

import { shouldShowEditContextMenu } from '../src/main/window/contextMenu';

describe('application context menu', () => {
  it('is available for editable controls', () => {
    expect(shouldShowEditContextMenu({ isEditable: true, selectionText: '' })).toBe(true);
  });

  it('is available for selected text', () => {
    expect(shouldShowEditContextMenu({ isEditable: false, selectionText: 'Pigmi' })).toBe(true);
  });

  it('stays hidden on non-text UI such as layer rows', () => {
    expect(shouldShowEditContextMenu({ isEditable: false, selectionText: '' })).toBe(false);
  });
});
