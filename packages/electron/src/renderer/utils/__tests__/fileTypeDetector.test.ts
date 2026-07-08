import { describe, expect, it } from 'vitest';
import { getFileType, isBinaryFile, isPdfFile, textLooksBinary } from '../fileTypeDetector';

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

  it('routes compiled, data-science, and font binaries to the binary panel', () => {
    // The 2026-07-07 regression: the engine wrote __pycache__/*.pyc into the
    // workspace and the bytecode fell through to Monaco as mojibake.
    for (const path of [
      '/w/Potential/__pycache__/volatility_target_balanced.cpython-313.pyc',
      '/w/app/Main.class',
      '/w/lib/tool.jar',
      '/w/build/main.o',
      '/w/native/addon.node',
      '/w/data/model.pkl',
      '/w/data/frame.parquet',
      '/w/data/arr.npy',
      '/w/data/bundle.npz',
      '/w/data/store.h5',
      '/w/fonts/geist.woff2',
      '/w/fonts/geist.ttf',
      '/w/.DS_Store',
    ]) {
      expect(getFileType(path)).toBe('binary');
      expect(isBinaryFile(path)).toBe(true);
    }
  });
});

describe('textLooksBinary catches binary content that slips past extension checks', () => {
  it('flags decoded binary — NUL bytes survive both utf-8 and latin1 decodes', () => {
    // What a .pyc looks like after the chardet→latin1 misdetection: printable
    // mojibake with the file's NUL bytes intact.
    const pycAsLatin1 = '\u0000\u0000\u0000\u0000\r\r\n÷ÎJÚ9B[yUÑ~ê¤5±';
    expect(textLooksBinary(pycAsLatin1)).toBe(true);
    expect(textLooksBinary('text then a stray \u0000 later')).toBe(true);
  });

  it('passes real text, including accented latin-1 and empty content', () => {
    expect(textLooksBinary('def strategy():\n    return "café"  # é ü ñ')).toBe(false);
    expect(textLooksBinary('')).toBe(false);
  });
});
