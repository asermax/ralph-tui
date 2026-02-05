/**
 * ABOUTME: Tests for the Kimi Code agent plugin.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KimiAgentPlugin } from './kimi.js';

describe('KimiAgentPlugin', () => {
  let plugin: KimiAgentPlugin;

  beforeEach(() => {
    plugin = new KimiAgentPlugin();
  });

  afterEach(async () => {
    await plugin.dispose();
  });

  describe('meta', () => {
    it('should have correct metadata', () => {
      expect(plugin.meta.id).toBe('kimi');
      expect(plugin.meta.name).toBe('Kimi Code');
      expect(plugin.meta.defaultCommand).toBe('kimi');
      expect(plugin.meta.supportsStreaming).toBe(true);
      expect(plugin.meta.supportsInterrupt).toBe(true);
      expect(plugin.meta.supportsSubagentTracing).toBe(true);
      expect(plugin.meta.structuredOutputFormat).toBe('jsonl');
    });

    it('should have skills paths configured', () => {
      expect(plugin.meta.skillsPaths).toEqual({
        personal: '~/.kimi/skills',
        repo: '.kimi/skills',
      });
    });
  });

  describe('initialize', () => {
    it('should initialize with default config', async () => {
      await plugin.initialize({});
      expect(await plugin.isReady()).toBe(true);
    });

    it('should accept outputMode config', async () => {
      await plugin.initialize({ outputMode: 'stream-json' });
      expect(await plugin.isReady()).toBe(true);
    });

    it('should accept model config', async () => {
      await plugin.initialize({ model: 'kimi-k2-0711-preview' });
      expect(await plugin.isReady()).toBe(true);
    });

    it('should accept thinking config', async () => {
      await plugin.initialize({ thinking: true });
      expect(await plugin.isReady()).toBe(true);
    });

    it('should accept timeout config', async () => {
      await plugin.initialize({ timeout: 60000 });
      expect(await plugin.isReady()).toBe(true);
    });
  });

  describe('getSetupQuestions', () => {
    it('should return setup questions', () => {
      const questions = plugin.getSetupQuestions();
      expect(questions.length).toBeGreaterThan(0);

      const outputModeQ = questions.find((q) => q.id === 'outputMode');
      expect(outputModeQ).toBeDefined();
      expect(outputModeQ?.type).toBe('select');

      const modelQ = questions.find((q) => q.id === 'model');
      expect(modelQ).toBeDefined();
      expect(modelQ?.type).toBe('select');

      const thinkingQ = questions.find((q) => q.id === 'thinking');
      expect(thinkingQ).toBeDefined();
      expect(thinkingQ?.type).toBe('boolean');
    });
  });

  describe('validateModel', () => {
    beforeEach(async () => {
      await plugin.initialize({});
    });

    it('should accept empty string (default)', () => {
      expect(plugin.validateModel('')).toBeNull();
    });

    it('should accept undefined', () => {
      expect(plugin.validateModel(undefined as unknown as string)).toBeNull();
    });

    it('should accept valid models', () => {
      expect(plugin.validateModel('kimi-k2-0711-preview')).toBeNull();
      expect(plugin.validateModel('kimi-k2-0711')).toBeNull();
      expect(plugin.validateModel('kimi-k1-0711')).toBeNull();
      expect(plugin.validateModel('kimi-latest')).toBeNull();
    });

    it('should reject invalid models', () => {
      const result = plugin.validateModel('invalid-model');
      expect(result).toContain('Invalid model');
    });
  });

  describe('validateSetup', () => {
    beforeEach(async () => {
      await plugin.initialize({});
    });

    it('should validate empty answers', async () => {
      const result = await plugin.validateSetup({});
      expect(result).toBeNull();
    });

    it('should validate valid outputMode', async () => {
      const result = await plugin.validateSetup({ outputMode: 'stream-json' });
      expect(result).toBeNull();
    });

    it('should reject invalid outputMode', async () => {
      const result = await plugin.validateSetup({ outputMode: 'invalid' });
      expect(result).toContain('Invalid output mode');
    });

    it('should validate valid model', async () => {
      const result = await plugin.validateSetup({ model: 'kimi-k2-0711-preview' });
      expect(result).toBeNull();
    });

    it('should reject invalid model', async () => {
      const result = await plugin.validateSetup({ model: 'invalid-model' });
      expect(result).toContain('Invalid model');
    });
  });

  describe('getSandboxRequirements', () => {
    it('should return sandbox requirements', () => {
      const reqs = plugin.getSandboxRequirements();
      expect(reqs.authPaths).toContain('~/.kimi');
      expect(reqs.requiresNetwork).toBe(true);
    });
  });

  describe('JSONL parsing', () => {
    describe('parseJsonlLine', () => {
      it('should parse valid JSON', () => {
        const result = KimiAgentPlugin.parseJsonlLine('{"type":"assistant","message":"hello"}');
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.message.type).toBe('assistant');
          expect(result.message.raw).toEqual({ type: 'assistant', message: 'hello' });
        }
      });

      it('should handle empty lines', () => {
        const result = KimiAgentPlugin.parseJsonlLine('');
        expect(result.success).toBe(false);
      });

      it('should handle whitespace-only lines', () => {
        const result = KimiAgentPlugin.parseJsonlLine('   ');
        expect(result.success).toBe(false);
      });

      it('should handle invalid JSON', () => {
        const result = KimiAgentPlugin.parseJsonlLine('not json');
        expect(result.success).toBe(false);
      });

      it('should extract tool information', () => {
        const result = KimiAgentPlugin.parseJsonlLine(
          '{"type":"assistant","tool":{"name":"read_file","input":{"path":"test.txt"}}}'
        );
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.message.tool?.name).toBe('read_file');
          expect(result.message.tool?.input?.path).toBe('test.txt');
        }
      });

      it('should extract cost information', () => {
        const result = KimiAgentPlugin.parseJsonlLine(
          '{"type":"result","cost":{"inputTokens":100,"outputTokens":50,"totalUSD":0.005}}'
        );
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.message.cost?.inputTokens).toBe(100);
          expect(result.message.cost?.outputTokens).toBe(50);
          expect(result.message.cost?.totalUSD).toBe(0.005);
        }
      });
    });

    describe('parseJsonlOutput', () => {
      it('should parse multi-line output', () => {
        const output = `{"type":"assistant","message":"hello"}
{"type":"result","message":"done"}`;
        const result = KimiAgentPlugin.parseJsonlOutput(output);
        expect(result.messages).toHaveLength(2);
        expect(result.messages[0].type).toBe('assistant');
        expect(result.messages[1].type).toBe('result');
      });

      it('should handle mixed valid and invalid lines', () => {
        const output = `{"type":"assistant","message":"hello"}
not json
{"type":"result","message":"done"}`;
        const result = KimiAgentPlugin.parseJsonlOutput(output);
        expect(result.messages).toHaveLength(2);
        expect(result.fallback).toHaveLength(1);
        expect(result.fallback[0]).toBe('not json');
      });

      it('should handle empty output', () => {
        const result = KimiAgentPlugin.parseJsonlOutput('');
        expect(result.messages).toHaveLength(0);
        expect(result.fallback).toHaveLength(0);
      });
    });

    describe('createStreamingJsonlParser', () => {
      it('should parse chunks incrementally', () => {
        const parser = KimiAgentPlugin.createStreamingJsonlParser();
        
        // First chunk - partial line
        const results1 = parser.push('{"type":"ass');
        expect(results1).toHaveLength(0);

        // Complete the line and add another
        const results2 = parser.push('istant","message":"hello"}\n{"type":"result"');
        expect(results2).toHaveLength(1);
        expect(results2[0].success).toBe(true);

        // Complete the second line
        const results3 = parser.push(',"message":"done"}\n');
        expect(results3).toHaveLength(1);
        expect(results3[0].success).toBe(true);

        const state = parser.getState();
        expect(state.messages).toHaveLength(2);
      });

      it('should handle flush', () => {
        const parser = KimiAgentPlugin.createStreamingJsonlParser();
        parser.push('{"type":"assistant","message":"hello"}');
        
        const results = parser.flush();
        expect(results).toHaveLength(1);
        expect(results[0].success).toBe(true);
      });

      it('should handle empty flush', () => {
        const parser = KimiAgentPlugin.createStreamingJsonlParser();
        const results = parser.flush();
        expect(results).toHaveLength(0);
      });
    });
  });
});
