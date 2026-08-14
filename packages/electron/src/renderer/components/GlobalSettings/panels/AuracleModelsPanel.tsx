import React, { useState } from 'react';
import { ProviderConfig, Model } from '../../Settings/SettingsView';
import { SettingsToggle } from '../SettingsToggle';
import {
  AURACLE_MODELS,
  AURACLE_DEFAULT_RUN_TARGETS,
  type AuracleModelKey,
  type AuracleRunTarget,
  type AuracleRunTargetMode,
  type AuracleRunTargets,
} from '@nimbalyst/runtime/ai/modelConstants';

interface AuracleModelsPanelProps {
  config: ProviderConfig;
  apiKeys: Record<string, string>;
  availableModels: Model[];
  loading: boolean;
  onToggle: (enabled: boolean) => void;
  onApiKeyChange: (key: string, value: string) => void;
  onModelToggle: (modelId: string, enabled: boolean) => void;
  onSelectAllModels: (selectAll: boolean) => void;
  onTestConnection: () => Promise<void>;
  onConfigChange: (updates: Partial<ProviderConfig>) => void;
}

type TestState = { status: 'idle' | 'testing' | 'success' | 'error'; message?: string };

const MODE_LABELS: Record<AuracleRunTargetMode, string> = {
  local: 'Local',
  remote: 'Remote',
  cloud: 'Cloud',
};

const MODE_HINT: Record<AuracleRunTargetMode, string> = {
  local: 'OpenAI-compatible endpoint on this machine. No API key.',
  remote: 'OpenAI-compatible endpoint on your network. No API key.',
  cloud: 'OpenAI-compatible cloud endpoint. Sends an Authorization: Bearer key.',
};

