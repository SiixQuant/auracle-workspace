import { describe, expect, it } from 'vitest';
import { getFileType, isBinaryFile, isPdfFile } from '../fileTypeDetector';

describe('getFileType routes files to the right editor', () => {
  it('routes text/code to their editors', () => {
    expect(getFileType('/w/notes.md')).toBe('markdown');
    expect(getFileType('/w/strategy.py')).toBe('code');
    expect(getFileType('/w/data.json')).toBe('code');
    expect(getFileType('/w/logo.png')).toBe('image');
  });

  it('routes PDFs to the dedicated pdf viewer (not the text editor)', () => {
    expect(getFileType('/w/Tearsheets/Auracle_Engine_A2_Tearsheet.pdf')).toBe('pdf');
    expect(getFileType('/w/UPPER.PDF')).toBe('pdf');
    expect(isPdfFile('/w/x.pdf')).toBe(true);
  });

  it('routes every other binary to the binary panel — never the text editor', () => {
    // The exact regression: these used to fall through to Monaco and dump bytes.
    for (const path of [
      '/w/archive.zip',
      '/w/db.sqlite',
      '/w/store.db',
      '/w/installer.dmg',
      '/w/lib.dylib',
      '/w/model.bin',
      '/w/sheet.xlsx',
      '/w/deck.pptx',
      '/w/blob.wasm',
    ]) {
      expect(getFileType(path)).toBe('binary');
      expect(isBinaryFile(path)).toBe(true);
    }
  });

  it('a custom-editor match still wins over the binary route', () => {
    expect(getFileType('/w/model.pdf', () => true)).toBe('custom');
  });
});
