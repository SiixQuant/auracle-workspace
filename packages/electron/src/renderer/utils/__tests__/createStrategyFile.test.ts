import { describe, expect, it, vi } from 'vitest';
import { createStrategyFileNoOverwrite } from '../createStrategyFile';

describe('createStrategyFileNoOverwrite', () => {
  it('creates the sanitized base name when it is free', async () => {
    const createFile = vi.fn().mockResolvedValue({ success: true });

    const result = await createStrategyFileNoOverwrite('/ws', 'my_strategy', '.py', 'code', createFile);

    expect(result).toEqual({ success: true, filePath: '/ws/my_strategy.py' });
    expect(createFile).toHaveBeenCalledTimes(1);
    expect(createFile).toHaveBeenCalledWith('/ws/my_strategy.py', 'code');
  });

  it('auto-suffixes _2 when the first name already exists', async () => {
    const createFile = vi
      .fn()
      .mockResolvedValueOnce({ success: false, errorCode: 'FILE_EXISTS' })
      .mockResolvedValueOnce({ success: true });

    const result = await createStrategyFileNoOverwrite('/ws', 'my_strategy', '.py', 'code', createFile);

    expect(result).toEqual({ success: true, filePath: '/ws/my_strategy_2.py' });
    expect(createFile.mock.calls.map((c) => c[0])).toEqual([
      '/ws/my_strategy.py',
      '/ws/my_strategy_2.py',
    ]);
  });

  it('walks _2.._9 and surfaces the already-exists message when all are taken', async () => {
    const createFile = vi.fn().mockResolvedValue({ success: false, errorCode: 'FILE_EXISTS' });

    const result = await createStrategyFileNoOverwrite('/ws', 's', '.py', 'code', createFile);

    expect(result.success).toBe(false);
    expect(result.error).toBe('A file with that name already exists');
    // base + _2.._9 = 9 attempts, then it gives up.
    expect(createFile).toHaveBeenCalledTimes(9);
  });

  it('surfaces a non-existence error immediately without retrying', async () => {
    const createFile = vi.fn().mockResolvedValue({ success: false, error: 'EACCES: permission denied' });

    const result = await createStrategyFileNoOverwrite('/ws', 'my_strategy', '.py', 'code', createFile);

    expect(result.success).toBe(false);
    expect(result.error).toBe('EACCES: permission denied');
    expect(createFile).toHaveBeenCalledTimes(1);
  });

  it('treats a missing/undefined result as a failure', async () => {
    const createFile = vi.fn().mockResolvedValue(undefined);

    const result = await createStrategyFileNoOverwrite('/ws', 'my_strategy', '.py', 'code', createFile);

    expect(result.success).toBe(false);
    expect(createFile).toHaveBeenCalledTimes(1);
  });
});
