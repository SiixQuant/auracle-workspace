import { describe, expect, it, vi } from 'vitest';
import { writeNewFile } from '../ipc/createFileWrite';

describe('writeNewFile (create-file overwrite guard)', () => {
  it('writes with the exclusive wx flag so an existing file is never overwritten', async () => {
    const writer = vi.fn().mockResolvedValue(undefined);

    const result = await writeNewFile('/ws/strategy.py', 'print(1)', writer);

    expect(result).toEqual({ success: true, filePath: '/ws/strategy.py' });
    expect(writer).toHaveBeenCalledTimes(1);
    const [, , options] = writer.mock.calls[0];
    expect(options).toMatchObject({ flag: 'wx' });
  });

  it('returns a distinguishable FILE_EXISTS result when the target already exists', async () => {
    const eexist = Object.assign(new Error("EEXIST: file already exists, open '/ws/strategy.py'"), {
      code: 'EEXIST',
    });
    const writer = vi.fn().mockRejectedValue(eexist);

    const result = await writeNewFile('/ws/strategy.py', 'print(1)', writer);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('FILE_EXISTS');
    expect(result.error).toBe('A file with that name already exists');
    expect(result.filePath).toBe('/ws/strategy.py');
  });

  it('surfaces the raw message for non-EEXIST failures without a FILE_EXISTS code', async () => {
    const eacces = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    const writer = vi.fn().mockRejectedValue(eacces);

    const result = await writeNewFile('/ws/strategy.py', 'print(1)', writer);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBeUndefined();
    expect(result.error).toBe('EACCES: permission denied');
  });

  it('does not blow up when a rejected value has no message', async () => {
    const writer = vi.fn().mockRejectedValue('boom');

    const result = await writeNewFile('/ws/strategy.py', '', writer);

    expect(result.success).toBe(false);
    expect(result.error).toBe('boom');
  });
});
