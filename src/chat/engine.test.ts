/**
 * ABOUTME: Tests for the chat engine PRD prompt building.
 * Verifies the PRD compatibility guidance instructs plain-text descriptions.
 */

import { describe, test, expect } from 'bun:test';
import { buildPrdSystemPromptFromSkillSource } from './engine.js';

describe('buildPrdSystemPromptFromSkillSource', () => {
  test('includes plain text description guidance', () => {
    const result = buildPrdSystemPromptFromSkillSource('');
    expect(result).toContain('Plain text description');
  });

  test('instructs against **Description:** prefix', () => {
    const result = buildPrdSystemPromptFromSkillSource('');
    expect(result).toContain('no **Description:** prefix');
  });

  test('does NOT include **Description:** as the recommended format', () => {
    const result = buildPrdSystemPromptFromSkillSource('');
    // Should not show the old format that caused parsing issues
    expect(result).not.toContain('"**Description:** As a user');
  });

  test('includes guidance when skill source is provided', () => {
    const skillSource = '---\ntitle: My Skill\n---\nSome skill instructions.';
    const result = buildPrdSystemPromptFromSkillSource(skillSource);
    expect(result).toContain('Some skill instructions.');
    expect(result).toContain('Plain text description');
    expect(result).toContain('no **Description:** prefix');
  });

  test('includes US-001 header format guidance', () => {
    const result = buildPrdSystemPromptFromSkillSource('');
    expect(result).toContain('### US-001: Title');
  });

  test('includes acceptance criteria format guidance', () => {
    const result = buildPrdSystemPromptFromSkillSource('');
    expect(result).toContain('**Acceptance Criteria:**');
  });
});