export function AuracleModelsPanel({
  config,
  onToggle,
  onConfigChange,
}: AuracleModelsPanelProps) {
  const [tests, setTests] = useState<Record<AuracleModelKey, TestState>>({
    sextant: { status: 'idle' },
    atlas: { status: 'idle' },
  });

  // Resolve the effective run targets, falling back to the seeded defaults when a
  // model's target is missing (e.g. settings saved before this feature shipped).
  const runTargets: AuracleRunTargets = config.runTargets ?? AURACLE_DEFAULT_RUN_TARGETS;
  const targetFor = (key: AuracleModelKey): AuracleRunTarget =>
    runTargets[key] ?? AURACLE_DEFAULT_RUN_TARGETS[key];

  const updateTarget = (key: AuracleModelKey, patch: Partial<AuracleRunTarget>) => {
    const next: AuracleRunTargets = {
      ...runTargets,
      [key]: { ...targetFor(key), ...patch },
    };
    onConfigChange({ runTargets: next });
  };

  const runTest = async (key: AuracleModelKey) => {
    const target = targetFor(key);
    setTests(prev => ({ ...prev, [key]: { status: 'testing' } }));
    try {
      // Routed through the main process (ai:auracleTestModel) so the GET
      // {baseUrl}/models probe isn't blocked by the renderer's same-origin policy.
      const apiKey = target.mode === 'cloud' ? target.apiKey : undefined;
      const result = await window.electronAPI.invoke('ai:auracleTestModel', target.baseUrl, apiKey);
      if (result?.success) {
        setTests(prev => ({ ...prev, [key]: { status: 'success' } }));
      } else {
        setTests(prev => ({
          ...prev,
          [key]: { status: 'error', message: result?.error || 'Not reachable' },
        }));
      }
    } catch (error) {
      setTests(prev => ({
        ...prev,
        [key]: { status: 'error', message: error instanceof Error ? error.message : 'Not reachable' },
      }));
    }
  };

  return (
    <div className="provider-panel flex flex-col">
      <div className="provider-panel-header mb-6 pb-4 border-b border-[var(--nim-border)]">
        <h3 className="provider-panel-title text-xl font-semibold leading-tight mb-2 text-[var(--nim-text)]">Auracle Models</h3>
        <p className="provider-panel-description text-sm leading-relaxed text-[var(--nim-text-muted)]">
          Auracle's built-in chat models. Each model runs against an OpenAI-compatible
          endpoint that you point at a Local, Remote, or Cloud run target. Local and
          Remote need no key; Cloud attaches a Bearer API key you supply.
        </p>
      </div>

      <SettingsToggle
        variant="enable"
        name="Enable Auracle Models"
        checked={config.enabled}
        onChange={onToggle}
      />

      {config.enabled && (
        <>
          {AURACLE_MODELS.map(model => {
            const key = model.id as AuracleModelKey;
            const target = targetFor(key);
            const test = tests[key];
            return (
              <div
                key={key}
                className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0"
              >
                <div className="mb-3">
                  <h4 className="provider-panel-section-title text-base font-semibold text-[var(--nim-text)]">{model.displayName}</h4>
                  <p className="text-xs text-[var(--nim-text-muted)] mt-0.5">{model.subtitle}</p>
                </div>

                {/* Run target mode selector */}
                <div className="mb-3">
                  <div className="text-xs text-[var(--nim-text-muted)] mb-1.5">Run target</div>
                  <div className="inline-flex rounded-md border border-[var(--nim-border)] overflow-hidden">
                    {(Object.keys(MODE_LABELS) as AuracleRunTargetMode[]).map(mode => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => updateTarget(key, { mode })}
                        className={`px-3 py-1.5 text-sm cursor-pointer transition-all border-r border-[var(--nim-border)] last:border-r-0 ${
                          target.mode === mode
                            ? 'bg-[var(--nim-primary)] text-white'
                            : 'bg-[var(--nim-bg-secondary)] text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]'
                        }`}
                      >
                        {MODE_LABELS[mode]}
                      </button>
                    ))}
                  </div>
                  <div className="text-xs text-[var(--nim-text-faint)] mt-1.5">{MODE_HINT[target.mode]}</div>
                </div>

                {/* Base URL + Test */}
                <div className="mb-3">
                  <label className="block text-xs text-[var(--nim-text-muted)] mb-1">Base URL (OpenAI-compatible, ends in /v1)</label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={target.baseUrl}
                      onChange={(e) => updateTarget(key, { baseUrl: e.target.value })}
                      onFocus={(e) => e.target.select()}
                      placeholder="http://127.0.0.1:11434/v1"
                      className="api-key-input flex-1 py-2 px-3 rounded-md bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] outline-none font-mono focus:border-[var(--nim-primary)]"
                    />
                    <button
                      className={`test-button inline-flex items-center justify-center py-2 px-4 rounded-md text-sm font-medium whitespace-nowrap cursor-pointer transition-all bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)] border border-[var(--nim-border)] hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)] ${
                        test.status === 'testing' ? 'opacity-60 cursor-wait' : ''
                      } ${test.status === 'success' ? 'text-[var(--nim-success)] border-[var(--nim-success)]' : ''} ${
                        test.status === 'error' ? 'text-[var(--nim-error)] border-[var(--nim-error)]' : ''
                      }`}
                      onClick={() => runTest(key)}
                      disabled={test.status === 'testing'}
                    >
                      {test.status === 'testing' ? 'Testing...' :
                       test.status === 'success' ? '✓ Reachable' :
                       test.status === 'error' ? '✗ Not reachable' : 'Test'}
                    </button>
                  </div>
                  {test.status === 'error' && test.message && (
                    <div className="test-error text-xs mt-2 text-[var(--nim-error)]">{test.message}</div>
                  )}
                </div>

                {/* Upstream model id */}
                <div className="mb-3">
                  <label className="block text-xs text-[var(--nim-text-muted)] mb-1">Upstream model id (sent to the endpoint)</label>
                  <input
                    type="text"
                    value={target.model}
                    onChange={(e) => updateTarget(key, { model: e.target.value })}
                    onFocus={(e) => e.target.select()}
                    placeholder={AURACLE_DEFAULT_RUN_TARGETS[key].model}
                    className="api-key-input w-full py-2 px-3 rounded-md bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] outline-none font-mono focus:border-[var(--nim-primary)]"
                  />
                </div>

                {/* Cloud API key (masked) — only in cloud mode */}
                {target.mode === 'cloud' && (
                  <div>
                    <label className="block text-xs text-[var(--nim-text-muted)] mb-1">API key (Bearer, cloud only)</label>
                    <input
                      type="password"
                      value={target.apiKey || ''}
                      onChange={(e) => updateTarget(key, { apiKey: e.target.value })}
                      onFocus={(e) => e.target.select()}
                      placeholder="sk-..."
                      autoComplete="off"
                      spellCheck={false}
                      className="api-key-input w-full py-2 px-3 rounded-md bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] outline-none font-mono focus:border-[var(--nim-primary)]"
                    />
                    <div className="text-xs text-[var(--nim-text-faint)] mt-1.5">
                      Stored in your local settings and attached only in Cloud mode.
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
